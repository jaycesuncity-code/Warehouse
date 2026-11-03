# Equipment tracking — Phase 2 implementation

**Feature branch:** `feature/equipment-tracking` · **Draft PR:** https://github.com/jaycesuncity-code/Warehouse/pull/2

Approved architecture: [Equipment Integration Proposal](equipment-proposal.md) (the signed-off proposal may be held outside this repository).

## What is isolated

- Equipment uses `equipment` (one unit per row), `equipment_types`, `customers`, `equipment_entry_batches`, `equipment_batch_lines`, `warehouse_review_items`, and `equipment_label_prints`. Nothing in `parts` or `stock` is converted or updated by equipment routes.
- D1 migration `0006_equipment_foundation.sql` is **additive only**. The source repo also has `0005_zone_area_kind.sql`; do not assume either has been applied to remote D1.
- `staff_accounts` and `staff_permissions` add independent, DB-managed equipment rights. Existing `WAREHOUSE_ADMINS` still have full powers. Legacy `WAREHOUSE_EDITORS` keep their existing inventory rights but **do not automatically** gain equipment ordering or receiving.
- `GET /api/me` retains legacy `role` and adds `permissions`. Keep the Cloudflare Access JWT verifier and `warehouse-db` runtime binding unchanged.
- The main entry point is `/equipment/`. It has an order form, equipment inventory, scan/receive, review and printable Avery 5821 labels. Warehouse scanner routes `eqp-` IDs to Equipment, and `prt-` IDs to the original part flow.
- The equipment label renderer writes independent vector PDFs with 8 positions per Letter sheet and skips already-used first-sheet positions. QR content is **the equipment ID only**, with level M QR error correction. Original `labels/bin-label-generator.html` remains unchanged.

## Rules and known limitations

- Real production use requires a **reviewed deployment and verified D1 migration**. No SQL should be pasted into production without verifying schema identity, backup, target and production authorization.
- Order entry expands line quantities into individual units; one request is limited to **25 units** for bounded D1 transactions. Request receipts protect idempotent retries when the same key and body are used.
- Duplicate serial/model mismatch are review issues, not blockers. Genuine concurrency or invalid status transitions remain conflicts.
- Receiving without a prior order saves the unit and raises an unregistered-arrival review item.
- Equipment status and location are independent from part `stock`. Warehouse physical zone validation must not invent a bin.
- The UI downloads a PDF locally; only the explicit **Confirm physically printed** action records physical print confirmation. Print at Actual Size/100% and measure the calibration PDF before using actual Avery stock.
- The first implementation does not yet include complete customer merging, admin permission-management screens, polished model suggestion UI, dashboard/reporting, scanner camera within Equipment (existing camera scanner routes equipment codes), or detailed stale-print query. These need follow-up implementation and tests before a production release.
- No remote database access, physical printing, or authenticated production browser test has been performed by this implementation.
- **Do not merge PR #2** until its CI is green and the missing production-critical tasks above are completed.

## D1 preflight — console (read-only, separately)

Run each as an individual statement; the Cloudflare D1 console does **not** accept pasted comments followed by SQL as a reliable query.

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

```sql
SELECT COUNT(*) AS zones FROM zones;
```

```sql
SELECT COUNT(*) AS parts FROM parts;
```

```sql
SELECT COUNT(*) AS shelf_count FROM shelves WHERE active=1;
```

```sql
PRAGMA foreign_key_check;
```

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('equipment','equipment_types','customers','staff_accounts','staff_permissions');
```

Record target D1 UUID, Pages binding and migration journal before continuing. Back up/Time Travel checkpoint first.

## Applying 0006 safely

**Prefer Wrangler's managed D1 migration workflow or rehearsed CLI**, not hand-copying partial SQL and assuming success. The committed `0006` SQL file is the single authoritative sequence of statements. To apply locally, run the same migration runner as current project uses against an isolated local database first, then run tests and inspect all tables/FKs. A remote migration requires separate authorization and verified D1 identity.

For the D1 console, open `migrations/0006_equipment_foundation.sql`, remove comments and run statements in source order **one at a time**; never repaste an incomplete `ALTER` / `INSERT` group or combine with comment lines. Check each output for errors before continuing. Since the file includes `CREATE TABLE IF NOT EXISTS`, indexes and `INSERT OR IGNORE` seeds, first-run and rerun behavior are defined for the new entities. A partial run still requires a schema/row inspection; do not blindly resume.

### Post-apply SQL (one statement at a time)

```sql
SELECT COUNT(*) AS equipment_type_count FROM equipment_types;
```

```sql
SELECT customer_id,display_name FROM customers WHERE is_stock=1;
```

```sql
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('equipment','equipment_entry_batches','equipment_batch_lines','equipment_label_prints','warehouse_review_items','staff_accounts','staff_permissions');
```

```sql
PRAGMA foreign_key_check;
```

## Grant equipment permissions

After verifying the intended sign-in email, an existing administrator can use authenticated API staff permissions routes:
`PUT /api/staff/{email}/permissions/order_equipment`
and
`PUT /api/staff/{email}/permissions/receive_edit_equipment`
with JSON body `{}`.
These require Cloudflare Access and `manage_staff` (admin possesses this). A viewer cannot grant rights by editing client requests. Never put email allowlists or Access tokens in source control.

## Verification gate

On the feature branch run: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:live -- --browser`, `npm run test:e2e`. The PR's GitHub Actions workflow executes these. If no CI result is available, report it as **unverified**, not passing.

**Rollback:** preserve a D1 Time Travel checkpoint and follow Cloudflare's authorized restore process if any production data/schema migration fails. There is no drop-table rollback SQL for equipment history.
