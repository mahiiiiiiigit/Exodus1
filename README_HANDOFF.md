# Exodus1 — Exodus project handoff

## What this repository currently contains
- React + TypeScript + Vite frontend, with a Three.js / React Three Fiber 3D demo simulator.
- FastAPI backend with building/document upload, SQLite persistence, Gemini-assisted floor-plan candidate analysis, geometry review, evacuation graph, route estimation, and fire/smoke propagation.
- Frontend and backend tests and environment template.

## Run locally (macOS)
Terminal 1:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Add GEMINI_API_KEY to backend/.env. Never commit this file.
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```
Terminal 2:
```bash
cd frontend
npm install
npm run dev
```
Open the Vite URL printed in Terminal 2. The frontend expects the backend at `http://127.0.0.1:8000` unless `VITE_API_BASE_URL` is configured.

## Important current limitations (do not mistake these for completed features)
1. The standalone `/simulator` uses a hard-coded/mock floor layout (`mockFloorLayout.ts`); it does not generate its 3D geometry from the uploaded plan.
2. The building workspace's uploaded-plan flow is primarily a 2D review + graph/hazard workflow. The reviewed geometry is not yet transformed into a complete, faithful multi-floor 3D building model.
3. Gemini returns unverified candidates and needs a working API key/quota. Quota exhaustion was recently confirmed as a live blocker; mocked tests do not prove live Gemini analysis.
4. Graph routes require reviewed passage/door connections. A graph with zero edges cannot produce evacuation paths; do not fabricate routes.
5. Cross-floor links between staircases/lifts, vertical navigation, and a fully integrated 3D fire/smoke/occupant simulation are not established end-to-end.
6. `/simulate` explicitly uses deterministic mock heuristics. Treat all simulation outputs as demonstration estimates, not safety advice or code-compliant evacuation planning.

## Credentials and runtime data
The original archive contained `backend/.env` and a local SQLite database. They were deliberately excluded from this handoff archive to avoid distributing secrets and local state. Put your own API key in `backend/.env` using `.env.example`. The empty runtime `backend/data/` and `backend/uploads/` directories are included and will be populated by the app.
