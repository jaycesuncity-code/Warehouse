# Cloudflare Pages deployment and database isolation

## Current boundary

The code is developed on `integration/workstream-c-3d-map` in PR #1. The existing production site shown by the user was built from the old `main` placeholder source. A source checkpoint and a live release are separate events.

No production database/schema change, production deployment, main merge or Cloudflare Access policy change has been performed by this implementation effort. The actual production schema, current Pages bindings and Access application audience have not been inspected through authenticated Cloudflare access. Do not interpret local tests as verification of those settings.

## Observed deployment state — 2026-10-29

The existing Cloudflare Git integration automatically builds branch previews when the integration branch is pushed. PR #1's Cloudflare check reports successful deployment of `35806757ecf3f5cc444c8900687d42fd9f3bdcd5` at [its immutable preview](https://20c5c4dc.warehouse-5jk.pages.dev), with [a moving branch preview](https://integration-workstream-c-3d.warehouse-5jk.pages.dev). A successful Pages build does not establish a usable database-backed environment.

Read-only, unauthenticated checks of both preview URLs returned the current frontend with HTTP 200. Both `/api/health` and `/api/me` reached the Pages Function and returned HTTP 503, `Cache-Control: no-store`, and:

```json
{
  "error": "not_configured",
  "message": "Configure a valid Cloudflare Access team domain and application audience."
}
```

This identifies the first preview blocker: at least one of `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` is missing or invalid. The check runs before JWT verification and before the D1 binding is accessed. It does **not** establish the preview database's identity, isolation, or schema. No inventory mutations were attempted on this unverified preview.

Separately, the existing production URLs `https://warehouse-5jk.pages.dev/api/health` and `/api/me` returned HTTP 200 **homepage HTML**, not JSON API responses. The production and preview frontend asset hashes differ. Do not treat the production HTTP 200 as a successful API health check or infer its configuration from the preview's error. None of these public requests encountered an Access login redirect; the actual account policies remain unverified.

The Cloudflare dashboard requires sign-in, and no new sign-in flow was started. Configure or correct the verified Access values in the intended environment, confirm the database is isolated, then run the authenticated environment checks below. The deployment links above are diagnostic previews, not an approved working release.

## Configuration ownership

The checked-in `wrangler.toml` is for **local development only**. Its D1 ID is an all-zero local fixture, and it intentionally omits `pages_build_output_dir`. The existing Pages dashboard remains the source of remote configuration.

Cloudflare documents that adding `pages_build_output_dir` opts the file into remote Pages configuration; an incomplete local file can then replace the intended deployment settings. See the official [Pages configuration guidance](https://developers.cloudflare.com/pages/functions/wrangler-configuration/).

If moving remote configuration into source control later, first retrieve and inspect the existing project configuration in a separate directory. `wrangler pages download config <verified-project-name>` overwrites a Wrangler file in its current directory. Compare bindings, environment overrides, variables and project identity before adopting it. Never commit credentials or invent a database UUID. This is a future configuration change that needs review, not part of the local test setup.

## Required Pages settings

| Setting | Required value or verification |
| --- | --- |
| Repository | `jaycesuncity-code/Warehouse` |
| Production branch | `main`; merge only after release authorization |
| Build command | `npm run build` |
| Build output | `dist` |
| Node | Node 22, matching CI |
| D1 runtime binding variable | **`warehouse-db`** |
| D1 target | Verify the existing database identity; a historical handoff reports `warehouse-scph`, which is not independently confirmed |
| API routes | Repository `functions/api/[[path]].ts`, covering `/api/*` |
| Frontend mode | Normal production build, with `VITE_DATA_MODE` unset or `live` |
| Preview database | A separate, verified nonproduction D1 database |
| Access protection | Existing intended staff Access application must cover the site and its API |

The database display name and runtime binding variable are different settings. Binding a database as `DB`, or using its display name as the binding variable, does not satisfy `env['warehouse-db']`. See [Cloudflare's D1 binding instructions](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases).

Do not use a generic `wrangler pages deploy dist` as a preview procedure: the project and nonproduction branch must be selected explicitly, and its bindings must already be verified as isolated. No deployment command in this repository's CI applies production changes.

## Runtime authentication variables

Configure and verify these for each environment:

- `CF_ACCESS_TEAM_DOMAIN`: the actual Cloudflare Access team host, such as the organization's verified `*.cloudflareaccess.com` host.
- `CF_ACCESS_AUD`: the exact audience for the Access application protecting that environment.
- `WAREHOUSE_EDITORS`: reviewed editor email allowlist, separated by comma, whitespace or semicolon.
- `WAREHOUSE_ADMINS`: reviewed admin email allowlist, using the same separators.

Only signed, verified Access identity controls roles. Viewers are the default for other admitted employees. Administrator permissions include editor permissions. A frontend role toggle exists only in explicit demo mode.

Missing required Access configuration returns 503; absent or invalid JWTs return 401; insufficient roles return 403. Missing/mismatched D1 binding or an incomplete schema returns a controlled unavailable response. Authentication is never disabled to get a preview working. Test fixture JWTs and certificate handlers are confined to isolated test harnesses.

Changing Access policies or granting broader employee access requires separate authorization.

## Migrations

Committed sequence:

1. `0001_parts_catalog.sql`: canonical catalog identities and original catalog audit table.
2. `0002_warehouse.sql`: catalog extensions, geometry, stock, events, revision metadata and indexes.
3. `0003_unverified_building.sql`: initial building geometry marked unverified; no demo parts or stock.
4. `0004_packouts_and_retries.sql`: shelf location types, employee/kit custody, atomic retry receipts and supporting indexes.

Local example, using only the all-zero test database in this repository:

```bash
npx wrangler d1 migrations apply warehouse-local-test --local --persist-to=.wrangler/local-check
```

Never change this command to `--remote` as a convenience. The live smoke test creates a separate disposable D1 environment and applies the same migrations without Cloudflare credentials.

Before any authorized production migration, inspect the real schema and migration history. Useful read-only SQL includes:

```sql
SELECT name, sql FROM sqlite_master
WHERE type IN ('table', 'index', 'trigger')
ORDER BY type, name;
PRAGMA table_info(parts);
PRAGMA foreign_key_check;
```

Record the actual existing IDs, catalog/stock counts, foreign keys, indexes and migration journal. Obtain a verified export/backup and test the upgrade against an isolated copy of the actual schema/data. The committed populated-upgrade test checks the repository's earlier schema; it cannot certify a differently shaped production database.

Use the migration runner's journal to apply each migration once. Do not replay ALTER TABLE statements against a database that already has those columns, replace catalog IDs, seed demo inventory into production, or recreate a database to make migrations pass.

## Release verification

A repository release gate includes clean installation, typecheck, lint, unit/integration tests, frontend build, Functions compilation, actual local workerd/D1 requests, production-frontend browser checks, and the full desktop/mobile Playwright suite. GitHub Actions must pass on the commit proposed for merge.

An environment release gate also needs:

1. Confirmed isolated preview database and correct runtime binding.
2. Verified Access configuration with viewer, editor and admin identities.
3. Authenticated `GET /api/health` showing a healthy migrated database, plus `GET /api/me` showing the correct role.
4. Real preview workflows: register/reprint labels, scan/search, assign/move/count stock, map edits, kit issue/return and undo/redo.
5. Reload/persistence and concurrent-edit checks.
6. A reviewed production migration/release decision.

If Access redirects an unauthenticated request before it reaches the Function, that redirect is not a successful API health response. If the Function returns 401/503, correct the verified configuration; do not switch the deployed app to demo mode.

The unit/isolated API suite is evidence about the source. The preview smoke is evidence about the configured deployment. Neither confirms physical warehouse dimensions or real-printer calibration.
