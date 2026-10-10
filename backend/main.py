from __future__ import annotations

import sqlite3
import threading
import uuid
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Literal

from fastapi import Body, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from evacuation_graph import GRAPH_VERSION, build_graph, evacuation_routes, propagate_fire
from floorplan_analysis import analyze_floorplan, get_document_page_count, load_page, preview_data_url
from gemini_floorplan import GeminiAnalysisError
from schemas import SimulationRequest, SimulationResponse
from simulation import simulate

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
DATABASE_PATH = DATA_DIR / "exodus.sqlite3"
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@contextmanager
def connect_db() -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with connect_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS buildings (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS floor_documents (
                id TEXT PRIMARY KEY,
                building_id TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
                floor_number INTEGER NOT NULL,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_floor_documents_building
                ON floor_documents(building_id, floor_number);
            CREATE TABLE IF NOT EXISTS floorplan_analyses (
                document_id TEXT NOT NULL REFERENCES floor_documents(id) ON DELETE CASCADE,
                page_number INTEGER NOT NULL,
                analysis_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (document_id, page_number)
            );
            CREATE TABLE IF NOT EXISTS evacuation_graphs (
                document_id TEXT NOT NULL REFERENCES floor_documents(id) ON DELETE CASCADE,
                page_number INTEGER NOT NULL,
                graph_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (document_id, page_number)
            );
            """
        )


initialize_database()


class BuildingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class RouteRequest(BaseModel):
    start_node_id: str


class FirePropagationRequest(BaseModel):
    fire_node_id: str
    start_node_id: str
    elapsed_seconds: float = Field(ge=0, le=600)
    intensity: float = Field(default=1.0, ge=0.2, le=2.0)
    smoke_density: float = Field(default=1.0, ge=0.2, le=2.0)


class CropRegion(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class ReviewPoint(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class ReviewedElement(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    type: Literal["room", "wall", "unknown", "corridor", "door", "opening", "stairs", "exit"]
    label: str = Field(min_length=1, max_length=120)
    bbox: CropRegion
    polygon: list[ReviewPoint] | None = None


class AnalysisReview(BaseModel):
    elements: list[ReviewedElement]
    rejected_candidate_ids: list[str] = Field(default_factory=list)


app = FastAPI(title="Exodus API", version="0.3.0")
_analysis_requests_lock = threading.Lock()
_active_analysis_requests: set[tuple[str, str, int]] = set()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174", "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def document_response(row: sqlite3.Row, building_id: str) -> dict:
    return {
        "id": row["id"], "floor_number": row["floor_number"],
        "filename": row["original_filename"], "content_type": row["content_type"],
        "size_bytes": row["size_bytes"], "url": f"/buildings/{building_id}/documents/{row['id']}",
        "uploaded_at": row["created_at"],
    }


def building_response(connection: sqlite3.Connection, building: sqlite3.Row) -> dict:
    documents = connection.execute(
        "SELECT * FROM floor_documents WHERE building_id = ? ORDER BY floor_number, created_at",
        (building["id"],),
    ).fetchall()
    floor_map: dict[int, list[dict]] = {}
    for document in documents:
        floor_map.setdefault(document["floor_number"], []).append(document_response(document, building["id"]))
    return {
        "id": building["id"], "name": building["name"], "number_of_floors": len(floor_map),
        "created_at": building["created_at"],
        "floors": [{"floor_number": number, "documents": entries} for number, entries in sorted(floor_map.items())],
    }


@app.get("/health", tags=["health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/buildings", status_code=201, tags=["buildings"])
def create_building(payload: BuildingCreate) -> dict:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Building name cannot be blank.")
    building_id = str(uuid.uuid4())
    created_at = datetime.now(timezone.utc).isoformat()
    with connect_db() as connection:
        connection.execute("INSERT INTO buildings VALUES (?, ?, ?)", (building_id, name, created_at))
        row = connection.execute("SELECT * FROM buildings WHERE id = ?", (building_id,)).fetchone()
        return building_response(connection, row)


@app.post("/buildings/{building_id}/upload", status_code=201, tags=["buildings"])
async def upload_floor_documents(
    building_id: str,
    files: list[UploadFile] = File(...),
    floor_numbers: list[int] = Form(...),
) -> dict:
    if not files:
        raise HTTPException(status_code=400, detail="Select at least one floor document.")
    if len(files) != len(floor_numbers):
        raise HTTPException(status_code=422, detail="Provide one floor number for each document.")
    if any(number < 0 for number in floor_numbers):
        raise HTTPException(status_code=422, detail="Floor numbers must be zero or greater.")
    for upload in files:
        if Path(upload.filename or "").suffix.lower() not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=415, detail=f"Unsupported file type for {upload.filename}. Use PDF, PNG, or JPG.")
    with connect_db() as connection:
        exists = connection.execute("SELECT 1 FROM buildings WHERE id = ?", (building_id,)).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail="Building not found.")

    directory = UPLOAD_DIR / building_id
    directory.mkdir(parents=True, exist_ok=True)
    staged: list[tuple[str, int, str, str, str, int]] = []
    saved_paths: list[Path] = []
    try:
        for upload, floor_number in zip(files, floor_numbers):
            document_id = str(uuid.uuid4())
            extension = Path(upload.filename or "floor-plan").suffix.lower()
            stored_name = f"{document_id}{extension}"
            destination = directory / stored_name
            size = 0
            with destination.open("wb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail=f"{upload.filename} exceeds the 50 MB limit.")
                    target.write(chunk)
            saved_paths.append(destination)
            staged.append((document_id, floor_number, upload.filename or stored_name, stored_name, upload.content_type or "application/octet-stream", size))
        uploaded_at = datetime.now(timezone.utc).isoformat()
        with connect_db() as connection:
            for entry in staged:
                connection.execute(
                    """INSERT INTO floor_documents
                    (id, building_id, floor_number, original_filename, stored_filename, content_type, size_bytes, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (entry[0], building_id, entry[1], entry[2], entry[3], entry[4], entry[5], uploaded_at),
                )
            building = connection.execute("SELECT * FROM buildings WHERE id = ?", (building_id,)).fetchone()
            return building_response(connection, building)
    except Exception:
        for path in saved_paths:
            path.unlink(missing_ok=True)
        raise
    finally:
        for upload in files:
            await upload.close()


@app.get("/buildings", tags=["buildings"])
def get_buildings() -> list[dict]:
    with connect_db() as connection:
        rows = connection.execute("SELECT * FROM buildings ORDER BY created_at DESC").fetchall()
        return [building_response(connection, row) for row in rows]


@app.get("/buildings/{building_id}", tags=["buildings"])
def get_building(building_id: str) -> dict:
    with connect_db() as connection:
        row = connection.execute("SELECT * FROM buildings WHERE id = ?", (building_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Building not found.")
        return building_response(connection, row)


@app.get("/buildings/{building_id}/documents/{document_id}", tags=["buildings"])
def get_floor_document(building_id: str, document_id: str) -> FileResponse:
    with connect_db() as connection:
        row = connection.execute(
            "SELECT * FROM floor_documents WHERE id = ? AND building_id = ?", (document_id, building_id)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Floor document not found.")
    path = UPLOAD_DIR / building_id / row["stored_filename"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored floor document is missing.")
    return FileResponse(path, media_type=row["content_type"], filename=row["original_filename"])


def stored_document(building_id: str, document_id: str) -> tuple[sqlite3.Row, Path]:
    with connect_db() as connection:
        row = connection.execute(
            "SELECT * FROM floor_documents WHERE id = ? AND building_id = ?", (document_id, building_id)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Floor document not found.")
    path = UPLOAD_DIR / building_id / row["stored_filename"]
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Stored floor document is missing.")
    return row, path


@app.get("/buildings/{building_id}/documents/{document_id}/source", tags=["floor-plan analysis"])
def get_floorplan_source(building_id: str, document_id: str, page: int = 1) -> dict:
    row, path = stored_document(building_id, document_id)
    try:
        data = path.read_bytes()
        page_count = get_document_page_count(data, row["original_filename"])
        image = load_page(data, row["original_filename"], page)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    height, width = image.shape[:2]
    return {
        "image_width": width,
        "image_height": height,
        "image_data_url": preview_data_url(image),
        "page_count": page_count,
        "page_number": page,
    }


def analyze_stored_document(building_id: str, document_id: str, page_number: int) -> dict:
    if page_number < 1:
        raise HTTPException(status_code=422, detail="Page numbers start at 1.")
    try:
        row, path = stored_document(building_id, document_id)
        result = analyze_floorplan(path.read_bytes(), row["original_filename"], page_number)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except GeminiAnalysisError as error:
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    result["document_id"] = document_id
    result["analyzed_at"] = datetime.now(timezone.utc).isoformat()
    stored_result = {key: value for key, value in result.items() if key != "preview_data_url"}
    with connect_db() as connection:
        connection.execute(
            """INSERT INTO floorplan_analyses (document_id, page_number, analysis_json, created_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(document_id, page_number) DO UPDATE SET
            analysis_json = excluded.analysis_json, created_at = excluded.created_at""",
            (document_id, page_number, json.dumps(stored_result), result["analyzed_at"]),
        )
        connection.execute("DELETE FROM evacuation_graphs WHERE document_id = ? AND page_number = ?", (document_id, page_number))
    return result


@app.post("/buildings/{building_id}/documents/{document_id}/analyze", tags=["floor-plan analysis"])
def run_floorplan_analysis(building_id: str, document_id: str, page: int = 1, legacy_crop: CropRegion | None = Body(default=None)) -> dict:
    """Analyze the entire original upload. The legacy crop body is ignored."""
    request_key = (building_id, document_id, page)
    with _analysis_requests_lock:
        if request_key in _active_analysis_requests:
            raise HTTPException(status_code=409, detail="Analysis is already running for this floor and page. Wait for it to finish.")
        _active_analysis_requests.add(request_key)
    try:
        return analyze_stored_document(building_id, document_id, page)
    finally:
        with _analysis_requests_lock:
            _active_analysis_requests.discard(request_key)


@app.post("/buildings/{building_id}/documents/{document_id}/initialize-manual-review", tags=["floor-plan analysis"])
def initialize_manual_review(building_id: str, document_id: str, page: int = 1) -> dict:
    """Initialize a blank floor-plan review canvas without calling Gemini."""
    if page < 1:
        raise HTTPException(status_code=422, detail="Page numbers start at 1.")
    try:
        row, path = stored_document(building_id, document_id)
        data = path.read_bytes()
        page_count = get_document_page_count(data, row["original_filename"])
        source = load_page(data, row["original_filename"], page)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    height, width = source.shape[:2]
    now = datetime.now(timezone.utc).isoformat()
    result = {
        "model": "manual",
        "candidates": [],
        "elements": [],
        "geometric_candidates": [],
        "openings": [],
        "outline": [],
        "outline_confidence": 1.0,
        "outline_uncertainty": [],
        "page_number": page,
        "page_count": page_count,
        "image_width": width,
        "image_height": height,
        "source_crop": {"x": 0, "y": 0, "width": 1, "height": 1},
        "validated": False,
        "preview_data_url": preview_data_url(source),
        "method": "Manual floor-plan review (no AI required)",
        "review_notice": "Manual review mode active. Draw and label rooms, corridors, doors, and exits directly on your floor plan.",
        "warnings": ["Manual mode initialized. Draw and label at least one room and one exit to enable 3D building generation and evacuation routing."],
        "document_id": document_id,
        "analyzed_at": now,
        "outer_walls": [],
        "rooms": [],
        "corridors": [],
        "doors": [],
        "stairs": [],
        "exits": [],
    }
    stored_result = {key: value for key, value in result.items() if key != "preview_data_url"}
    with connect_db() as connection:
        connection.execute(
            """INSERT INTO floorplan_analyses (document_id, page_number, analysis_json, created_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(document_id, page_number) DO UPDATE SET
            analysis_json = excluded.analysis_json, created_at = excluded.created_at""",
            (document_id, page, json.dumps(stored_result), now),
        )
        connection.execute("DELETE FROM evacuation_graphs WHERE document_id = ? AND page_number = ?", (document_id, page))
    return result


@app.put("/buildings/{building_id}/documents/{document_id}/review", tags=["floor-plan analysis"])
def save_floorplan_review(building_id: str, document_id: str, review: AnalysisReview, page: int = 1) -> dict:
    with connect_db() as connection:
        document = connection.execute("SELECT 1 FROM floor_documents WHERE id = ? AND building_id = ?", (document_id, building_id)).fetchone()
        stored = connection.execute("SELECT analysis_json FROM floorplan_analyses WHERE document_id = ? AND page_number = ?", (document_id, page)).fetchone()
        if not document:
            raise HTTPException(status_code=404, detail="Floor document not found.")
        if not stored:
            raise HTTPException(status_code=404, detail="Analyze the complete uploaded page before reviewing detections.")
        analysis = json.loads(stored["analysis_json"])
        if any(not item.label.strip() for item in review.elements):
            raise HTTPException(status_code=422, detail="Every reviewed room or feature needs a name from the plan.")
        elements = [item.model_dump() | {"label": item.label.strip(), "confidence": 1.0, "review_status": "confirmed"} for item in review.elements]
        for element in elements:
            b = element["bbox"]
            if b["x"] + b["width"] > 1 or b["y"] + b["height"] > 1:
                raise HTTPException(status_code=422, detail="Reviewed elements must fit inside the confirmed plan region.")
        analysis["elements"] = elements
        accepted_ids = {item["id"] for item in elements}
        known_ids = {item.get("id") for item in analysis.get("candidates", [])}
        if not set(review.rejected_candidate_ids).issubset(known_ids):
            raise HTTPException(status_code=422, detail="Rejected candidate IDs must come from this analysis.")
        for candidate in analysis.get("candidates", []):
            if candidate["id"] in accepted_ids:
                candidate["review_status"] = "confirmed"
            elif candidate["id"] in review.rejected_candidate_ids:
                candidate["review_status"] = "rejected"
        reviewed_types = {item["type"] for item in elements}
        analysis["validated"] = "room" in reviewed_types and "exit" in reviewed_types
        # Build semantic collections only from explicitly reviewed elements.
        category_types = {"outer_walls": "wall", "rooms": "room", "corridors": "corridor", "doors": "door", "openings": "opening", "stairs": "stairs", "exits": "exit"}
        for collection, kind in category_types.items():
            analysis[collection] = [{"id": item["id"], "label": item["label"], "bbox": item["bbox"], "polygon": item.get("polygon"), "confidence": 1.0, "review_status": "confirmed"} for item in elements if item["type"] == kind]
        connection.execute("UPDATE floorplan_analyses SET analysis_json = ?, created_at = ? WHERE document_id = ? AND page_number = ?", (json.dumps(analysis), datetime.now(timezone.utc).isoformat(), document_id, page))
        connection.execute("DELETE FROM evacuation_graphs WHERE document_id = ? AND page_number = ?", (document_id, page))
    return {
        "validated": analysis["validated"],
        "elements": elements,
        "candidates": analysis.get("candidates", []),
        "warning": None if analysis["validated"] else "Add and label at least one room and one exit before generating an evacuation graph.",
    }


@app.get("/buildings/{building_id}/documents/{document_id}/analysis", tags=["floor-plan analysis"])
def get_floorplan_analysis(building_id: str, document_id: str, page: int = 1) -> dict:
    with connect_db() as connection:
        result_row = connection.execute(
            """SELECT analysis_json FROM floorplan_analyses
            WHERE document_id = ? AND page_number = ?""", (document_id, page)
        ).fetchone()
        document_row = connection.execute(
            "SELECT * FROM floor_documents WHERE id = ? AND building_id = ?", (document_id, building_id)
        ).fetchone()
    if result_row is None:
        raise HTTPException(status_code=404, detail="This document page has not been analyzed yet.")
    if document_row is None:
        raise HTTPException(status_code=404, detail="Floor document not found.")
    path = UPLOAD_DIR / building_id / document_row["stored_filename"]
    try:
        result = json.loads(result_row["analysis_json"])
        data = path.read_bytes()
        source = load_page(data, document_row["original_filename"], page)
        preview = preview_data_url(source)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    result["preview_data_url"] = preview
    result["page_count"] = get_document_page_count(data, document_row["original_filename"])
    result["page_number"] = page
    had_candidate_collection = "candidates" in result
    result.setdefault("validated", False)
    result.setdefault("elements", [])
    result.setdefault("geometric_candidates", [])
    result.setdefault("candidates", [])
    result.setdefault("openings", [])
    result.setdefault("outline", [])
    result.setdefault("warnings", [])
    if not result.get("model") or not had_candidate_collection:
        result["validated"] = False
        result["elements"] = []
        for category in ("outer_walls", "rooms", "corridors", "doors", "openings", "stairs", "exits"):
            result[category] = []
        result["warnings"] = ["This saved analysis predates full-image Gemini review. Reanalyze the original upload before reviewing or generating a graph."]
    return result


def load_stored_graph(building_id: str, document_id: str, page_number: int) -> dict:
    with connect_db() as connection:
        document = connection.execute(
            "SELECT id FROM floor_documents WHERE id = ? AND building_id = ?", (document_id, building_id)
        ).fetchone()
        stored = connection.execute(
            "SELECT graph_json FROM evacuation_graphs WHERE document_id = ? AND page_number = ?",
            (document_id, page_number),
        ).fetchone()
    if document is None:
        raise HTTPException(status_code=404, detail="Floor document not found.")
    if stored is None:
        raise HTTPException(status_code=404, detail="Generate an evacuation graph for this plan first.")
    graph = json.loads(stored["graph_json"])
    if graph.get("version") != GRAPH_VERSION:
        raise HTTPException(status_code=409, detail="This saved graph was built with an older geometry algorithm. Regenerate it from the latest saved review before using routes.")
    return graph


def save_graph(document_id: str, page_number: int, graph: dict) -> str:
    updated_at = datetime.now(timezone.utc).isoformat()
    with connect_db() as connection:
        connection.execute(
            """INSERT INTO evacuation_graphs (document_id, page_number, graph_json, updated_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(document_id, page_number) DO UPDATE SET
            graph_json = excluded.graph_json, updated_at = excluded.updated_at""",
            (document_id, page_number, json.dumps(graph), updated_at),
        )
    return updated_at


@app.post("/buildings/{building_id}/documents/{document_id}/graph", tags=["evacuation graph"])
def create_evacuation_graph(building_id: str, document_id: str, page: int = 1) -> dict:
    with connect_db() as connection:
        row = connection.execute(
            """SELECT a.analysis_json FROM floorplan_analyses a
            JOIN floor_documents d ON d.id = a.document_id
            WHERE d.building_id = ? AND a.document_id = ? AND a.page_number = ?""", (building_id, document_id, page)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Analyze this plan page before generating its graph.")
    analysis = json.loads(row["analysis_json"])
    if not analysis.get("validated"):
        raise HTTPException(status_code=409, detail="Review and validate rooms, doors, stairs, and exits before generating routes.")
    graph = build_graph(analysis)
    start = next((node["id"] for node in graph["nodes"] if node["type"] == "room"), None)
    if start is None:
        start = next((node["id"] for node in graph["nodes"] if node["type"] in {"corridor", "stairs"}), "")
    updated_at = save_graph(document_id, page, graph)
    return {"graph": graph, "routes": evacuation_routes(graph, start) if start else None, "diagnostics": graph["diagnostics"], "updated_at": updated_at}


@app.get("/buildings/{building_id}/documents/{document_id}/graph", tags=["evacuation graph"])
def get_evacuation_graph(building_id: str, document_id: str, page: int = 1) -> dict:
    with connect_db() as connection:
        analysis_row = connection.execute("SELECT analysis_json FROM floorplan_analyses WHERE document_id = ? AND page_number = ?", (document_id, page)).fetchone()
    if not analysis_row or not json.loads(analysis_row["analysis_json"]).get("validated"):
        raise HTTPException(status_code=409, detail="Review and validate this floor plan before loading evacuation routes.")
    graph = load_stored_graph(building_id, document_id, page)
    with connect_db() as connection:
        record = connection.execute(
            "SELECT updated_at FROM evacuation_graphs WHERE document_id = ? AND page_number = ?",
            (document_id, page),
        ).fetchone()
    return {"graph": graph, "updated_at": record["updated_at"] if record else None}


@app.post("/buildings/{building_id}/documents/{document_id}/route", tags=["evacuation graph"])
def get_evacuation_route(building_id: str, document_id: str, payload: RouteRequest, page: int = 1) -> dict:
    graph = load_stored_graph(building_id, document_id, page)
    return {"graph": graph, "routes": evacuation_routes(graph, payload.start_node_id)}


@app.post("/buildings/{building_id}/documents/{document_id}/fire", tags=["fire propagation"])
def update_fire_propagation(building_id: str, document_id: str, payload: FirePropagationRequest, page: int = 1) -> dict:
    graph = load_stored_graph(building_id, document_id, page)
    try:
        updated = propagate_fire(graph, payload.fire_node_id, payload.elapsed_seconds, payload.intensity, payload.smoke_density)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    routes = evacuation_routes(updated, payload.start_node_id)
    updated_at = save_graph(document_id, page, updated)
    return {"graph": updated, "routes": routes, "updated_at": updated_at}


@app.post("/simulate", response_model=SimulationResponse, tags=["simulation"])
def run_simulation(request: SimulationRequest) -> SimulationResponse:
    """Run a deterministic mock evacuation estimate for a building incident."""
    return simulate(request)
