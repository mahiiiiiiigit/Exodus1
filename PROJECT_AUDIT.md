# Exodus — repository audit (based on the supplied ZIP)

## Architecture found
- **Frontend:** React 18, TypeScript, Vite, React Router, Three.js, `@react-three/fiber`, `@react-three/drei`.
- **Backend:** FastAPI, SQLite, OpenCV, PyMuPDF, Google GenAI SDK.
- **Main routes/pages:** `/`, `/simulator`, `/buildings/new`, `/buildings/:buildingId`.
- **Backend flow:** create building → upload floor documents → request Gemini analysis → review/save candidate geometry → generate graph → request route / propagate fire.
- **3D demo:** `frontend/src/components/BuildingViewer.tsx` calls `createMockFloorLayout(floor)`. Its rooms, corridors, stairs, and exits are authored in code, not derived from uploaded geometry.
- **Uploaded-plan workspace:** `frontend/src/pages/BuildingWorkspacePage.tsx` renders the original plan and graph overlays in 2D, with room/door/corridor/stair/exit review. Graph-based occupant playback is tied to graph paths.
- **Backend simulation endpoint:** `backend/main.py` `/simulate` calls `simulation.py`, which is explicitly described in the README as deterministic mock heuristics.

## Gaps against the requested product
1. No end-to-end pipeline currently converts a building-level upload (all floors) into a generated 3D model that faithfully matches the plan.
2. Clicking a floor in the 3D demo selects a predefined floor layout; it does not load that floor's uploaded plan geometry.
3. 2D reviewed candidate geometry and the mock 3D scene are separate data models. There is no verified geometry conversion from reviewed normalized plan coordinates to a full 3D scene.
4. The building-wide vertical topology is not established: stairs/lifts are not reliably linked between floors from review evidence.
5. Fire/smoke propagation and route logic operate on the reviewed graph, while the polished 3D scene has its own mock layout. These are not a single synchronized simulation pipeline.
6. Live Gemini analysis depends on project quota. The latest supplied Codex report confirmed HTTP 429 daily quota exhaustion; the API key/model request was reached, but analysis did not succeed.
7. Routes are only available when passage geometry creates real reviewed graph edges. The previously reported fixture graph had 19 nodes and 0 edges; all rooms/exits were disconnected. The app correctly should not animate a fake path in this state.
8. The repository ZIP contained dependencies (`frontend/node_modules`, `backend/.venv`), a `.env`, and a local SQLite database. These were removed from the handoff archive; dependencies are reinstalled from lock/requirements and secrets must be configured locally.

## Current status (honest)
The repository has meaningful components and tests, but it is **not yet an end-to-end implementation** of “upload multi-floor building plan → generate faithful 3D building/floors → select floor → run synchronized 3D fire/smoke/occupant evacuation simulation.” Three prompts can target the highest-impact integration work, but no one can honestly guarantee zero bugs or full architectural accuracy in one hour. The safest submission strategy is to deliver a coherent demo path with explicit validation and no invented safe routes.
