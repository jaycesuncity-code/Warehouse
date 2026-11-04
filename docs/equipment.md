# Equipment tracking — equipment ordering and receiving

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
- Order entry expands line quantities into individual units; one request is limited to **10 lines, 25 units** for bounded D1 transactions. Label prepare/confirm operations are limited to **25 units per request** to stay within conservative D1 operation budgets. Request receipts protect idempotent retries when the same key and body are used.
- Duplicate serial/model mismatch are review issues, not blockers. Genuine concurrency or invalid status transitions remain conflicts.
- Receiving without a prior order saves the unit and raises an unregistered-arrival review item.
- Equipment status and location are independent from part `stock`. Warehouse physical zone validation must not invent a bin.
- The UI downloads a PDF locally; only the explicit **Confirm physically printed** action records physical print confirmation. Print at Actual Size/100% and measure the calibration PDF before using actual Avery stock.
- The implementation includes customer merge API, a staff permission-management screen, model suggestions, inventory KPI counts and a reprint-needed query. The separate Equipment route relies on the existing warehouse camera scanner for QR capture, rather than duplicating a camera view. Interactive 3D equipment staging markers and customer-merge UI are implemented in the existing feature branch. These gaps and complete real-device QA should be reviewed before a production release.
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

## Completion pass: durable orders and operational controls

The equipment page now stores the idempotency key and exact body of an uncertain order in session storage until the server acknowledges it. Retrying the pending order reuses the original request and server receipt; a deliberate new order begins only after the outstanding attempt is resolved. Browser storage preserves retry state across reloads within that browser session, and existing D1 batches can be found from any authorized device.

The receiving page offers persistent D1 batch search by PO (including leading zeroes), customer, batch ID and requested-by, with counts for received, remaining and cancelled units and one-click selection of individual units. The inventory search includes PO and manufacturer and has a load-more control. Authorized receiving staff can edit post-receipt metadata, while the order-only user remains restricted to their own ordered units. The administrator customer tool provides preview and explicit confirmation before customer merges.

Only independent *equipment* rights are exposed in the Staff permissions panel. Parts, map and packouts still use the legacy Access role lists; those operations must never appear to obey unenforced database grants. Health checks now include the equipment migration's required columns, indexes, STOCK record and seeded types; this is intentionally an all-features readiness gate rather than a legacy-only health check.

### Limitations requiring verification before release
- CI confirms software checks; it cannot certify a physical printer, access to the real Cloudflare account, or production D1 migration state.
- Equipment location precision and map staging-marker functionality must be checked independently; a zone or free-text location is not a substitute for a physically positioned marker.
- A session-storage retry receipt is scoped to a browser tab/session. Users should find an existing batch by PO on other devices rather than re-submit when a result is uncertain.

## Precise equipment map placements (migration 0007)

The optional equipment marker is stored as an X/Y position in map inches, using the same reference frame as the existing warehouse map. A receiver can enter the Equipment Staging Markers panel on `/map/`, select an existing equipment ID and click the appropriate room floor. The API rejects out-of-range, non-room and stale-version positions, then saves coordinates plus the matching zone, emits an equipment audit event, and refreshes the interactive 3D markers. Clicking a marker opens its unit record, and unit search/details link to `/map/?equipment=eqp-...` to focus on the location.

Migration `0007_equipment_map_positions.sql` adds nullable marker coordinates and an index to `equipment`; previous equipment records remain valid without markers. This must be applied **after 0006** on isolated copies first. The system's `/api/health` now requires both 0006 and 0007 for complete readiness.

Physical layout still carries existing unverified room outlines; marker placement means the employee selected a location, not that building geometry or aisle safety was professionally surveyed. The map and physical marker workflow require on-site visual verification before production authorization.


## Equipment Orders — feature branch implementation (2026-11-04)

This section documents the new order-management code on the draft feature branch. It does **not** establish production readiness.

- The **Equipment Orders** section defaults to outstanding batches (at least one unit in `ordered` status), with partial, closed, and all-order filters and paginated search by PO, batch ID, customer, requester, vendor, manufacturer, and model. Search moves to All so historical orders are not concealed.
- New orders require a customer/STOCK and 1–10 lines / 1–25 units. PO is optional and retains leading zeroes. Manufacturer and model normally must be entered; each can independently be marked Unknown. The review-before-submit step is read-only. Successful saving shows the batch ID, counts, and separate label, detail, and new-order actions.
- Labels may be printed after ordering, during receiving, or reprinted. Existing Avery 5821 PDF geometry, QR payload, and separate print confirmation remain unchanged. Cancelled equipment is blocked from new label preparation.
- Each order details page groups by **actual entry_line_id**, displays status/quantity totals and individual Equipment IDs, prints/receiving actions, and recent event history.
- Order editing uses `PATCH /api/equipment/batches/:id` with required batch `version`, `header`, and edited/new `lines`. Existing unit IDs are preserved; increases mint only additional units. `ordered_qty` is historical cumulative creation count and **does not decrease** on cancellation. Current active equals all non-cancelled unit records; current outstanding equals units with status `ordered`. Received counts use non-null `received_at`, including equipment later moved to other statuses.
- Reductions specify the exact outstanding `cancel_unit_ids` and a mandatory cancellation reason. A standalone `POST /api/equipment/batches/:id/cancel` accepts selected `unit_ids` or cancels all remaining units; `POST /api/equipment/:id/cancel` handles one unit. Accepted predefined reasons are Customer cancelled, Ordered by mistake, Supplier unavailable, Equipment changed, Duplicate order, and Other with a required explanation. Reasons are stored on each cancelled unit and in event history.
- Any staff member with `order_equipment` can cancel outstanding units of any order; `receive_edit_equipment` alone cannot. Shared batch/line changes that affect already received equipment require `receive_edit_equipment` or administrator authority. Shared order fields cannot be changed through the individual-unit correction endpoint.
- Unknown fields have dedicated flags and open missing-information review records per unit. Fixing those fields through order editing resolves applicable open review records. Receiving displays a prompt for outstanding unknown fields.
- Revision-aware, single D1-batch mutations and existing idempotency receipts protect retries. `0008_equipment_order_management.sql` is **additive**, must be tested in an isolated D1 database, and is **not authorized for production application** as part of this branch work.
- The existing equipment types API and staff permissions remain intact. Physical printer calibration and authenticated production workflow checks still require separate verification.

### Important readiness caveats

This is a draft development feature. CI, isolated populated-migration tests, an authenticated staging walkthrough, and physical printer alignment must all be verified before production release. Do not connect write-capable testing to the existing feature preview if that preview points at production D1.
