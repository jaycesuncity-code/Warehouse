# Implementation checkpoint — saved immediately at user's request

This is unfinished work, saved on 2026-10-29. Do not merge or deploy yet.

## Implemented locally
- Installed map dependencies and reconciled map API envelopes, geometry helpers and UI compatibility while retaining the scanner's contracts.
- Added par editing, unassigned search, affected shelf IDs and undo-of-undo support to shared business rules; removed the unused competing mock backend (original source remains in the ZIP).
- Added relational D1 persistence, authenticated route dispatch, revision-guarded atomic writes, and proposed migrations 0002 and 0003. Building seed contains unverified geometry only, no demo inventory.
- Reworked the label renderer integration to render an immutable selected snapshot without swapping editor rows or polling PDF output. Disabled local final-ID creation; preserved original HTML source.
- Production build defaults to live API; explicit mock mode remains available.

## Evidence so far
- Original npm ci passed; dependency installation succeeded. Final npm ci after all dependency changes still needs running.
- Latest completed unit run: 153 passed across 11 test files.
- TypeScript passed before the latest small mock/debug, lint, and browser-launch edits; rerun on this checkpoint.
- Vite build passed before the latest backend/label refinements; rerun on this checkpoint.
- Cloudflare Pages Functions compiled with Wrangler.
- All three migrations applied successfully ONLY to isolated local warehouse-local-test using wrangler.local.toml. Production database untouched.
- PDF renderer test produced a one-page 612 x 792 point US Letter PDF with default 2.95 x 0.84 inch label settings. Actual QR decode and physical-print verification still pending.
- npm audit reported zero vulnerabilities before the final Wrangler/type dependency additions; rerun.
- Lint has two remaining explicit-any errors in e2e/map.spec.ts and seven existing hook warnings.
- Full Playwright run could not launch Chromium: normal download repeatedly returned invalid archives. A temporary alternate Chromium was obtained through npm; smoke testing with it was being attempted when user requested immediate push. No passing browser result is claimed.

## Important remaining work
- Run all final checks and fix failures; map e2e fixtures still assume portions of Workstream C's old mock schema and IDs. Adapt tests to canonical fixtures without weakening assertions.
- Browser-test labels (imports, selections, edits, stale outputs, retries), scanner regression, map interaction, permissions, geometry conflicts, undo/redo and responsive UI.
- Extend authentication tests to signed JWTs, audience/issuer/expiration rejection and role enforcement through HTTP. Existing checks include fail-closed config/token rejection.
- Review backend design and input validation thoroughly. Persistence currently loads a consistent relational snapshot per request and applies changed rows in an atomic revision-guarded batch; correctness tests pass but large-data performance has not been established.
- Review retry/idempotency of inventory mutations, especially ambiguous network failures; registration reuse is tested.
- Improve structured out-of-bounds errors, map snapshot import ID remapping and map transaction/cache corner cases as required by the master handoff.
- Review finished UX and consolidate documentation; older README/completion notes are stale.
- Production schema, Access AUD, role lists and preview bindings remain unverified. Do not invent them.

No main merge, production deployment, production migration, production data mutation or Access policy change occurred.
