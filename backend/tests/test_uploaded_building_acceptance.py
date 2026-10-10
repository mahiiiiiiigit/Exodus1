from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import pymupdf as fitz
from fastapi import HTTPException

import main as api
from evacuation_graph import build_graph, evacuation_routes
from floorplan_analysis import analyze_floorplan, get_document_page_count, load_page
from gemini_floorplan import GeminiAnalysisError

BACKEND_DIR = Path(__file__).resolve().parents[1]
UPLOADS_DIR = BACKEND_DIR / "uploads"
DATABASE_PATH = BACKEND_DIR / "data/exodus.sqlite3"


def create_sample_floorplan_image(width: int = 1200, height: int = 800) -> np.ndarray:
    """Create a clean 2-room floor plan with a corridor and exit."""
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (60, 60), (1140, 740), (40, 40, 40), 10)
    cv2.line(image, (600, 60), (600, 500), (40, 40, 40), 8)
    cv2.line(image, (60, 500), (1140, 500), (40, 40, 40), 8)
    cv2.putText(image, "LABORATORY A", (150, 250), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (20, 20, 20), 2)
    cv2.putText(image, "CONTROL ROOM B", (700, 250), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (20, 20, 20), 2)
    cv2.putText(image, "CORRIDOR", (500, 620), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (20, 20, 20), 2)
    cv2.putText(image, "EXIT SOUTH", (1000, 620), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 150, 0), 2)
    return image


def create_two_page_pdf(image_page1: np.ndarray, image_page2: np.ndarray) -> bytes:
    """Create an authentic 2-page PDF document in memory."""
    doc = fitz.open()
    for img in [image_page1, image_page2]:
        ok, encoded = cv2.imencode(".png", img)
        page = doc.new_page(width=img.shape[1], height=img.shape[0])
        page.insert_image(page.rect, stream=encoded.tobytes())
    data = doc.tobytes()
    doc.close()
    return data


class UploadedBuildingAcceptanceTests(unittest.TestCase):
    """
    Acceptance tests for arbitrary user-uploaded floor plans:
    1. Plan 1: Office layout with verified rooms, verified door connections, and reachable exits.
    2. Plan 2: Laboratory layout with an isolated/unreachable room to verify honest reporting.
    3. Multi-page PDF: Separate preservation and retrieval for each floor page.
    4. Quota resilience: Gemini 429 quota exhaustion preserves previously saved work.
    """

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.test_upload_dir = Path(self.temp_dir.name) / "uploads"
        self.test_db_path = Path(self.temp_dir.name) / "test_exodus.sqlite3"
        self.test_upload_dir.mkdir(parents=True, exist_ok=True)

        self.db_patch = patch.object(api, "DATABASE_PATH", self.test_db_path)
        self.upload_patch = patch.object(api, "UPLOAD_DIR", self.test_upload_dir)
        self.db_patch.start()
        self.upload_patch.start()
        api.initialize_database()

    def tearDown(self):
        self.db_patch.stop()
        self.upload_patch.stop()
        self.temp_dir.cleanup()

    def test_acceptance_plan_1_office_floor_plan(self):
        """Test Plan 1: Upload office plan, save review, generate graph, verify routes."""
        img1 = create_sample_floorplan_image(1200, 800)
        ok, encoded1 = cv2.imencode(".png", img1)
        raw_bytes = encoded1.tobytes()

        # 1. Create building workspace
        bld = api.create_building(api.BuildingCreate(name="Corporate Tech HQ"))
        building_id = bld["id"]

        # 2. Store document
        doc_id = "doc-office-001"
        stored_name = f"{doc_id}.png"
        bld_dir = self.test_upload_dir / building_id
        bld_dir.mkdir(parents=True, exist_ok=True)
        (bld_dir / stored_name).write_bytes(raw_bytes)

        with api.connect_db() as conn:
            conn.execute(
                """INSERT INTO floor_documents
                (id, building_id, floor_number, original_filename, stored_filename, content_type, size_bytes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, building_id, 1, "office_layout.png", stored_name, "image/png", len(raw_bytes), "2026-10-11T00:00:00Z"),
            )

        # 3. Source metadata reflects original image resolution
        source = api.get_floorplan_source(building_id, doc_id, page=1)
        self.assertEqual(source["image_width"], 1200)
        self.assertEqual(source["image_height"], 800)
        self.assertEqual(source["page_count"], 1)

        # 4. Review elements:
        # Reception: y: 0.1 .. 0.5
        # Corridor: y: 0.5 .. 0.75
        # Door 1: y: 0.48 .. 0.52 (intersects Reception and Corridor)
        # Exit: x: 0.85 .. 0.95, y: 0.5 .. 0.7
        # Door 2: x: 0.82 .. 0.88, y: 0.55 .. 0.65 (intersects Corridor and Exit)
        elements = [
            api.ReviewedElement(id="room-reception", type="room", label="Reception Area", bbox=api.CropRegion(x=0.08, y=0.1, width=0.4, height=0.4)),
            api.ReviewedElement(id="corridor-main", type="corridor", label="Main Corridor", bbox=api.CropRegion(x=0.08, y=0.5, width=0.76, height=0.25)),
            api.ReviewedElement(id="door-reception", type="door", label="Reception Door", bbox=api.CropRegion(x=0.2, y=0.48, width=0.08, height=0.04)),
            api.ReviewedElement(id="exit-main", type="exit", label="EXIT E1 — SOUTH", bbox=api.CropRegion(x=0.86, y=0.5, width=0.08, height=0.2)),
            api.ReviewedElement(id="door-exit", type="door", label="Exit Door", bbox=api.CropRegion(x=0.82, y=0.55, width=0.06, height=0.1)),
        ]

        mock_analysis = {
            "model": "test-gemini-vision",
            "page_number": 1,
            "image_width": 1200,
            "image_height": 800,
            "candidates": [{"id": e.id, "kind": e.type, "label": e.label, "confidence": 0.9} for e in elements],
            "validated": False,
        }
        with api.connect_db() as conn:
            conn.execute(
                "INSERT INTO floorplan_analyses (document_id, page_number, analysis_json, created_at) VALUES (?, ?, ?, ?)",
                (doc_id, 1, json.dumps(mock_analysis), "2026-10-11T00:00:00Z"),
            )

        review_res = api.save_floorplan_review(
            building_id, doc_id,
            api.AnalysisReview(elements=elements, rejected_candidate_ids=[]),
            page=1,
        )
        self.assertTrue(review_res["validated"])

        # 5. Generate graph: verified connections
        graph_res = api.create_evacuation_graph(building_id, doc_id, page=1)
        graph = graph_res["graph"]
        self.assertEqual(len(graph["nodes"]), 5)

        # Adjacency check
        self.assertIn("door-reception", graph["adjacency"]["room-reception"])
        self.assertIn("corridor-main", graph["adjacency"]["door-reception"])
        self.assertIn("door-exit", graph["adjacency"]["corridor-main"])
        self.assertIn("exit-main", graph["adjacency"]["door-exit"])

        # 6. Verify evacuation routes from Reception Area to safe exit
        route_res = api.get_evacuation_route(building_id, doc_id, api.RouteRequest(start_node_id="room-reception"), page=1)
        routes = route_res["routes"]
        self.assertIsNotNone(routes)
        self.assertIsNotNone(routes["nearest_exit"])
        self.assertEqual(routes["nearest_exit"]["exit_id"], "exit-main")
        self.assertEqual(routes["nearest_exit"]["exit_label"], "EXIT E1 — SOUTH")
        self.assertEqual(
            routes["nearest_exit"]["path_node_ids"],
            ["room-reception", "door-reception", "corridor-main", "door-exit", "exit-main"],
        )

        # 7. Reloading preserved data
        reloaded_analysis = api.get_floorplan_analysis(building_id, doc_id, page=1)
        self.assertTrue(reloaded_analysis["validated"])
        self.assertEqual(len(reloaded_analysis["elements"]), 5)
        labels = {item["label"] for item in reloaded_analysis["elements"]}
        self.assertIn("Reception Area", labels)
        self.assertIn("EXIT E1 — SOUTH", labels)

    def test_acceptance_plan_2_unreachable_area_reported_honestly(self):
        """Test Plan 2: Distinct plan with an isolated room. Verify unreachable exit reporting."""
        img2 = create_sample_floorplan_image(1600, 900)
        ok, encoded2 = cv2.imencode(".png", img2)
        raw_bytes = encoded2.tobytes()

        bld = api.create_building(api.BuildingCreate(name="Research Bio-Lab"))
        building_id = bld["id"]
        doc_id = "doc-biolab-002"
        stored_name = f"{doc_id}.png"
        bld_dir = self.test_upload_dir / building_id
        bld_dir.mkdir(parents=True, exist_ok=True)
        (bld_dir / stored_name).write_bytes(raw_bytes)

        with api.connect_db() as conn:
            conn.execute(
                """INSERT INTO floor_documents
                (id, building_id, floor_number, original_filename, stored_filename, content_type, size_bytes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, building_id, 1, "biolab_level1.png", stored_name, "image/png", len(raw_bytes), "2026-10-11T00:00:00Z"),
            )

        # Elements:
        # Isolated Bio-Containment Vault (no doors)
        # Lab B (with door to Corridor)
        # Corridor with door to Exit
        elements = [
            api.ReviewedElement(id="vault-isolated", type="room", label="Bio-Containment Vault (Locked)", bbox=api.CropRegion(x=0.05, y=0.05, width=0.3, height=0.4)),
            api.ReviewedElement(id="lab-b", type="room", label="General Lab B", bbox=api.CropRegion(x=0.5, y=0.1, width=0.35, height=0.4)),
            api.ReviewedElement(id="corridor", type="corridor", label="Central Hall", bbox=api.CropRegion(x=0.45, y=0.5, width=0.45, height=0.3)),
            api.ReviewedElement(id="door-lab-b", type="door", label="Lab B Door", bbox=api.CropRegion(x=0.6, y=0.48, width=0.08, height=0.04)),
            api.ReviewedElement(id="exit-emergency", type="exit", label="EXIT NORTH BIO-SAFETY", bbox=api.CropRegion(x=0.88, y=0.5, width=0.08, height=0.3)),
            api.ReviewedElement(id="door-exit", type="door", label="Exit Passage", bbox=api.CropRegion(x=0.86, y=0.58, width=0.04, height=0.08)),
        ]

        mock_analysis = {
            "model": "test-gemini-vision",
            "page_number": 1,
            "image_width": 1600,
            "image_height": 900,
            "candidates": [{"id": e.id, "kind": e.type, "label": e.label, "confidence": 0.9} for e in elements],
            "validated": False,
        }
        with api.connect_db() as conn:
            conn.execute(
                "INSERT INTO floorplan_analyses (document_id, page_number, analysis_json, created_at) VALUES (?, ?, ?, ?)",
                (doc_id, 1, json.dumps(mock_analysis), "2026-10-11T00:00:00Z"),
            )

        api.save_floorplan_review(
            building_id, doc_id,
            api.AnalysisReview(elements=elements, rejected_candidate_ids=[]),
            page=1,
        )

        api.create_evacuation_graph(building_id, doc_id, page=1)

        # Query route from isolated room: MUST report unreachable
        isolated_route = api.get_evacuation_route(building_id, doc_id, api.RouteRequest(start_node_id="vault-isolated"), page=1)
        self.assertIsNone(isolated_route["routes"]["nearest_exit"])
        self.assertEqual(isolated_route["routes"]["alternate_exits"], [])

        # Query route from connected Lab B: MUST succeed
        connected_route = api.get_evacuation_route(building_id, doc_id, api.RouteRequest(start_node_id="lab-b"), page=1)
        self.assertIsNotNone(connected_route["routes"]["nearest_exit"])
        self.assertEqual(connected_route["routes"]["nearest_exit"]["exit_id"], "exit-emergency")

    def test_multi_page_pdf_detection_and_page_independence(self):
        """Test multi-page PDF: Separate preservation and retrieval for each floor page."""
        page1_img = create_sample_floorplan_image(1000, 700)
        page2_img = create_sample_floorplan_image(1400, 900)
        two_page_pdf = create_two_page_pdf(page1_img, page2_img)

        self.assertEqual(get_document_page_count(two_page_pdf, "building_tower.pdf"), 2)

        bld = api.create_building(api.BuildingCreate(name="Two-Storey Complex"))
        building_id = bld["id"]
        doc_id = "doc-twopage-pdf"
        stored_name = f"{doc_id}.pdf"
        bld_dir = self.test_upload_dir / building_id
        bld_dir.mkdir(parents=True, exist_ok=True)
        (bld_dir / stored_name).write_bytes(two_page_pdf)

        with api.connect_db() as conn:
            conn.execute(
                """INSERT INTO floor_documents
                (id, building_id, floor_number, original_filename, stored_filename, content_type, size_bytes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, building_id, 1, "building_tower.pdf", stored_name, "application/pdf", len(two_page_pdf), "2026-10-11T00:00:00Z"),
            )

        # Query page 1 source
        source_p1 = api.get_floorplan_source(building_id, doc_id, page=1)
        self.assertEqual(source_p1["page_count"], 2)
        self.assertEqual(source_p1["page_number"], 1)

        # Query page 2 source
        source_p2 = api.get_floorplan_source(building_id, doc_id, page=2)
        self.assertEqual(source_p2["page_count"], 2)
        self.assertEqual(source_p2["page_number"], 2)

        # Save separate reviews for page 1 and page 2
        p1_analysis = {
            "model": "gemini-flash",
            "page_number": 1,
            "candidates": [{"id": "r1", "kind": "room", "label": "Floor 1 Lobby", "confidence": 1.0}],
        }
        p2_analysis = {
            "model": "gemini-flash",
            "page_number": 2,
            "candidates": [{"id": "r2", "kind": "room", "label": "Floor 2 Executive Suite", "confidence": 1.0}],
        }

        with api.connect_db() as conn:
            conn.execute(
                "INSERT INTO floorplan_analyses (document_id, page_number, analysis_json, created_at) VALUES (?, ?, ?, ?)",
                (doc_id, 1, json.dumps(p1_analysis), "2026-10-11T00:00:00Z"),
            )
            conn.execute(
                "INSERT INTO floorplan_analyses (document_id, page_number, analysis_json, created_at) VALUES (?, ?, ?, ?)",
                (doc_id, 2, json.dumps(p2_analysis), "2026-10-11T00:00:00Z"),
            )

        res_p1 = api.get_floorplan_analysis(building_id, doc_id, page=1)
        res_p2 = api.get_floorplan_analysis(building_id, doc_id, page=2)
        self.assertEqual(res_p1["candidates"][0]["label"], "Floor 1 Lobby")
        self.assertEqual(res_p2["candidates"][0]["label"], "Floor 2 Executive Suite")

    def test_quota_exhaustion_preserves_previously_saved_work(self):
        """Verify that Gemini 429 quota exhaustion raises clear error and preserves saved work."""
        img = create_sample_floorplan_image(800, 600)
        ok, encoded = cv2.imencode(".png", img)
        raw_bytes = encoded.tobytes()

        bld = api.create_building(api.BuildingCreate(name="Quota Resilient Building"))
        building_id = bld["id"]
        doc_id = "doc-resilient-001"
        stored_name = f"{doc_id}.png"
        bld_dir = self.test_upload_dir / building_id
        bld_dir.mkdir(parents=True, exist_ok=True)
        (bld_dir / stored_name).write_bytes(raw_bytes)

        with api.connect_db() as conn:
            conn.execute(
                """INSERT INTO floor_documents
                (id, building_id, floor_number, original_filename, stored_filename, content_type, size_bytes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, building_id, 1, "test_plan.png", stored_name, "image/png", len(raw_bytes), "2026-10-11T00:00:00Z"),
            )

        # Save an initial analysis
        initial_analysis = {
            "model": "gemini-flash",
            "page_number": 1,
            "image_width": 800,
            "image_height": 600,
            "candidates": [{"id": "c1", "kind": "room", "label": "Preserved Room", "confidence": 1.0}],
            "elements": [{"id": "c1", "type": "room", "label": "Preserved Room", "bbox": {"x": 0.1, "y": 0.1, "width": 0.3, "height": 0.3}}],
            "validated": False,
        }
        with api.connect_db() as conn:
            conn.execute(
                "INSERT INTO floorplan_analyses (document_id, page_number, analysis_json, created_at) VALUES (?, ?, ?, ?)",
                (doc_id, 1, json.dumps(initial_analysis), "2026-10-11T00:00:00Z"),
            )

        # Simulate Gemini 429 quota error on re-analysis
        with patch("main.analyze_floorplan", side_effect=GeminiAnalysisError("Gemini API quota exhausted for free tier", status_code=429)):
            with self.assertRaises(HTTPException) as exc:
                api.run_floorplan_analysis(building_id, doc_id, page=1)
            self.assertEqual(exc.exception.status_code, 429)
            self.assertIn("quota", str(exc.exception.detail).lower())

        # Verify previous saved data was preserved untouched
        stored = api.get_floorplan_analysis(building_id, doc_id, page=1)
        self.assertEqual(stored["elements"][0]["label"], "Preserved Room")

    def test_initialize_manual_review_when_gemini_unavailable(self):
        """Verify user can initialize a manual review session when Gemini is not configured."""
        bld = api.create_building(api.BuildingCreate(name="Manual Building"))
        building_id = bld["id"]
        doc_id = str(uuid.uuid4())

        img1 = create_sample_floorplan_image(1200, 800)
        _, raw_bytes = cv2.imencode(".png", img1)
        raw_bytes = raw_bytes.tobytes()

        upload_folder = self.test_upload_dir / building_id
        upload_folder.mkdir(parents=True, exist_ok=True)
        stored_name = f"{doc_id}.png"
        (upload_folder / stored_name).write_bytes(raw_bytes)

        with api.connect_db() as conn:
            conn.execute(
                "INSERT INTO floor_documents (id, building_id, floor_number, original_filename, stored_filename, content_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (doc_id, building_id, 1, "manual_plan.png", stored_name, "image/png", len(raw_bytes), "2026-10-11T00:00:00Z"),
            )

        # Call initialize_manual_review
        result = api.initialize_manual_review(building_id, doc_id, page=1)
        self.assertEqual(result["model"], "manual")
        self.assertEqual(result["candidates"], [])
        self.assertEqual(result["elements"], [])
        self.assertFalse(result["validated"])
        self.assertIn("preview_data_url", result)

        # Confirm the review can now be saved
        elements = [
            api.ReviewedElement(id="manual-room-1", type="room", label="Office", bbox=api.CropRegion(x=0.1, y=0.1, width=0.3, height=0.3)),
            api.ReviewedElement(id="manual-exit-1", type="exit", label="FIRE EXIT", bbox=api.CropRegion(x=0.7, y=0.7, width=0.1, height=0.1)),
        ]
        saved = api.save_floorplan_review(
            building_id, doc_id,
            api.AnalysisReview(elements=elements, rejected_candidate_ids=[]),
            page=1,
        )
        self.assertTrue(saved["validated"])
        self.assertEqual(len(saved["elements"]), 2)


if __name__ == "__main__":
    unittest.main()
