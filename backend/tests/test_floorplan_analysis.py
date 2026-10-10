import unittest
import json
import sqlite3
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import cv2
import numpy as np
import pymupdf as fitz

from floorplan_analysis import analyze_floorplan, load_page
from gemini_floorplan import GeminiAnalysisError, VisionCandidate, VisionResponse, _client_call, analyze_image, render_detection_overlay
from evacuation_graph import GRAPH_VERSION, build_graph, evacuation_routes, passage_connections, propagate_fire
import main as api
from main import load_stored_graph, run_floorplan_analysis
from fastapi import HTTPException


BACKEND = Path(__file__).resolve().parents[1]
DATABASE = BACKEND / "data/exodus.sqlite3"
OFFICE_SAMPLE = BACKEND / "uploads/e0b75e03-39b5-436e-afdc-4755fb9cd134/9c7448ea-9ccc-47dc-99c5-629c0d60b896.png"


def reviewed_item(identifier, label, box, confidence=.9):
    return {"id": identifier, "label": label, "bbox": box, "confidence": confidence, "review_status": "confirmed"}


def graph_analysis(**overrides):
    analysis = {"validated": True, "rooms": [], "corridors": [], "doors": [], "openings": [], "stairs": [], "exits": []}
    analysis.update(overrides)
    return analysis


def current_systematic_plan():
    if not DATABASE.exists():
        return None
    import json
    import sqlite3

    connection = sqlite3.connect(DATABASE)
    try:
        row = connection.execute(
            """SELECT d.id, d.building_id, d.stored_filename, a.analysis_json, g.graph_json
            FROM floor_documents d JOIN floorplan_analyses a ON a.document_id = d.id
            LEFT JOIN evacuation_graphs g ON g.document_id = d.id
            WHERE d.original_filename = 'exodus_test_office_floor_plan.pdf'
            ORDER BY d.created_at DESC LIMIT 1"""
        ).fetchone()
    finally:
        connection.close()
    if not row:
        return None
    return row[0], row[1], BACKEND / "uploads" / row[1] / row[2], json.loads(row[3]), json.loads(row[4]) if row[4] else None


def make_clean_plan(width: int = 600, height: int = 400) -> np.ndarray:
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (45, 40), (555, 360), (45, 45, 45), 8)
    cv2.line(image, (300, 40), (300, 360), (45, 45, 45), 7)
    cv2.line(image, (45, 210), (300, 210), (45, 45, 45), 7)
    return image


def png_bytes(image: np.ndarray) -> bytes:
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError("Could not encode test image")
    return encoded.tobytes()


class FakeModels:
    def __init__(self, result):
        self.result = result
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(parsed=self.result, text=self.result.model_dump_json())


class FakeClient:
    def __init__(self, result):
        self.models = FakeModels(result)


class BadModels:
    def generate_content(self, **kwargs):
        return SimpleNamespace(parsed=None, text='{"outline": [}')


class BadClient:
    models = BadModels()


class FakeAPIError(Exception):
    def __init__(self, code, message, retry_after=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = "UNAVAILABLE" if code == 503 else "INVALID_ARGUMENT"
        self.response = SimpleNamespace(headers={"Retry-After": retry_after} if retry_after else {})


class SequenceModels:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def generate_content(self, **kwargs):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(parsed=outcome, text=outcome.model_dump_json())


class SequenceClient:
    def __init__(self, outcomes):
        self.models = SequenceModels(outcomes)


def result_for_plan(outline=None, candidates=None):
    return VisionResponse(
        outline_xy=[value for point in (outline or [
            {"x": .075, "y": .1}, {"x": .925, "y": .1},
            {"x": .925, "y": .9}, {"x": .075, "y": .9},
        ]) for value in (point["x"], point["y"])],
        outline_confidence=.91,
        outline_uncertainty=[],
        candidates=[VisionCandidate(
            kind="room", polygon_xy=[.1, .1, .48, .1, .48, .49, .1, .49],
            label="Office", confidence=.84, label_confidence=.9, uncertainty=[], label_is_readable=True, explicitly_marked_exit=False,
        )] if candidates is None else candidates,
    )


class FloorPlanSourceTests(unittest.TestCase):
    def test_clean_png_keeps_original_full_resolution_and_does_not_autoconfirm_features(self):
        original = make_clean_plan()
        raw = png_bytes(original)
        model = result_for_plan()
        client = FakeClient(model)
        with patch.dict("os.environ", {"GEMINI_MODEL": "gemini-test-vision"}):
            analysis = analyze_image(load_page(raw, "clean-plan.png", 1), client=client)

        self.assertEqual(len(client.models.calls), 1)
        self.assertEqual(client.models.calls[0]["model"], "gemini-test-vision")
        self.assertEqual(original.shape[:2], load_page(raw, "clean-plan.png", 1).shape[:2])
        self.assertEqual(analysis["rooms"], [])
        self.assertEqual(analysis["exits"], [])
        self.assertEqual(analysis["candidates"][0]["review_status"], "candidate")

    def test_uploaded_browser_screenshot_is_sent_whole_and_coordinates_stay_on_plan_region(self):
        screenshot = np.full((700, 900, 3), 245, dtype=np.uint8)
        cv2.rectangle(screenshot, (0, 0), (899, 79), (35, 40, 45), -1)
        cv2.putText(screenshot, "Browser tabs and website header", (25, 48), cv2.FONT_HERSHEY_SIMPLEX, .8, (240, 240, 240), 2)
        cv2.putText(screenshot, "Website text is not a room", (680, 250), cv2.FONT_HERSHEY_SIMPLEX, .55, (30, 30, 30), 2)
        screenshot[140:560, 180:720] = make_clean_plan(540, 420)
        # The mock response represents a model that identified the actual plan
        # on the full screenshot. It lets this offline test exercise source to
        # normalized-coordinate mapping without requiring a Gemini key.
        mock = result_for_plan(
            outline=[{"x": .2, "y": .2}, {"x": .8, "y": .2}, {"x": .8, "y": .8}, {"x": .2, "y": .8}],
            candidates=[VisionCandidate(kind="room", polygon_xy=[.22, .22, .4, .22, .4, .4, .22, .4], label="Office", confidence=.8, label_confidence=.93, uncertainty=[], label_is_readable=True, explicitly_marked_exit=False)],
        )
        client = FakeClient(mock)
        analysis = analyze_image(screenshot, client=client)
        sent_data = client.models.calls[0]["contents"][1].inline_data.data
        sent_image = cv2.imdecode(np.frombuffer(sent_data, dtype=np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(sent_image.shape[:2], screenshot.shape[:2])
        mapped = analysis["candidates"][0]["polygon"]
        self.assertEqual((round(mapped[0]["x"] * 900), round(mapped[0]["y"] * 700)), (198, 154))
        self.assertTrue(all(.2 <= point["x"] <= .8 and .2 <= point["y"] <= .8 for point in mapped))
        self.assertEqual(analysis["exits"], [])

    def test_pdf_page_rasterizes_original_full_page_before_analysis(self):
        plan = png_bytes(make_clean_plan())
        document = fitz.open()
        page = document.new_page(width=600, height=400)
        page.insert_image(fitz.Rect(40, 30, 560, 370), stream=plan)
        pdf_bytes = document.tobytes()
        document.close()

        raster = load_page(pdf_bytes, "original.pdf", 1)
        mock_analysis = {"model": "test", "outline": [], "outline_confidence": 0, "outline_uncertainty": [], "candidates": [], "geometric_candidates": [], "outer_walls": [], "rooms": [], "corridors": [], "doors": [], "stairs": [], "exits": [], "elements": [], "warnings": []}
        with patch("gemini_floorplan.analyze_image", return_value=mock_analysis) as vision:
            analysis = analyze_floorplan(pdf_bytes, "original.pdf", 1)
        self.assertEqual(vision.call_args.args[0].shape, raster.shape)
        self.assertGreater(analysis["image_width"], 600)
        self.assertGreater(analysis["image_height"], 400)
        self.assertEqual(analysis["source_crop"], {"x": 0, "y": 0, "width": 1, "height": 1})

    def test_existing_office_sample_overlay_maps_to_original_plan_pixels(self):
        image = cv2.imread(str(OFFICE_SAMPLE))
        self.assertIsNotNone(image)
        height, width = image.shape[:2]
        # These mock coordinates follow the visible outside wall and stairwell
        # in the checked-in 1546x952 office floor-plan sample.
        mock = result_for_plan(
            outline=[{"x": .13, "y": .11}, {"x": .937, "y": .11}, {"x": .937, "y": .94}, {"x": .13, "y": .94}],
            candidates=[VisionCandidate(kind="stairs", polygon_xy=[.39, .125, .505, .125, .505, .255, .39, .255], label="", confidence=.78, label_confidence=0, uncertainty=["stair boundary partly obscured"], label_is_readable=False, explicitly_marked_exit=False)],
        )
        analysis = analyze_image(image, client=FakeClient(mock))
        first = analysis["candidates"][0]["polygon"][0]
        expected = (round(.39 * (width - 1)), round(.125 * (height - 1)))
        self.assertEqual((round(first["x"] * (width - 1)), round(first["y"] * (height - 1))), expected)
        self.assertEqual(analysis["image_width"] if "image_width" in analysis else width, width)
        overlay = render_detection_overlay(image, analysis)
        self.assertEqual(overlay.shape, image.shape)
        self.assertFalse(np.array_equal(overlay[expected[1], expected[0]], image[expected[1], expected[0]]))
        self.assertEqual(analysis["exits"], [])

    def test_invalid_coordinates_and_unreadable_exit_are_not_accepted(self):
        with self.assertRaises(Exception):
            VisionResponse.model_validate({"outline_xy": [1.2, 0], "outline_confidence": .5, "outline_uncertainty": [], "candidates": []})
        with self.assertRaisesRegex(Exception, "readable label"):
            VisionCandidate(kind="exit", polygon_xy=[.1, .1, .2, .1, .2, .2], label="", confidence=.6, label_confidence=0, uncertainty=[], label_is_readable=False, explicitly_marked_exit=True)

    def test_malformed_model_json_is_rejected(self):
        with self.assertRaisesRegex(GeminiAnalysisError, "invalid floor-plan JSON"):
            analyze_image(make_clean_plan(), client=BadClient())

    def test_transient_overload_retries_bounded_and_honors_retry_after(self):
        client = SequenceClient([FakeAPIError(503, "temporarily unavailable", "2"), result_for_plan()])
        with patch("gemini_floorplan.time.sleep") as sleep:
            result = analyze_image(make_clean_plan(), client=client)
        self.assertEqual(client.models.calls, 2)
        sleep.assert_called_once_with(2.0)
        self.assertEqual(result["candidates"][0]["review_status"], "candidate")

    def test_transient_overload_returns_actionable_error_after_attempt_limit(self):
        client = SequenceClient([FakeAPIError(503, "high demand") for _ in range(3)])
        with patch("gemini_floorplan.time.sleep"):
            with self.assertRaisesRegex(GeminiAnalysisError, "temporarily overloaded after bounded retries") as raised:
                analyze_image(make_clean_plan(), client=client)
        self.assertEqual(client.models.calls, 3)
        self.assertEqual(raised.exception.status_code, 503)

    def test_quota_exhaustion_is_returned_without_retries(self):
        client = SequenceClient([FakeAPIError(429, "Quota exceeded for generate_content_free_tier_requests")])
        with patch("gemini_floorplan.time.sleep") as sleep:
            with self.assertRaisesRegex(GeminiAnalysisError, "quota is exhausted") as raised:
                analyze_image(make_clean_plan(), client=client)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertEqual(client.models.calls, 1)
        sleep.assert_not_called()

    def test_retryable_rate_limit_still_honors_retry_after(self):
        client = SequenceClient([FakeAPIError(429, "Too many requests", "2"), result_for_plan()])
        with patch("gemini_floorplan.time.sleep") as sleep:
            analyze_image(make_clean_plan(), client=client)
        self.assertEqual(client.models.calls, 2)
        sleep.assert_called_once_with(2.0)

    def test_retryable_rate_limit_reads_google_retry_info(self):
        throttled = FakeAPIError(429, "Too many requests")
        throttled.details = {"error": {"details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "4s"}]}}
        client = SequenceClient([throttled, result_for_plan()])
        with patch("gemini_floorplan.time.sleep") as sleep:
            analyze_image(make_clean_plan(), client=client)
        self.assertEqual(client.models.calls, 2)
        sleep.assert_called_once_with(4.0)

    def test_analysis_endpoint_translates_quota_failure_to_actionable_429(self):
        with patch("main.stored_document", return_value=({"original_filename": "test.png"}, Path(__file__))), patch(
            "main.analyze_floorplan",
            side_effect=GeminiAnalysisError("Gemini quota is exhausted. Check the project quota or billing, then retry.", 429),
        ):
            with self.assertRaises(HTTPException) as raised:
                run_floorplan_analysis("building", "document", 1)
        self.assertEqual(raised.exception.status_code, 429)
        self.assertIn("quota is exhausted", raised.exception.detail)

    def test_permanent_auth_failure_is_not_retried(self):
        client = SequenceClient([FakeAPIError(403, "API key not valid")])
        with patch("gemini_floorplan.time.sleep") as sleep:
            with self.assertRaisesRegex(GeminiAnalysisError, "authentication failed"):
                analyze_image(make_clean_plan(), client=client)
        self.assertEqual(client.models.calls, 1)
        sleep.assert_not_called()

    def test_invalid_model_error_is_not_retried(self):
        client = SequenceClient([FakeAPIError(404, "model not found")])
        with patch("gemini_floorplan.time.sleep") as sleep:
            with self.assertRaisesRegex(GeminiAnalysisError, "configured Gemini model is unavailable"):
                analyze_image(make_clean_plan(), client=client)
        self.assertEqual(client.models.calls, 1)
        sleep.assert_not_called()

    def test_missing_backend_key_has_actionable_error(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(GeminiAnalysisError, "set GEMINI_API_KEY") as raised:
                analyze_image(make_clean_plan())
        self.assertEqual(raised.exception.status_code, 503)

    def test_large_source_uses_overlapping_tiles_and_maps_back_to_original(self):
        image = np.full((900, 5000, 3), 255, dtype=np.uint8)
        client = FakeClient(result_for_plan())
        analysis = analyze_image(image, client=client)
        # One downscaled overview plus 3 overlapping full-resolution tiles.
        self.assertGreater(len(client.models.calls), 1)
        self.assertEqual(len(client.models.calls), 4)
        for call in client.models.calls:
            sent_data = call["contents"][1].inline_data.data
            sent_image = cv2.imdecode(np.frombuffer(sent_data, dtype=np.uint8), cv2.IMREAD_COLOR)
            self.assertLessEqual(max(sent_image.shape[:2]), 2048)
        points = [point for candidate in analysis["candidates"] for point in candidate["polygon"]]
        self.assertTrue(points)
        self.assertTrue(all(0 <= point["x"] <= 1 and 0 <= point["y"] <= 1 for point in points))
        self.assertTrue(any(point["x"] > .5 for point in points))

    def test_2940_by_1912_upload_does_not_create_redundant_sliver_tiles(self):
        image = np.full((1912, 2940, 3), 255, dtype=np.uint8)
        client = FakeClient(result_for_plan())
        result = analyze_image(image, client=client)
        # One complete-page overview and two overlapping full-height detail tiles.
        self.assertEqual(len(client.models.calls), 3)
        tile_shapes = []
        for call in client.models.calls:
            data = call["contents"][1].inline_data.data
            tile = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
            tile_shapes.append(tile.shape[:2])
        self.assertEqual(tile_shapes[1:], [(1912, 2048), (1912, 1148)])
        self.assertTrue(all(0 <= point["x"] <= 1 and 0 <= point["y"] <= 1 for item in result["candidates"] for point in item["polygon"]))
        self.assertTrue(any(point["x"] > .6 for item in result["candidates"] for point in item["polygon"]))

    def test_expired_analysis_deadline_returns_504_without_another_model_call(self):
        client = SequenceClient([])
        with self.assertRaisesRegex(GeminiAnalysisError, "180-second time limit") as raised:
            _client_call(make_clean_plan(), "gemini-test-vision", client=client, deadline=0)
        self.assertEqual(raised.exception.status_code, 504)
        self.assertEqual(client.models.calls, 0)

    def test_large_source_merges_duplicate_candidates_from_overlapping_tiles(self):
        image = np.full((700, 2600, 3), 255, dtype=np.uint8)
        # The first and second response describe the same feature at source
        # x=1900..1980, represented relative to their own tile offsets.
        first = result_for_plan(candidates=[VisionCandidate(
            kind="room", polygon_xy=[.91, .2, .95, .2, .95, .35, .91, .35],
            label="Conference", confidence=.77, label_confidence=.92,
            uncertainty=[], label_is_readable=True, explicitly_marked_exit=False,
        )])
        second = result_for_plan(candidates=[VisionCandidate(
            kind="room", polygon_xy=[.0879, .2, .1894, .2, .1894, .35, .0879, .35],
            label="Conference", confidence=.89, label_confidence=.96,
            uncertainty=[], label_is_readable=True, explicitly_marked_exit=False,
        )])
        client = FakeClient(first)
        client.models = SequenceModels([result_for_plan(candidates=[]), first, second])
        analysis = analyze_image(image, client=client)
        matches = [item for item in analysis["candidates"] if item["label"] == "Conference"]
        self.assertEqual(len(matches), 1)
        self.assertAlmostEqual(matches[0]["polygon"][0]["x"], .91 * 2048 / 2600, delta=.01)
        self.assertEqual(matches[0]["confidence"], .89)

    def test_synthetic_office_pdf_maps_named_room_stairs_and_explicit_exit_from_tile(self):
        # Deterministic synthetic architectural PDF; feature geometry comes
        # only from the mocked model response, never a file-specific detector.
        doc = fitz.open()
        page = doc.new_page(width=1300, height=650)
        page.draw_rect(fitz.Rect(40, 40, 1260, 610), color=(.1, .1, .1), width=5)
        page.draw_line(fitz.Point(650, 40), fitz.Point(650, 610), color=(.1, .1, .1), width=4)
        page.insert_text(fitz.Point(170, 180), "Reception", fontsize=22)
        page.insert_text(fitz.Point(1000, 180), "Staircase", fontsize=22)
        page.insert_text(fitz.Point(1160, 560), "EXIT A", fontsize=22)
        pdf_data = doc.tobytes()
        doc.close()
        source = load_page(pdf_data, "synthetic-office.pdf", 1)
        width, height = source.shape[1], source.shape[0]
        # PDF raster is wider than one tile. Tile 2 begins at this source offset.
        x_offset = 1792
        office_tile = result_for_plan(candidates=[VisionCandidate(
            kind="room", polygon_xy=[.12, .12, .24, .12, .24, .3, .12, .3],
            label="Reception", confidence=.88, label_confidence=.94, uncertainty=[],
            label_is_readable=True, explicitly_marked_exit=False,
        )])
        far_tile = VisionResponse(
            outline_xy=[.02, .03, .98, .03, .98, .97, .02, .97],
            outline_confidence=.9, outline_uncertainty=[],
            candidates=[
                VisionCandidate(kind="stairs", polygon_xy=[.24, .2, .39, .2, .39, .4, .24, .4], label="Staircase", confidence=.81, label_confidence=.82, uncertainty=["stair edges require review"], label_is_readable=True, explicitly_marked_exit=False),
                VisionCandidate(kind="exit", polygon_xy=[.63, .8, .78, .8, .78, .91, .63, .91], label="EXIT A", confidence=.9, label_confidence=.98, uncertainty=[], label_is_readable=True, explicitly_marked_exit=True),
            ],
        )
        # Overview (used only for the global outline), then the office tile
        # and the tile containing the staircase and explicit exit label.
        overview = result_for_plan(candidates=[])
        client = FakeClient(overview)
        client.models = SequenceModels([overview, office_tile, far_tile])
        analyzed = analyze_image(source, client=client)
        by_label = {item["label"]: item for item in analyzed["candidates"]}
        self.assertEqual(set(by_label), {"Reception", "Staircase", "EXIT A"})
        self.assertEqual(by_label["Staircase"]["kind"], "stairs")
        self.assertEqual(by_label["EXIT A"]["kind"], "exit")
        self.assertTrue(by_label["EXIT A"]["label_is_readable"])
        exit_point = by_label["EXIT A"]["polygon"][0]
        # Feature was provided in tile-local coordinates and is mapped back to
        # the source page, rather than hardcoded in global coordinates.
        self.assertAlmostEqual(exit_point["x"], (x_offset + .63 * 808) / width, places=3)
        self.assertAlmostEqual(exit_point["y"], .8, places=3)
        self.assertEqual(source.shape[1], width)
        self.assertTrue(all(candidate["review_status"] == "candidate" for candidate in analyzed["candidates"]))

    def test_missing_model_features_stay_absent_without_invented_exit(self):
        response = result_for_plan(candidates=[])
        analysis = analyze_image(make_clean_plan(), client=FakeClient(response))
        self.assertEqual(analysis["candidates"], [])
        self.assertEqual(analysis["exits"], [])

    def test_candidate_polygons_reject_degenerate_and_out_of_bounds_geometry(self):
        with self.assertRaises(Exception):
            VisionCandidate(kind="room", polygon_xy=[.1, .1, .2, .2, .3, .3], label="Room", confidence=.8, label_confidence=.9, uncertainty=[], label_is_readable=True, explicitly_marked_exit=False)
        with self.assertRaises(Exception):
            VisionCandidate(kind="room", polygon_xy=[-.1, .1, .2, .1, .2, .2], label="Room", confidence=.8, label_confidence=.9, uncertainty=[], label_is_readable=True, explicitly_marked_exit=False)


class EvacuationGraphTests(unittest.TestCase):
    @staticmethod
    def route_fixture(reachable_exit_ids=("exit-near", "exit-far")):
        nodes = [
            {"id": "room", "type": "room", "label": "Reception", "bbox": {"x": .1, "y": .1, "width": .1, "height": .1}, "status": "unverified"},
            {"id": "door", "type": "door", "label": "Door", "bbox": {"x": .2, "y": .1, "width": .02, "height": .02}, "status": "unverified"},
            {"id": "corridor", "type": "corridor", "label": "Corridor", "bbox": {"x": .3, "y": .1, "width": .1, "height": .1}, "status": "unverified"},
            {"id": "exit-near", "type": "exit", "label": "EXIT A", "bbox": {"x": .5, "y": .1, "width": .02, "height": .02}, "status": "unverified"},
            {"id": "exit-far", "type": "exit", "label": "EXIT B", "bbox": {"x": .8, "y": .1, "width": .02, "height": .02}, "status": "unverified"},
        ]
        edges = [
            {"from": "room", "to": "door", "length": .1, "blocked": False},
            {"from": "door", "to": "corridor", "length": .1, "blocked": False},
        ]
        if "exit-near" in reachable_exit_ids:
            edges.append({"from": "corridor", "to": "exit-near", "length": .2, "blocked": False})
        if "exit-far" in reachable_exit_ids:
            edges.append({"from": "corridor", "to": "exit-far", "length": .6, "blocked": False})
        return {"version": GRAPH_VERSION, "nodes": nodes, "edges": edges, "adjacency": {}}

    def test_routes_include_each_reachable_explicit_exit_in_shortest_order(self):
        graph = self.route_fixture()
        result = evacuation_routes(graph, "room")
        routes = [result["nearest_exit"], *result["alternate_exits"]]
        self.assertEqual([route["exit_label"] for route in routes], ["EXIT A", "EXIT B"])
        self.assertLess(routes[0]["path_length"], routes[1]["path_length"])
        for route in routes:
            self.assertEqual(route["path_node_ids"][0], "room")
            self.assertEqual(route["path_node_ids"][-1], route["exit_id"])
            self.assertEqual(len(route["path_node_ids"]), len(set(route["path_node_ids"])))

    def test_route_reports_only_one_reachable_exit_or_none(self):
        one = evacuation_routes(self.route_fixture(("exit-near",)), "room")
        self.assertEqual(one["nearest_exit"]["exit_label"], "EXIT A")
        self.assertEqual(one["alternate_exits"], [])
        none = evacuation_routes(self.route_fixture(()), "room")
        self.assertIsNone(none["nearest_exit"])
        self.assertEqual(none["alternate_exits"], [])

    def test_invalid_edges_and_disconnected_room_do_not_create_routes(self):
        graph = self.route_fixture(("exit-near",))
        graph["nodes"].append({"id": "other-room", "type": "room", "label": "Office", "bbox": {"x": .2, "y": .4, "width": .1, "height": .1}, "status": "unverified"})
        graph["edges"].extend([
            {"from": "corridor", "to": "missing-node", "length": .01, "blocked": False},
            {"from": "corridor", "to": "other-room", "length": -2, "blocked": False},
            {"from": "other-room", "to": "other-room", "length": .1, "blocked": False},
        ])
        self.assertEqual(evacuation_routes(graph, "room")["nearest_exit"]["exit_label"], "EXIT A")
        self.assertIsNone(evacuation_routes(graph, "other-room")["nearest_exit"])

    def test_zero_elapsed_fire_reset_restores_the_saved_geometry_route(self):
        graph = self.route_fixture(("exit-near",))
        burning = propagate_fire(graph, "room", 20)
        self.assertIsNone(evacuation_routes(burning, "room")["nearest_exit"])
        reset = propagate_fire(burning, "room", 0)
        self.assertEqual(reset["nodes"][0]["status"], "safe")
        self.assertTrue(all(not edge["blocked"] for edge in reset["edges"]))
        self.assertEqual(evacuation_routes(reset, "room")["nearest_exit"]["exit_label"], "EXIT A")

    def test_rebuilding_after_passage_edit_recomputes_routes_from_new_geometry(self):
        analysis = graph_analysis(
            rooms=[reviewed_item("room", "Reception", {"x": .1, "y": .1, "width": .2, "height": .2})],
            corridors=[reviewed_item("corridor", "Main corridor", {"x": .29, "y": .1, "width": .2, "height": .2})],
            exits=[reviewed_item("exit", "EXIT A", {"x": .5, "y": .15, "width": .02, "height": .04})],
            doors=[reviewed_item("door", "Door", {"x": .28, "y": .15, "width": .03, "height": .05}), reviewed_item("exit-door", "Exit door", {"x": .485, "y": .15, "width": .04, "height": .05})],
        )
        connected = build_graph(analysis)
        self.assertEqual(evacuation_routes(connected, "room")["nearest_exit"]["exit_label"], "EXIT A")
        analysis["doors"] = [reviewed_item("door", "Edited door", {"x": .7, "y": .7, "width": .03, "height": .05}), reviewed_item("exit-door", "Exit door", {"x": .485, "y": .15, "width": .04, "height": .05})]
        rebuilt = build_graph(analysis)
        self.assertEqual(rebuilt["version"], GRAPH_VERSION)
        self.assertIsNone(evacuation_routes(rebuilt, "room")["nearest_exit"])

    def test_only_reviewed_connector_geometry_creates_room_to_corridor_route(self):
        for connector_kind in ("doors", "openings"):
            with self.subTest(connector=connector_kind):
                analysis = graph_analysis(
                    rooms=[reviewed_item("room-a", "Reception", {"x": .1, "y": .2, "width": .2, "height": .3})],
                    corridors=[reviewed_item("corridor-a", "Main corridor", {"x": .32, "y": .2, "width": .4, "height": .3})],
                    exits=[reviewed_item("exit-a", "EXIT A", {"x": .72, "y": .3, "width": .03, "height": .1})],
                    **{connector_kind: [reviewed_item("passage-a", "Door 1", {"x": .295, "y": .3, "width": .03, "height": .1})]},
                )
                graph = build_graph(analysis)
                route = evacuation_routes(graph, "room-a")["nearest_exit"]
                self.assertEqual(route["exit_label"], "EXIT A")
                self.assertEqual(route["path_node_ids"][0], "room-a")
                self.assertEqual(route["path_node_ids"][-1], "exit-a")
                self.assertTrue(all(edge["relation"] != "adjacent-area" for edge in graph["edges"]))
                self.assertFalse(graph["diagnostics"]["safety_claim"])

    def test_nearby_or_overlapping_rooms_do_not_connect_without_passage(self):
        analysis = graph_analysis(
            rooms=[
                reviewed_item("room-a", "Reception", {"x": .1, "y": .2, "width": .2, "height": .3}),
                reviewed_item("room-b", "Office", {"x": .29, "y": .2, "width": .2, "height": .3}),
            ],
            corridors=[reviewed_item("corridor", "Corridor", {"x": .5, "y": .2, "width": .3, "height": .3})],
            exits=[reviewed_item("exit", "EXIT A", {"x": .8, "y": .3, "width": .03, "height": .1})],
        )
        graph = build_graph(analysis)
        self.assertEqual(len(graph["edges"]), 1)  # The labeled exit touches the corridor.
        node_types = {node["id"]: node["type"] for node in graph["nodes"]}
        self.assertTrue(all(node_types[edge["from"]] != "room" and node_types[edge["to"]] != "room" for edge in graph["edges"]))
        self.assertEqual({item["label"] for item in graph["diagnostics"]["unreachable_rooms"]}, {"Reception", "Office"})
        self.assertEqual(len(graph["diagnostics"]["disconnected_nodes"]), 2)

    def test_unreachable_labeled_exit_and_unconnected_stair_are_reported(self):
        analysis = graph_analysis(
            rooms=[reviewed_item("room", "Room A", {"x": .1, "y": .2, "width": .2, "height": .3})],
            corridors=[reviewed_item("corridor", "Corridor", {"x": .32, "y": .2, "width": .3, "height": .3})],
            doors=[reviewed_item("door", "Door 1", {"x": .295, "y": .3, "width": .03, "height": .1})],
            stairs=[reviewed_item("stairs", "STAIR A", {"x": .64, "y": .2, "width": .1, "height": .3})],
            exits=[reviewed_item("exit", "EXIT WEST", {"x": .9, "y": .8, "width": .04, "height": .04})],
        )
        graph = build_graph(analysis)
        diagnostic = graph["diagnostics"]
        self.assertEqual([item["label"] for item in diagnostic["unreachable_rooms"]], ["Room A"])
        self.assertEqual([item["label"] for item in diagnostic["unreachable_exits"]], ["EXIT WEST"])
        self.assertIn("stairs", [item["type"] for item in diagnostic["disconnected_nodes"]])
        self.assertIn("exit", [item["type"] for item in diagnostic["disconnected_nodes"]])

    def test_systematic_office_review_uses_source_normalized_boxes_and_saved_passages(self):
        fixture = current_systematic_plan()
        if fixture is None:
            self.skipTest("The current uploaded systematic office PDF and review are unavailable in this workspace.")
        document_id, building_id, pdf_path, analysis, previous_graph = fixture
        source = load_page(pdf_path.read_bytes(), "exodus_test_office_floor_plan.pdf", 1)
        self.assertEqual((analysis["image_width"], analysis["image_height"]), (source.shape[1], source.shape[0]))
        self.assertIsNotNone(previous_graph)
        # This persisted graph predates the current graph version. Its edge
        # count can be zero after a prior regeneration or contain stale edges;
        # it must be rejected either way before routes are used.
        self.assertEqual(len(previous_graph["nodes"]), sum(len(analysis.get(key, [])) for key in ("rooms", "corridors", "doors", "openings", "stairs", "exits")))
        if previous_graph.get("version") != GRAPH_VERSION:
            with self.assertRaises(HTTPException) as stale_error:
                load_stored_graph(building_id, document_id, 1)
            self.assertEqual(stale_error.exception.status_code, 409)
        else:
            self.assertEqual(load_stored_graph(building_id, document_id, 1), previous_graph)
        self.assertEqual(len(analysis.get("doors", [])), 4)
        self.assertEqual(analysis.get("openings", []), [])

        graph = build_graph(analysis)
        self.assertEqual(len(graph["edges"]), 8)
        self.assertEqual(graph["diagnostics"]["component_count"], 15)
        reception = next(item for item in analysis["rooms"] if item["label"] == "RECEPTION")
        reception_routes = evacuation_routes(graph, reception["id"])
        self.assertEqual(reception_routes["nearest_exit"]["exit_label"], "EXIT E2 — WEST")
        self.assertEqual(reception_routes["alternate_exits"], [])
        # Exercise the same backend route handler used by the frontend, which
        # reads the graph persisted for this building/document/page.
        response = api.get_evacuation_route(building_id, document_id, api.RouteRequest(start_node_id=reception["id"]), 1)
        self.assertEqual(response["routes"]["nearest_exit"]["exit_label"], "EXIT E2 — WEST")
        self.assertEqual(response["routes"]["nearest_exit"]["path_node_ids"][0], reception["id"])
        reviewed = {item["id"]: item["bbox"] for key in ("rooms", "corridors", "doors", "openings", "stairs", "exits") for item in analysis.get(key, [])}
        self.assertEqual({node["id"]: node["bbox"] for node in graph["nodes"]}, reviewed)
        self.assertFalse(graph["diagnostics"]["safety_claim"])

    def test_systematic_office_with_reviewed_passages_connects_reception_to_explicit_exit(self):
        fixture = current_systematic_plan()
        if fixture is None:
            self.skipTest("The current uploaded systematic office PDF and review are unavailable in this workspace.")
        _, _, _, analysis, _ = fixture
        # The persisted doors are visibly marked on the uploaded synthetic
        # plan. Rebuild from that saved geometry rather than adding test-only
        # passage rectangles to a temporary analysis copy.
        analysis = dict(analysis)
        graph = build_graph(analysis)
        route = evacuation_routes(graph, analysis["rooms"][0]["id"])["nearest_exit"]
        self.assertIsNotNone(route)
        self.assertEqual(route["exit_label"], "EXIT E2 — WEST")
        self.assertEqual(len(graph["edges"]), 8)
        self.assertEqual(graph["diagnostics"]["component_count"], 15)
        self.assertFalse(graph["diagnostics"]["safety_claim"])
        # The reviewed geometry and graph are actually stored for the building.
        persisted = current_systematic_plan()
        self.assertEqual({door["id"] for door in persisted[3].get("doors", [])}, {door["id"] for door in analysis["doors"]})
        self.assertEqual(persisted[3].get("openings", []), [])
        self.assertEqual(len(persisted[4]["edges"]), 8)

    def test_passage_resolution_reports_exactly_two_regions_and_rejects_ambiguity(self):
        analysis = graph_analysis(
            rooms=[reviewed_item("room", "Reception", {"x": .1, "y": .1, "width": .2, "height": .2})],
            corridors=[reviewed_item("corridor", "Main corridor", {"x": .29, "y": .1, "width": .2, "height": .2})],
            stairs=[reviewed_item("stairs", "Stair A", {"x": .45, "y": .1, "width": .2, "height": .2})],
        )
        resolved = passage_connections(analysis, reviewed_item("door", "Door", {"x": .28, "y": .15, "width": .03, "height": .05}))
        self.assertTrue(resolved["valid"])
        self.assertEqual({region["label"] for region in resolved["connected_regions"]}, {"Reception", "Main corridor"})
        ambiguous = passage_connections(analysis, reviewed_item("wide", "Wide opening", {"x": .28, "y": .15, "width": .2, "height": .05}))
        self.assertFalse(ambiguous["valid"])
        self.assertIn("exactly two are required", ambiguous["reason"])
        corner_only = passage_connections(analysis, reviewed_item("corner", "Corner touch", {"x": .3, "y": .3, "width": .05, "height": .05}))
        self.assertFalse(corner_only["valid"])

    def test_reviewed_passages_add_edit_delete_and_persist(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "test.sqlite3"
            with patch.object(api, "DATABASE_PATH", database):
                api.initialize_database()
                with api.connect_db() as connection:
                    connection.execute("INSERT INTO buildings VALUES (?, ?, ?)", ("building", "Test", "now"))
                    connection.execute("INSERT INTO floor_documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ("document", "building", 0, "plan.png", "plan.png", "image/png", 1, "now"))
                    connection.execute("INSERT INTO floorplan_analyses VALUES (?, ?, ?, ?)", ("document", 1, json.dumps({"candidates": []}), "now"))
                def element(identifier, kind, label, box):
                    return api.ReviewedElement(id=identifier, type=kind, label=label, bbox=api.CropRegion(**box))
                room = element("room", "room", "Reception", {"x": .1, "y": .1, "width": .2, "height": .2})
                corridor = element("corridor", "corridor", "Main corridor", {"x": .29, "y": .1, "width": .2, "height": .2})
                door = element("door-1", "door", "Door 1", {"x": .28, "y": .15, "width": .03, "height": .05})
                def save(items):
                    api.save_floorplan_review("building", "document", api.AnalysisReview(elements=items), 1)
                    with api.connect_db() as connection:
                        stored = connection.execute("SELECT analysis_json FROM floorplan_analyses WHERE document_id='document'").fetchone()
                    return json.loads(stored[0])
                created = save([room, corridor, door])
                self.assertEqual(created["doors"][0]["label"], "Door 1")
                edited_door = element("door-1", "opening", "Edited opening", {"x": .275, "y": .15, "width": .04, "height": .05})
                edited = save([room, corridor, edited_door])
                self.assertEqual(edited["openings"][0]["label"], "Edited opening")
                self.assertEqual(len(build_graph(edited)["edges"]), 2)
                deleted = save([room, corridor])
                self.assertEqual(deleted["doors"], [])
                self.assertEqual(deleted["openings"], [])
                self.assertEqual(len(build_graph(deleted)["edges"]), 0)


if __name__ == "__main__":
    unittest.main()
