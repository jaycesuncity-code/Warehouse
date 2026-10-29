# Workstream C — 3D map delivery notes

## Decisions
- B's repo wasn't attached, and B's chat stopped before delivering one. So `/map/` is built on the shared library and mock API already in this repo. Home, warehouse and employee pages are **placeholders**: keep B's real versions.
- Search goes through `GET /api/parts?q=` (cached per query) and drives the zoom: several shelves → floor, one shelf → shelf + front view, one slot → slot + part card, nothing → "No results".
- Undo/redo use the API's event undo; **redo = undoing the undo event**.
- The canvas renders on demand. It renders continuously only while walking or while search dots pulse.
- Walls are drawn 4" thick, centered on the zone edges.
- Fixed a shared bug: pressing Enter in `FtInInput` saved twice, and the second save came back as a false "changed by someone else". There's a test for it.

## Performance
Measured in headless Chromium with SwiftShader (CPU rendering, 2 cores), not a GPU:
- 300 shelves / 5,087 slots: 68 draw calls, 101,821 triangles
- layout load: 157–216 ms
- orbit: about 200–340 ms per frame; the 4-shelf demo runs at 76 ms per frame on the same renderer

Frame time on a real GPU hasn't been measured yet.

## Unverified in the building seed
- **All rooms and openings:** every one is `verified = false`.
- **Measurements to check:** STORAGE 125's width (12'-10" vs 12'-11 1/2"), the 16' wall height, and the man-door positions (±2").
- **Plan details to check:** the name of the room behind door 40, the loading dock's open sides, and 121's east side and stub wall.
- **Demo shelves:** contract §9 puts demo shelves B1 and F1 8" off their walls.

## Sync notes
1. **New** `PATCH /api/locations {part_id, slot_id, par_qty, version}` edits par only. The contract had no par edit. Added to the mock, the client and the tests.
2. The Unassigned list uses `GET /api/parts?unassigned=true` (a mock addition).
3. **Relied on:**
   - every write returns `event_id`
   - location writes return `affected_shelf_ids`
   - `409 slot_out_of_bounds` returns `slots[]`
   - layout slots carry `departments[]`
4. A's undo endpoint must accept an undo event (that's how redo works).
5. `FtInInput` Enter fix, listed under Decisions.
6. `seedPerfData` gets two more aisle regions (mock only).

## Files
**Added:**
- `map/index.html`
- `src/map/**` (App, main, store, actions, layoutOps, search, colors, presets, `scene/*`, `ui/*`, tests)
- `tests/e2e/map.spec.ts`
- `src/shared/ui/FtInInput.test.tsx`
- `README.md`
- `docs/map-notes.md`
- placeholders: `index.html`, `warehouse/`, `employee/`, `src/home/`, `src/warehouse/`, `src/employee/`

**Changed:**
- `src/shared/contract.ts`, `api.ts`, `mock/endpoints.ts`, `mock/index.ts` (the `PATCH /api/locations` addition and perf regions)
- `src/shared/ui/FtInInput.tsx` (the Enter fix)
- `src/map/geometry.ts` (formatting only)
