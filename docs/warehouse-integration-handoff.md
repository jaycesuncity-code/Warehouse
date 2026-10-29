# Warehouse integration handoff — Workstream C 3D map + Bin Label Generator

**Repository:** `jaycesuncity-code/Warehouse` (private)  
**Integration branch:** `integration/workstream-c-3d-map`  
**Base branch:** `main` (do not merge, deploy, or change production D1 without approval)

## What is already present

- Workstream B: actual home, warehouse scanner, employee placeholder, shared React/TypeScript client, mock API, tests and Vite multi-page build. Preserve these implementations.
- Workstream C: new map source (`src/map/**`, `map/index.html`, `e2e/map.spec.ts`), `docs/map-notes.md`, and untouched `handoffs/workstream-c-original.zip`. C's conflicting versions of shared files are deliberately **not** merged. See `docs/workstream-c-integration-handoff.md` for the previous detailed analysis.
- Bin Label Generator: the **unchanged, original standalone HTML** is `labels/bin-label-generator.html`. It has been committed as a source/reference asset only. It is not yet integrated into Vite or into an app workflow; do not report it as live or wired up.

## Assignment and delivery policy

Complete the actual coding integration on `integration/workstream-c-3d-map`, using the existing architecture rather than replacing it. Keep Workstream B behavior intact. Do not overwrite source with C's placeholder home/warehouse/employee pages. Run verification, report evidence and unresolved blockers, open a PR into `main` when ready; **do not merge, deploy, or modify production D1** without permission.

## A. The intended user workflow: Add Parts to List → Register → Generate Labels

The label generator must become a native, connected feature of the warehouse parts workflow rather than a disconnected HTML tool that creates a second inventory list. Design the user flow as:

1. **Add Parts to List**: enter a part manually, paste rows, or import a CSV/Excel spreadsheet; optionally find existing parts and add them for reprinting. A staged list remains editable: name, code/SKU, expected quantity, optional extra import columns, selections, and validation. Multiple additions append to the same staging list (preserve user work).
2. **Review and resolve**: show new, matched existing, duplicate, missing required fields, and conflict statuses. Allow correcting rows, removing rows, reviewing import column mappings and data. Handle duplicate SKU and name disagreements explicitly; do not silently combine, replace, or overwrite existing parts.
3. **Register/resolve IDs against the actual warehouse backend**: existing parts keep their existing `part_id`. New parts receive their `part_id` from the canonical `POST /api/parts/register` or `POST /api/parts` backend, and are confirmed saved before printable labels are generated. The current API implementation expects **both part_code and part_name**, whereas the standalone generator treats part code as optional; choose a clear policy and validation UX rather than silently inventing codes. Respect `reused | new | conflict` outcomes and per-row `part_id` values from registerParts; partial successes must be shown accurately and avoid duplicate retries.
4. **Generate Labels**: provide an obvious action such as `Generate / Print Labels` from the staged list after IDs are resolved, with the option to select some or all rows. Open label setup and output with real part information. Existing parts can be reprinted without creating duplicate database records. Printing must not change stock quantities or silently create parts.
5. **Print/export**: make a PDF preview and download, print test page, optionally export CSV/XLSX of the resolved records for auditing or offline use. Preserve the original format and field round-tripping where sensible.

The user requested this as part of **“Add Parts to List”**. If the app does not yet have a screen named exactly that, build one consistent warehouse workflow, not a second stand-alone list or a disconnected button. Place intuitive navigation in the existing warehouse UI (and optionally an appropriate map/part context); avoid clutter or regressions.

### Non-negotiable data/QR invariants

- QR payload = exact canonical `part_id` **only** (e.g. `prt-xxxxxxxx`). The existing scanner `isPartId()` only accepts the regex `^prt-[2-9a-hj-km-np-z]{8}$`. **Do not encode SKU, URL, slot ID, JSON, or quantity.**
- Never mint final IDs in the label UI or rely on an exported previous-ID sheet to invent canonical identity. The standalone generator does mint IDs locally; **replace that behavior for the integrated experience** with server-issued IDs; do not change the preserved original HTML reference file.
- A previously exported ID sheet may be used for matching or reprints, but revalidate every ID against the actual database, report mismatches and do not trust imported IDs as authoritative.
- Reprinting a part must not create a second part. Printing labels for a selected subset must not register nonselected rows unintentionally. Partial batch failures must not produce misleading QR codes.
- Preserve current inventory/location semantics: expected qty in an import is not automatically on-hand stock, par, a slot assignment, or a stock transaction. Make any separate inventory-receiving action explicit and auditable; do not couple it to printing.
- Use role-based permissions already defined by the API. Only authorized editors/admins should register or edit parts; decide whether read-only users may reprint and enforce permissions at the API. Never trust client-side UI authorization as the security boundary.

### Original HTML behavior worth retaining

Source: `labels/bin-label-generator.html` (unchanged standalone tool, ~810 KB with embedded JavaScript libraries).

- Step 1: import `.xlsx`, `.xlsm`, `.xls`, `.ods`, `.csv`, `.tsv`, `.txt`, paste rows, or add one part. Optional previous-ID sheet. Import column mapping and extra column preservation.
- Step 2: editable staged rows, problem filtering, duplicate-ID validation, clear/add row, status badges, warnings and paging.
- Step 3: US Letter two-column labels, **default 11 rows / 22 labels per sheet**, label dimensions **2.95 × 0.84 inches**, gap/margin/QR module settings, cut guides, optional part code line, configurable skip positions for partially used sheets, print sizing checks.
- Step 4: generate vector PDF with preview/download, test measurement page, PDF stale warning after edits, CSV/XLSX exported ID sheets, progress UI.
- Strict **100% / Actual size** printing; test 1-inch square. Preserve printer scaling and QR readability precautions.
- Existing QR includes `part_id` only, not expected quantity. Existing HTML retains settings in localStorage, and works offline. The integrated app should clearly distinguish local staging / offline print capabilities from operations that require D1 connectivity.
- The standalone file embeds `qrcode`, `jsPDF` and spreadsheet parsing libraries. Prefer reusing properly packaged existing dependencies where appropriate and ensure licensing/version safety, rather than uncritically pasting enormous bundled scripts into React components. Preserve the original file unchanged for reference.

## B. Finish Workstream C map integration (previous handoff still applies)

1. Preserve home, warehouse scanner, employee placeholder and all existing Workstream B behavior. Integrate the C map into the B multi-page Vite app, not as a separate incompatible project.
2. Reconcile C's type and API expectations with `src/shared/contract.ts`, `src/shared/api.ts`, `src/shared/mock/**`, including its differing `Row`/`ShelfRow` shapes and mocked endpoint implementations. Do not wholesale replace B's working shared files. Preserve the existing part registration API and its tests; extend it only as justified by the integrated workflow.
3. Implement the C-specific `PATCH /api/locations` par-only update, `GET /api/parts?unassigned=true`, correct `event_id`/`affected_shelf_ids` responses, `409 slot_out_of_bounds` `slots[]`, and layout `departments[]` as required. Implement or adapt the real backend only after inspecting Workstream A's actual schema/availability.
4. Support event-based undo/redo (redo = undo the undo event), audit history, version conflicts and permission checks.
5. Adapt C's shared UI expectations (`Header`, `Dialog`, `ConfirmDialog`, `SlotOccupiedDialog`, `VersionConflictDialog`, department colors and `FtInInput` props) without breaking B's components. Fix the Enter+blur double-save bug in `FtInInput` with regression coverage.
6. Reconcile geometry/units/seedPerfData, preserve B demo IDs and scanner integration, map search/focus behavior and map camera controls. Preserve on-demand render, with continuous rendering only while walking/search dots animate.
7. Merge C dependencies `@react-three/fiber`, `@react-three/drei`, `three`, `zustand`, `@types/three` and transitive packages while retaining B dependencies. Produce one coherent `package-lock.json` via npm.
8. Preserve C's caveats: **all room/opening seed measurements unverified**. Field-check STORAGE 125 width, 16-foot wall height, man-door positions, door 40 room, loading dock open sides, room 121 east side/stub wall, demo shelves B1/F1 clearance. Do not present map measurements as field-verified.

## C. Build, routes, and validation

- `labels/bin-label-generator.html` is **committed as source only**, not a deployed page. The Vite build currently has explicit inputs `index.html`, `warehouse/index.html`, `warehouse/demo-labels.html`, `employee/index.html`, `map/index.html`; add route/build wiring as part of the coding integration. Prefer a native integrated labels screen over simply embedding the standalone HTML unchanged. If retaining a standalone `/labels/` route for utility, ensure that its existence does not create a competing inventory/ID system.
- Provide understandable navigation from the warehouse scan/search/part list. Preserve responsive/touch usability. Keep Sun City branding without unnecessarily changing existing screens.
- Add tests for: spreadsheet/paste/manual staging, mapping/extra columns, duplicate detection, empty/missing SKU policy, exact scanner-compatible QR payload, reused part reprints, new server-issued IDs, mixed `reused/new/conflict`, partial-success retry idempotency, no stock side effects, role restrictions, PDF count/layout and skipped positions, and actual scanner roundtrip for generated labels.
- Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`; correct integration failures. Verify both B's scanning/search/move/resize/swap and C's map features. Perform reasonable print-scale / QR scan smoke checks. Do not falsely report tests passing if the environment cannot run them.
- Provide a concise changed-file list, major decisions, build/test evidence, remaining backend or measurements blockers and preview/PR link if created. Commit to the integration branch and open a PR to `main` when review-ready, without merging or deploying.

## Implementation cautions

- The original HTML's `part_code` is optional while the current `registerParts` API requires it. Its ID generation happens at PDF time, and its previous-ID file matches by code then name. Those are **standalone behavior**, not safe database registration policies. Explicitly reconcile them.
- Some Workstream C paths overlap with B. Refer to `handoffs/workstream-c-original.zip` for the exact C-side source and `docs/workstream-c-integration-handoff.md` for the established conflict list.
- Workstream B `README.md` currently describes `/labels/` as 'moved here later'; do not imply a ready `/labels/` application until the build and workflow have actually been implemented.

**Finish the coding work in sensible batches, not just a plan.** Preserve the existing codebase, tests and data. Do not request confirmation for routine implementation decisions, but do not perform production deployment, D1 mutations or merge without explicit approval.