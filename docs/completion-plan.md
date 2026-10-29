# Warehouse integration completion plan (2026-10-29)

## Deployment finding
The deployment log supplied by the user built main at commit 711378e, not the integration branch. Static assets published; Pages Functions did not run because there were no routes. The Cloudflare Pages D1 binding is named `warehouse-db` and points to `warehouse-scph`. A binding alone does not create schema or implement endpoints.

## What has been committed
- Draft PR #1 carries the imported Workstream C sources.
- A connected /labels/ workflow stages parts, selects subsets, resolves IDs using the parts API and retains original generator/PDF formatting.
- The original 810KB generator remains untouched.
- A new Pages Function supplies GET /api/health, GET /api/me, GET /api/parts, GET /api/parts/:id and POST /api/parts/register using D1. Registration does not write stock.
- Cloudflare Access JWT signature, issuer, audience, expiration and editor allowlist are checked; no Access configuration means 503 (fail closed).
- `migrations/0001_parts_catalog.sql` is a proposed catalog migration. It has NOT been applied. Existing production tables have NOT been inspected; do not apply without comparing their schema.

## Remaining critical-path tasks
1. Resolve the map build: safely add three / drei / fiber / zustand dependencies and a consistent npm lockfile.
2. Reconcile Workstream C types (Row, ShelfBase, LocationWrite, etc.), response wrappers and shared UI APIs with Workstream B without replacing scanner implementations.
3. Implement or reconcile the map's location-par PATCH, unassigned parts search, affected shelf IDs, bounds conflicts, audit undo/redo and permissions.
4. Wire real D1 schema/endpoints for building/shelf/slot/location/stock/events after determining existing schema and confirming migration strategy. The current API is parts-catalog-only, so the 3D map cannot work against live data yet.
5. Fix label-workflow browser behavior and add tests for previous-ID revalidation, duplicate conflicts, partial retries, subset printing, exported columns, exact QR payload and print-size geometry.
6. Run npm ci, typecheck, tests, build and Playwright through the new PR CI, iterate until all pass, check 3D rendering/performance and original scan workflows.
7. Field-verify all warehouse room/opening measurements before presenting geometry as measured.

## Required operations before deployment
- Cloudflare Access application protection on the Pages domain.
- CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD configured with actual Access app audience.
- WAREHOUSE_EDITORS and WAREHOUSE_ADMINS with reviewed email allowlists.
- Preview/test D1 environment for the above operations; do not test writes on production.
- Explicit approval before touching production D1, deploying changes to production, or merging main.

## Verification
The current integration branch has NOT passed the required build/test gate. The user's successful Cloudflare log is from main, not this branch. Keep PR #1 in draft.
