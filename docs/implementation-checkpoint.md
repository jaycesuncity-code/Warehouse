# Warehouse implementation checkpoint — 2026-10-29

This file describes the current integration source. The emergency checkpoint at `6475680` and its older claims remain in Git history. [Checkpoint recovery](checkpoint-recovery.md) records the six empty files and their verified restoration.

## Preserved milestones

- `5d4fcc8fb95b76a9630b7d4a176323980956bce9`: recovered lockfile, lint config, Pages API, authentication and migrations.
- `29098668feba65a8564f30a07632066ac3b93ef2`: integrated inventory, packouts, employee UI, map/scanner fixes, labels, security, retry receipts and scoped D1 performance. The complete uploaded tree matched the tested local tree.
- `8e2f30ae2a0f9915bce3ab76ba957ea4efdfd1b9`: fixed a real workerd authentication incompatibility, retained retry receipts after incomplete responses, and added a populated-schema migration test.

Subsequent source in this checkpoint adds the real compiled-worker/D1/browser gate, final UI retry/PDF/import fixes, updated deployment guidance and CI coverage.

## Implemented workflows

All seven application routes use the shared API. Production builds require authenticated D1-backed data; explicit demo builds remain clearly identified.

The scanner preserves canonical part IDs and existing search, part detail, location, move, count, par and history behavior. The map supports floor/shelf/front views, dimensions, shelf/bin editing, assignment, search focus, stock/geometry conflict handling and undo/redo. Snapshot imports preflight structure before writes, use backend-issued IDs and report partial failures.

The label workflow supports manual, paste, CSV and Excel input; editing and duplicate/conflict review; backend confirmation or registration of selected rows; partial retry; existing-part reprints; PDF preview/download/print and data export. QR payloads are exact canonical part IDs. Printing never registers unselected rows or changes stock. The original HTML remains unchanged.

Packouts use existing stock rows and Packout storage locations. Replenishment transfers stock, issue records custody without consumption, counted returns record used quantities, and availability excludes issued contents. Employee views show inventory and the authenticated employee's issued kits. All operations retain auditable history with version-checked undo/redo.

## Verified source evidence

- Unit/integration tests: **263 passed in 21 files**.
- TypeScript: passed.
- ESLint: passed with zero errors or warnings.
- Frontend build: passed, seven routes.
- Pages Functions: compiled to executable JavaScript with Wrangler `--outdir`.
- Compiled workerd/local D1: all four migrations, **118 harness HTTP requests plus 45 browser API requests**, nine scenario groups, seven routes.
- Actual runtime checks cover JWT rejection and server roles, partial registration, canonical IDs, stock/par/search, concurrent retries/counts, late-failure transaction rollback, packout lifecycle, history/CSV permissions and persistence across a workerd restart.
- Production browser checks cover real part registration/reload/PDF, scan/search, employee custody, mobile WebGL map, return reconciliation and rejection of URL/stored demo-mode overrides.
- Populated upgrade test preserves catalog IDs, inactive identities, stock/par/dimensions, timestamps, history and foreign-key relationships through the committed migration sequence.
- Label-focused suite: 21 unit tests; 11 label/packout browser cases passed before the final combined run. System Poppler renders and pixel QR decoding verified Letter pages, skipped positions and exact IDs.
- Full final Playwright run: **74 passed in 4.3 minutes**, including desktop and mobile screenshots, camera/keyboard scanning, geometry edits, imports, labels and packouts. The complete log is generated at `artifacts/release-e2e.log`.
- GitHub Actions results are recorded in PR #1. Check the run for the exact proposed commit before approving a release.

A runtime test caught a problem that unit tests did not: workerd rejected Fetch's `redirect: 'error'` option. Certificate retrieval now uses `manual` and rejects redirect responses without following them. Do not remove this check or replace real signed-token tests with an authentication bypass.

## Remaining environment release gates

The actual production D1 schema/migration journal, Pages runtime binding and Access configuration have not been inspected through authenticated Cloudflare access. The user cancelled the sign-in flow. No remote isolated preview has been deployed by this session.

The local-only Wrangler configuration deliberately preserves remote dashboard ownership. The API expects `warehouse-db`; a database display name or a binding called `DB` does not substitute for it.

Before a live release: verify target configuration, compare the real schema, rehearse any required migration on an isolated copy, exercise an authenticated isolated preview, obtain authorization for production migration/deployment/main merge, and confirm the deployed health/workflows.

Field measurements remain marked unverified. Digital PDF and QR verification does not certify a physical printer; measure a 100%/Actual Size calibration print.

No production data/schema, Cloudflare Access policy or production deployment has been modified. Main has not been merged.
