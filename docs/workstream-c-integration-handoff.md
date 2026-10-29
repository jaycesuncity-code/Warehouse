# Workstream C 3D map integration handoff

Repo: `jaycesuncity-code/Warehouse`
Base: `main` after commit `711378ea69a0e2823e8684a88ed9232925da9ef9`
Integration branch: `integration/workstream-c-3d-map`
Archive: `handoffs/workstream-c-original.zip` (the complete, unchanged Workstream C ZIP).

## Import status

The feature branch contains all new, non-colliding Workstream C files, the original C-provided map entry files (`map/index.html`, `src/map/main.tsx`) replacing B's map placeholders, and the original map Playwright test placed in B's `e2e/` test folder. `src/home/`, `src/warehouse/`, `src/employee/`, `/`, `/warehouse/` and `/employee/` remain B's original implementations.

**This is a source import only, not a finished integration. Do not merge to main yet.** The working B shared API, types, mock, UI and configuration have intentionally NOT been overwritten. C's alternatives are preserved in the ZIP and must be selectively reconciled with B's implementation.

## Coding work required (for the next AI, not performed during import)

1. Preserve Workstream B UI and behavior; integrate C `/map/` into the B architecture rather than wholesale replacing files from the C archive. Maintain one Vite multi-page Cloudflare Pages build and `map/index.html` input.
2. Reconcile `src/shared/contract.ts`, `api.ts`, `mock/` with C's `src/map/**` calls and C's versioned types. C's contract and B's contract have **different type shapes and identifiers** (e.g., `Row` vs `ShelfRow`), and C's mock is a separate implementation. Preserve all B's existing endpoints and tests. Do not switch B's mock transport to C's API wholesale.
3. Implement `PATCH /api/locations {part_id, slot_id, par_qty, version}` for par-only update, plus `GET /api/parts?unassigned=true`, with role authorization, optimistic versions, event IDs, affected shelf IDs and the correct error bodies. For production D1/backend, inspect available Workstream A code and add migrations/endpoints only after confirming the actual schema, never assume a backend exists just because the frontend mock does.
4. Support C undo/redo (redo = undo an undo event) and check the existing event API supports this safely; preserve audit history. Maintain `409 slot_out_of_bounds` payload `slots[]`, slot `departments[]` in layout and `affected_shelf_ids` after location mutations.
5. Reconcile C map's shared UI calls with B exports. B uses `AppHeader`, `Toasts`, `Modal`, `ConflictDialog` and a different `FtInInput` API; C expects `Header`, `Dialog`, `ConfirmDialog`, `SlotOccupiedDialog`, `VersionConflictDialog`, `departmentColor`, plus `FtInInput({onCommit,survey,surveyOn,...})`. Adapt and/or expose compatibility exports rather than replacing B's components. Fix Enter+blur double-save in the common measurement input, with regression coverage for both B and C.
6. Reconcile geometry/units/grid and map seed assumptions, including survey-sheet Y conversion, rows and slots, simulated performance dataset and searchable result shape, while preserving B demo IDs, QR/scan flows and in-browser storage. C references `seedPerfData` in mock mode; B's mock currently exposes a different surface.
7. Merge npm package requirements safely: `@react-three/fiber`, `@react-three/drei`, `three`, `zustand`, `@types/three`, plus any necessary transitive modules. Retain B's existing dependencies (including QR) and generate one consistent `package-lock.json` with `npm install`; do not paste C's `package.json` or lockfile over B's.
8. Merge styling tokens with existing Sun City branding and B layout, without replacing B's global styles. `.prettierrc` from C was deliberately not placed at root because B already has `.prettierrc.json`.
9. Validate the imported `e2e/map.spec.ts` with existing `playwright.config.ts`. The Workstream C original was under `tests/e2e/map.spec.ts`; import moved it to B's `e2e/` folder without editing test contents.
10. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`. Fix failures, verify B's scan/employee/home regressions and C map features (plan/3D/walk, search/focus, slot edits, stock, par, undo/redo, role gating, offline handling, touch/keyboard). Add tests for the new API routes and error cases. If tests cannot run due to environment, report that explicitly; do not claim green.
11. Preserve the unverifed building geometry caveats from `docs/map-notes.md`: all room/opening measurements are unverified; verify Storage 125, 16' wall height, door positions, door 40 room, dock open sides, 121 east side/stub, and demo shelves B1/F1 clearance. Do not represent the 3D map as field-verified.
12. Once passing, commit on this integration branch and open a pull request into `main`. Do not deploy or mutate production D1 without separate approval.

## Differences to inspect carefully

The original C ZIP has 78 files: 45 unique to C and 33 overlapping B paths with DIFFERENT content. The imported source does not resolve these conflicts itself. See README and `docs/map-notes.md` for C behavior; refer to `handoffs/workstream-c-original.zip` for exact C-side versions of `src/shared/**`, configuration, mock data, and package files.
