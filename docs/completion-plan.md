# Warehouse release gates — current integration

The original completion plan's source-integration tasks have been implemented. See [README](../README.md), [current checkpoint](implementation-checkpoint.md), [security](security.md), [labels](labels.md), [map notes](map-notes.md), and [database verification](database-performance.md) for the actual design and evidence.

## Completed in source

- Recovered all unintended zero-byte files and regenerated a valid lockfile.
- Integrated the existing 3D map while preserving scanner and shared API contracts.
- Implemented relational D1 geometry, stock, audit, undo/redo, packout custody and employee workflows.
- Hardened signed Access authentication, server-side roles, input validation, revisions and retry receipts.
- Completed selected-parts registration, PDF/QR generation, imports/exports, reprints, skipped label positions and stale-output invalidation.
- Measured and improved search/stock reads and map layout processing with behavior-parity tests.
- Added actual compiled-worker/D1 and production-browser verification alongside the full desktop/mobile demo workflow suite.
- Consolidated verification into one CI workflow; it does not deploy or migrate remote data.

## Gates before merging a release

1. All required checks must pass on the exact proposed GitHub commit, including clean install, types, lint, unit/integration tests, frontend/Functions builds, real local D1/browser smoke and full Playwright.
2. Confirm the deployment target's real Pages binding, Access variables/roles and production schema. The provided production screenshot matches the old main placeholder; publishing new source alone does not create the D1 schema or configure authentication.
3. Test a separate, authenticated preview database and deployment. Use a copy of the real schema when rehearsing upgrades, preserving IDs and inventory.
4. Obtain authorization for any production migration, main merge or production deployment. Main may be configured to deploy automatically, so merge approval must account for that effect.
5. After an authorized release, verify authenticated health, identity, database persistence and the real user workflows.

## Exact deployment requirements

Build command `npm run build`, output `dist`, Node 22, canonical API under `/api`, runtime D1 binding **`warehouse-db`**, and actual `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` with reviewed editor/admin allowlists. A historical handoff reports a database named `warehouse-scph`; this has not been independently inspected.

The repository's Wrangler file is local-only to avoid overriding existing dashboard bindings with placeholder values. See [deployment.md](deployment.md) for configuration ownership, isolated local migration commands, and production review requirements.

## What remains deliberately unclaimed

The automatic Cloudflare branch preview has been inspected read-only: its frontend deploys, but the API returns HTTP 503 because the Access team domain or audience is missing or invalid. Its D1 isolation and schema remain unverified. The existing production API URLs return homepage HTML rather than JSON. See [deployment evidence](deployment.md). Authenticated remote workflows, actual production schema compatibility, deployed Access policies and physical print calibration remain release gates. Warehouse measurements remain visibly unverified until surveyed. No production changes have been performed.
