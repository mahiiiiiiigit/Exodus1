# Exodus API

FastAPI service for the Exodus evacuation simulator. `/simulate` currently uses deterministic mock heuristics; it is not a substitute for building-specific safety engineering or emergency procedures.

## Run locally

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Endpoints

- `GET /health` — returns `{"status":"ok"}`.
- `POST /simulate` — estimates an evacuation from an incident type, floor, occupant count, and fire location.
- `POST /buildings` — creates a persistent building record from `{"name":"..."}`.
- `POST /buildings/{building_id}/upload` — stores one or more PDF, PNG, JPG, or JPEG floor documents. Send repeated multipart `files` fields and a matching repeated `floor_numbers` field for each file.
- `GET /buildings` — lists persisted building metadata and uploaded floor documents.
- `GET /buildings/{building_id}` — gets one building by ID.
- `GET /buildings/{building_id}/documents/{document_id}` — downloads a stored source document.
- `GET /buildings/{building_id}/documents/{document_id}/source?page=1` — returns the original uploaded image or the selected PDF page rasterized directly from the PDF.
- `POST /buildings/{building_id}/documents/{document_id}/analyze?page=1` — analyzes a user-confirmed crop of that original page. The JSON body is `{"x":0.1,"y":0.1,"width":0.8,"height":0.8}` with normalized coordinates.
- `GET /buildings/{building_id}/documents/{document_id}/analysis?page=1` — returns the persisted analysis for a page.
- `PUT /buildings/{building_id}/documents/{document_id}/review?page=1` — saves reviewer-labeled elements with normalized crop coordinates. At least one labeled room and exit are required before graph generation.
- `POST /buildings/{building_id}/documents/{document_id}/graph?page=1` — stores a graph derived only from manually validated plan elements.
- `GET /buildings/{building_id}/documents/{document_id}/graph?page=1` — retrieves the stored graph.
- `POST /buildings/{building_id}/documents/{document_id}/route?page=1` — computes the nearest and alternate reachable exits for a start node.
- `POST /buildings/{building_id}/documents/{document_id}/fire?page=1` — advances fire and smoke propagation, updates node/edge statuses, and recalculates routes.

Building metadata is stored in `backend/data/exodus.sqlite3`. Uploaded source files are stored in `backend/uploads/{building_id}/`; these runtime data directories are ignored by Git. Each upload is limited to 50 MB.

Example request:

```json
{
  "incident_type": "fire",
  "floor": 4,
  "occupant_count": 36,
  "fire_location": "East breakout room"
}
```

The response includes `evacuation_time_seconds`, `people_saved`, `people_trapped`, `congestion_zones`, `safe_exits`, per-zone occupancy/status/risk, and a 0–100 `risk_score`. Invalid input returns FastAPI's standard `422` validation response.

CORS allows React development servers at `localhost` and `127.0.0.1` on ports 5173 and 3000.

Floor-plan analysis reads image bytes from the stored upload and rasterizes PDF pages with PyMuPDF. The workspace asks the reviewer to outline the drawing instead of guessing fixed crop coordinates. OpenCV contours are returned only as low-confidence, unclassified geometry hints; they are never labeled as rooms, doors, stairs, or exits. Those elements and all labels are added or corrected through manual review. Exit names are supplied by the reviewer and are never invented.

The evacuation graph is disabled until a reviewer validates at least one room and one labeled exit. Route lengths remain uncalibrated plan units; generated links are estimates and still need review against the plan. Fire updates use graph distance to propagate smoke/fire risk, mark dangerous connections as blocked, persist the graph, and return recalculated routes.
