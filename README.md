# Sun City Warehouse

Sun City Plumbing & Heating's inventory, QR scanner, 3D warehouse map, labels, employee inventory and packout application. One React/TypeScript frontend, one shared API contract, one Cloudflare Pages Function and one relational D1 stock ledger.

## Application routes

| Route | Function |
| --- | --- |
| `/` | Home and navigation |
| `/warehouse/` | Camera/keyboard QR scanning, part search, counts, locations, moves, par levels and history |
| `/map/` | Interactive floor/shelf/front views, shelves, bins, dimensions, part assignments, search and geometry editing |
| `/labels/` | Manual/paste/CSV/Excel staging, review, selected registration, existing-part reprints, PDF preview/download/print and export |
| `/packouts/` | Employees, kit staging, replenishment, issue, counted returns, consumption reconciliation and audit/undo |
| `/equipment/` | Individually tracked equipment orders, scanning/receiving, customer/PO lookup, Avery 5821 labels, review and permissions |
| `/employee/` | Employee part lookup/scanning and their issued kits |
| `/warehouse/demo-labels.html` | Clearly identified demonstration QR labels; these are not real inventory |

The original standalone label generator remains unchanged at [labels/bin-label-generator.html](labels/bin-label-generator.html). Historical workstream ZIPs and handoffs remain available as project history; this README and the implementation checkpoint describe the integrated source.

## Install and verify

Use Node 22 (CI uses Node 22) and the committed npm lockfile.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run build:functions
npx playwright install --with-deps chromium
npm run test:live -- --browser
npm run test:e2e
```

`test:live` compiles and runs the actual Pages Function in workerd/Miniflare against a new isolated D1 database with all migrations. Authentication uses generated, signed test JWTs and a fixture certificate service; the application has no authentication bypass. `--browser` also exercises the production frontend against this API. It requires a preceding `npm run build`.

`test:e2e` builds an explicit demo frontend under `artifacts/e2e-dist`, leaving the production `dist` separate. Tests exercise desktop/mobile scanner, map, labels and packout workflows. Standard Playwright Chromium is the default. A compatible preinstalled Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; `E2E_PORT` and `E2E_BUILD_DIR` support isolated runs.

The single [integration workflow](.github/workflows/integration-checks.yml) verifies PRs into main, pushes to main, and manual runs. Newer runs cancel superseded runs on the same ref. It does not deploy or migrate a remote database.

## Development and real inventory

```bash
npm run dev
```

Development uses explicitly marked **DEMO DATA**, saved in browser localStorage. Demo roles and resets are available through the demo badge. They never modify D1.

A normal `npm run build` uses the authenticated live API at `/api`. An old browser preference or `?mode=mock` cannot switch that production build to demo inventory. Only a deliberate `VITE_DATA_MODE=mock` build enables demo overrides. Do not set that value in a real-inventory deployment. Failed live requests stay errors; they do not silently fall back to demo data.

For phone-camera development, use `npm run dev:https` on a trusted local network, or an authorized HTTPS preview. Camera scanning requires HTTPS or localhost. Keyboard-wedge scanners submit the same canonical part ID followed by Enter. Native BarcodeDetector has a bundled jsQR fallback.

## Inventory and kit accounting

Canonical part IDs are issued or confirmed by the backend. QR payloads are exactly `part_id`. Registering or printing labels does not change stock, and generating labels never registers unselected rows.

All quantities are stored in `stock` by part and storage slot. Shelves have Primary, Overstock or Packout location types. A kit uses an existing bin on a Packout shelf; create or select this staging location on the map first.

- Replenishment transfers stock from another location to the kit.
- Issue records employee custody and the issued quantities. It does not consume the contents.
- Issued contents remain owned stock but are excluded from available warehouse quantity.
- Return requires a count for every issued part, retains the remaining stock, and records the difference as consumption.
- Generic stock/geometry edits cannot change or delete an issued kit's contents.
- History and version-checked undo/redo use the shared transaction and audit model.

Employee records support kit custody and inventory access. The app does not implement unrelated HR or attendance functions.

## Persistence and security

`functions/api/[[path]].ts` dispatches the canonical routes. The literal D1 runtime binding is **`warehouse-db`**, independent of the database display name.

The live and demo transports share domain rules under `src/shared/mock/`; the historical directory name does not mean the live API uses an in-memory inventory. Live requests load relational data from D1 and commit changed rows, audit history and idempotency receipts in the same revision-guarded transaction.

Access JWT signatures, issuer, audience and validity are checked on the server. Verified identity determines the viewer/editor/admin role. Viewers can read; editors manage inventory and kits; admins also manage building zones/openings and permitted conflict overrides. Frontend role controls are not the security boundary.

See [security](docs/security.md), [database correctness and measured performance](docs/database-performance.md), [label workflow/print verification](docs/labels.md), and [equipment rollout](docs/equipment.md).

## Deployment and release status

Cloudflare Pages build command: **`npm run build`**. Build output: **`dist`**. Pages Functions remain in the repository's `functions/` directory.

The checked-in `wrangler.toml` is intentionally **local-only**. It does not opt into replacing the remote Pages project's dashboard bindings with an unverified configuration. Production database IDs, Access audience and role lists are not fabricated or committed.

Read [deployment configuration and isolation](docs/deployment.md) and [the current implementation checkpoint](docs/implementation-checkpoint.md) before release. A merge, production deployment or production migration requires authorization. A green local suite alone does not verify the actual Cloudflare environment.

Warehouse geometry is visibly **unverified** until field-checked. PDF dimensions and scanner roundtrips can be tested digitally; physical printer calibration still requires a real print at 100%/Actual Size.
