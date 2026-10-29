# Warehouse map integration notes

Updated 2026-10-29. This document describes the integrated application. The earlier Workstream C notes about replacement Home, Warehouse, and Employee placeholders are historical; those placeholders are not the application being delivered.

## Shared inventory and navigation

The 3D map and original scanner use the same [API client](../src/shared/api.ts), [contract](../src/shared/contract.ts), and backend inventory records. Normal production builds use the authenticated `/api` routes. Browser regression tests make an explicit demo build with local mock data and a visible demo banner; a production URL or stored preference cannot enable demo inventory.

- Scanner **Open 3D map** links include shelf, slot, and the canonical `part_id`. The map opens that part and its shelf front view. **Open in the scan app** returns through the scanner's `#/part/<part_id>` route.
- Search uses `GET /api/parts` and retrieves every matching page. Matches after the first 100 influence the floor, shelf, and slot focus. An older search stops updating the UI when a newer query supersedes it. Inventory changes invalidate cached part/search results.
- Shelf classifications are **Primary**, **Overstock**, and **Packout**. The inspector edits the shared shelf value and the layout list identifies nonprimary shelves. Packout storage uses ordinary shelves and slots; it does not create a second inventory system or an invented staging-room location.
- Issued-kit locations explain the return-count workflow and link to Packouts. Scanner quantity controls and map stock/add-part controls are withheld while the kit is issued. The backend also enforces that lock. Owned quantity, available warehouse quantity, and quantity in issued kits remain distinct.
- Existing shelves, bins, slots, dimensions, row elevations, part assignments, movement, stock counts, par levels, history, and undo/redo continue through the shared API. Redo reverses the undo event.

## Geometry editing and recovery

Floor, orbit, walk, and front views remain available, with mobile panels and a touch joystick. Camera initialization does not rerun during unrelated layout updates. The canvas renders on demand except during active movement or animated search indicators. Devices without WebGL receive an explanation and a link to the scanner.

Geometry changes use optimistic versions. A shelf-column or row change that would strand bins returns `409 slot_out_of_bounds` with the actual offending slot IDs, location codes, and reasons. Rejected requests do not alter shelf or slot state. Occupied-slot, overlap, stale-version, and offline retry dialogs preserve the original interactions.

Snapshot export/import is for geometry. Before any save, import rejects malformed record structures, missing bin arrays, duplicate record IDs, and unsupported snapshot versions. Import then replays validated API operations rather than replacing database state. Newly created rooms receive server IDs before openings and shelves are created; shelves receive server IDs before their bins are created. Retrying a partial import reuses identical already-created geometry. Failures are reported per item, including individual bins. A failed parent prevents new children from referencing an unsaved parent. Part identities, stock counts, and assignments are not replayed from the snapshot.

## Unverified building information

The seed keeps every room and opening marked `verified = false`. The map displays that status, and only admins can change the verification flag. This integration does not establish that any physical measurements are verified.

The earlier field-check items remain unresolved:

- STORAGE 125 width: 12′10″ versus 12′11½″.
- The nominal 16-foot wall height and man-door positions.
- The room name behind door 40, loading-dock open sides, and room 121's east side/stub wall.
- Demo shelves B1 and F1 use the documented 8-inch wall offset; that is demo geometry, not a field survey.

The displayed four-inch wall thickness is a rendering assumption. No testing in this integration verifies physical building measurements.

## Renderer dependency compatibility

`three` and `@types/three` are pinned to `0.182.0`. The stable `@react-three/fiber` release used here is `9.8.2`, and it constructs `THREE.Clock` internally. Three r183 introduced a constructor deprecation warning; the strict browser-console regression exposed that mismatch. The matching stable r182 runtime/types satisfy the declared Fiber, Drei, and three-stdlib peer ranges and preserve the APIs used by this map.

The Fiber v10 migration removes that clock API but is currently a prerelease. Upgrade the renderer and Three together after validating its changed frame-loop and camera contracts; do not silence console warnings to mask a version mismatch. See the official [Three Clock documentation](https://threejs.org/docs/pages/Clock.html) and [Fiber v10 migration guide](https://r3f.docs.pmnd.rs/next/migration/v10).

## Browser verification

The suite exercises rendered geometry at 390 × 844 and 1280 × 800, camera modes, touch movement, search focus, scanner/map roundtrips, shelf and slot editing, stock changes, occupied/overlap/bounds/version conflicts, undo/redo, viewer permissions, offline retry, issued-kit integration, and strict console/network checks. Scanner tests decode a real QR image through Chromium's fake-camera video stream and also cover no-camera, denied-camera, and keyboard-scanner paths. This verifies browser behavior; it is not a physical camera or printer certification.

The initial 2026-10-29 local integration run at `927d683` passed all **74 browser tests** in 4.3 minutes, including labels and packouts. Its remote CI run passed 72 and failed two walking assertions. Trace inspection showed that the timed diagonal path could slide along A1 and exit through the real door 35; remaining east of the wall was not a valid invariant for that path. The tests now move into known solid shelf/wall surfaces and retain precise body-radius collision assertions. A separate geometry test confirms that the actual doorway remains passable.

The traces also exposed a real first-entry plan-to-walk race: the walking controller could initialize the old orthographic camera while the new perspective camera remained outside the warehouse. The controller now initializes when the active camera object changes. A new browser regression first reproduced that failure, then checks the selected-shelf spawn and verifies that stock and unrelated layout refreshes do not teleport a walking user. The phone case also checks that its initial walking position lies inside a mapped room.

The current full suite contains **75 browser tests**, including the downloaded label PDF/scanner roundtrip, malformed-snapshot rejection before any save, and employee/packout retry regressions. Check PR #1 for the full remote result on the exact proposed commit. These browser results use the explicit demo build; the separate compiled-worker/D1 production-browser gate verifies authenticated live API behavior. Deployment settings still require environment verification. The initial full local log is `artifacts/release-e2e.log`, with test artifacts in `artifacts/release-e2e-results/`.

Run the standard Playwright setup and tests after `npm ci`:

```sh
npx playwright install --with-deps chromium
npm run test:e2e
```

The build and browser tests write to `artifacts/e2e-dist` and `artifacts/`, keeping demo test output separate from the production `dist/` build. `E2E_PORT` and `E2E_BUILD_DIR` allow independent local test runs. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects a compatible installed Chromium when the browser-download service is unavailable. The integration environment used Chromium 153, matching locked Playwright 1.63, after repeated installer downloads returned invalid archives. The executable itself is not part of the repository.

Screenshots are produced under `artifacts/screenshots/{390x844,1280x800}` and `artifacts/screens/`. They are evidence from generated demo fixtures, not production warehouse records.

## Performance evidence

The performance browser case loads 300 shelves and 5,100 slots. It verifies that instanced rendering stays below 150 draw calls and writes measured timings to `artifacts/perf.json`. The final integrated run recorded 68 draw calls and 102,001 triangles, with layout data loaded in 115 ms. Orbit frames averaged 87 ms (p95 210 ms), and plan frames averaged 77 ms (p95 184 ms). These software-renderer timings vary substantially with shared CPU load.

These timings use headless Chromium with SwiftShader CPU rendering. They establish fixture scale, render complexity, and reproducibility; frame rate on a warehouse device with a real GPU remains unverified. Database/search benchmarks are documented separately in [database-performance.md](database-performance.md).
