# Sun City Parts: home + Warehouse scan app

Internal parts and warehouse app for Sun City Plumbing & Heating, Inc. One Cloudflare Pages project, one Vite multi-page build
(React + TypeScript + Tailwind). This repo holds workstream B: the repo skeleton, the **home page**, the **Warehouse scan app**,
the **Employee placeholder**, and the shared client library with an in-browser **mock API** that implements the whole Shared Contract v2.

| Page                           | Path                                                    | Status                                                     |
| ------------------------------ | ------------------------------------------------------- | ---------------------------------------------------------- |
| Home (two big buttons)         | `/`                                                     | done                                                       |
| Warehouse scan app             | `/warehouse/` (`#/scan`, `#/search`, `#/part/<id>` ...) | done, runs on the mock API                                 |
| Demo labels (QR codes to scan) | `/warehouse/demo-labels.html`                           | done                                                       |
| Employee version               | `/employee/`                                            | "coming soon" placeholder                                  |
| 3D map                         | `/map/`                                                 | placeholder until workstream C replaces `src/map/main.tsx` |
| Label generator                | `/labels/`                                              | the existing HTML is moved here later, untouched           |

## Run it

```bash
npm install
npm run dev            # http://localhost:5173  (mock API, "DEMO DATA" badge)
npm run typecheck && npm test && npm run build
npm run test:e2e       # builds, serves the build, runs Playwright (needs a Chromium: npx playwright install chromium)
```

Scripts: `dev`, `dev:lan`, `dev:https`, `build`, `preview`, `typecheck`, `test`, `test:e2e`, `lint`, `format`.

### Demo tools (mock mode)

- Tap the **DEMO DATA** badge: switch role (viewer / editor / admin) and **Reset demo data**.
- Scan screen: **Simulate a scan** picker, and a link to `/warehouse/demo-labels.html`.
- Part screen: "Demo: make a version conflict" changes a count behind the screen's back.
- `?latency=0` in the URL makes the mock answer instantly. `window.__sc` exposes the API for poking around in the console.
- State lives in `localStorage` (the app still works if storage is blocked; state then lives in memory for the page).

## Testing the camera on a phone

Browsers only allow the camera on **HTTPS** (or `localhost`). Two ways:

1. **LAN with a self-signed certificate:** `npm run dev:https`, open the `https://<your-PC-ip>:5173/warehouse/` address Vite prints on the phone,
   accept the certificate warning. Open `/warehouse/demo-labels.html` on a monitor and scan it.
2. **Cloudflare Pages preview deploy** (real HTTPS, no warnings): see below.

Handheld (keyboard-wedge) scanners need nothing: the scan screen always listens for a label followed by Enter.
QR decoding uses the browser's `BarcodeDetector` when it exists, with the bundled `jsqr` decoder as fallback (Chrome on desktop/Linux, iOS Safari).

## Deploy to Cloudflare Pages

- Build command `npm run build`, output directory `dist` (also set in `wrangler.toml`).
- Put Cloudflare Access in front of the whole site (staff only).
- Preview: `npm run build && npx wrangler pages deploy dist`.

## Going live (real API instead of the mock)

Everything talks to one client, `src/shared/api.ts`. `src/shared/config.ts` holds `DEFAULT_MODE` (`'mock'`) and `API_BASE` (`/api`).

- Try it without changing code: add `?mode=live` to any page URL (remembered for the tab; `?mode=mock` switches back).
- For everyone: set `DEFAULT_MODE = 'live'`. The "DEMO DATA" badge and demo tools disappear; roles come from `GET /api/me`.

## Layout of the repo

```
index.html  warehouse/  employee/  map/        page shells (Vite inputs)
src/home  src/warehouse  src/employee  src/map  page code (B owns all but map)
src/shared/contract.ts   every Shared Contract v2 shape, error and endpoint
src/shared/api.ts        the one client (same methods in mock and live)
src/shared/config.ts     MODE / API_BASE
src/shared/units.ts      ft-in parse/format, survey-sheet <-> map, shelf (u,v) -> map, slot rectangles
src/shared/grid.ts       slot overlap / resize / free-size helpers (used by the mock rules and the UI)
src/shared/ids.ts        ID regexes, isPartId()
src/shared/mock/         in-browser mock: one file per endpoint group, rules.ts, state.ts, demo-data.ts
src/shared/ui/           header, buttons, toasts with Undo, chips, modal, ft-in input, session/role, DEMO badge
functions/ migrations/ seed/ docs/   workstream A (backend)
labels/                  the existing label generator goes here later
e2e/                     Playwright specs;  screenshots/  captured at 390x844 and 1280x800
```

### For workstream C (3D map)

Reuse `api`, `units`, `grid`, `contract` and `ui`. The mock already serves `GET /api/layout` (with ETag), shelf / slot create, patch,
resize, duplicate and delete, zones and openings (admin to write), events and undo. Add mock endpoints as new files under `src/shared/mock/endpoints/` and register
them in `router.ts`. Deep link from the scan app: `/map/?shelf=<shelf_id>&slot=<slot_id>`.

### Demo data

`src/shared/mock/demo-data.ts` is plain data: the zones and openings from contract section 9 (map inches), shelves A1, A2, B1, F1,
46 slots, 26 parts with fixed IDs. Workstream A generates `seed/demo.sql` from it.
