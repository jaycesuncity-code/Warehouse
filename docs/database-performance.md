# D1 persistence, concurrency, and measured performance

## One inventory and one transaction boundary

The live Pages Function reads the relational D1 tables and passes their rows to the same domain handlers used by the demo and tests. Live failures return an error; they do not fall back to demo inventory. The historical `src/shared/mock/` directory name also contains these shared domain rules.

Inventory quantities remain in `stock`, keyed by the canonical `(part_id, slot_id)` pair. A packout is associated with one existing slot, and its contents use those same stock rows. `employees` and `packouts` add custody records. They do not create a second quantity ledger. `issued_contents` records the quantities at issue so return/reconciliation and the domain integrity guard can detect inconsistent changes.

Every write uses a revision comparison against `warehouse_meta` in the same D1 batch as changed rows, audit events, and an optional idempotency receipt. A stale or missing revision raises a database constraint error. This is deliberate: an ordinary `UPDATE` affecting zero rows would not force a batch rollback. The API reloads state after a contention failure; absolute counts and other versioned operations still reject stale versions.

Newly minted IDs use strict inserts. They never use an upsert that could replace an existing record omitted from a scoped snapshot. Existing catalog `created_at` values are preserved. All database parameters are bound, and SQL identifiers are selected by server code.

An idempotency receipt is keyed by verified actor and request key and stores the request hash plus the original response. The receipt is committed atomically with the inventory operation. Identical retries return that response; a different request with the same key returns `409 idempotency_conflict`. The current client preserves a request key across its automatic retry. Legacy callers without a key must not blindly retry additive operations.

See [Cloudflare's D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) for the batch transaction and rollback contract. The repository tests exercise rollback and concurrent snapshots against isolated SQLite; the deployment verification also needs the compiled worker against a local or isolated D1 environment.

## Scoped reads and mutations

- Scanning a part loads that part's locations, their co-located parts, the necessary shelves and zones, and any associated packout and employee. It does not load unrelated inventory or audit history.
- Stock counts, relative adjustments, and par changes use the same scope. Complete contents of any included kit are retained so the issued-kit integrity check cannot be bypassed by a partial load.
- Search evaluates SQL candidates once, applies the canonical shared JavaScript scoring and locale ordering, and paginates before loading location and custody data. Broad searches may still scan catalog metadata because the contract includes arbitrary substrings and aliases. Only the requested result page is expanded into inventory details. The candidate and hydration revisions must match; a concurrent change causes a retry.
- Unicode candidates are rechecked by the shared scorer because SQLite's built-in `lower()` does not provide JavaScript's Unicode case behavior. Aliases are decoded with `json_each`, preserving quote/backslash matching. Parity tests cover these cases, filters, offsets, totals, and location details.
- The history route reads its requested page (default 50, maximum 200) and keeps the existing newest-insertion-first semantics. Undo loads its target audit event and current inventory, rather than the entire audit log.
- Other geometry and kit mutations currently load the current inventory to validate cross-record dependencies, without loading historical events. This is an explicit remaining scaling boundary for substantially larger warehouses.
- Map layout construction builds indexes for the duration of that read only. The indexes are never retained across mutable transactions.

## Reproducible benchmark

Run:

```bash
npx vitest run src/shared/database-performance.test.ts --silent=false --reporter=verbose
```

The fixture contains 5,000 parts, 200 shelves, 4,000 slots, 5,000 stock records, and 10,000 historical audit events. It uses an in-memory SQLite database with all committed migrations. Times below are development-container samples, not remote Cloudflare latency, worker CPU-budget guarantees, throughput tests, or GPU frame rates. Concurrent verification work changes timing; row counts and output parity are deterministic assertions.

| Operation | Observed result |
| --- | --- |
| Original full-snapshot request preparation | 24,428 rows and 10,139,283 serialized bytes; about 365 ms in the baseline run |
| Original map layout construction | About 2,375 ms |
| Indexed map layout construction | About 29–69 ms in subsequent runs |
| Scoped exact-part search | 9 returned rows; hydrated state 1,633 bytes; about 33–60 ms |
| Scoped stock adjustment, including persistence | 7 returned rows; about 11–22 ms |
| Broad search matching all 5,000 parts, first 25 results | 5,132 returned rows, primarily narrow catalog candidates; only 50 stock rows hydrated; about 125 ms during a concurrent verification run |

“Returned rows” measures rows transferred to application code in the test adapter. It is not Cloudflare's billed `rows_read` statistic. Search retains the same ranking, filtering, totals, pagination, and inventory values as the full canonical handler. The tests compare outputs rather than imposing hardware-sensitive timing limits.

## Integrity evidence and deployment limits

`src/shared/backend.test.ts`, `auth.test.ts`, and `database-scopes.test.ts` cover atomic rollback of rows/history/receipts, competing revisions, concurrent identical requests, retry-safe stock deltas, missing metadata, minted-ID collisions, versioned undo/redo, full kit custody checks under scoped loads, and foreign-key integrity. Authentication tests use generated signed RSA JWTs, not an auth bypass.

The actual production schema, deployed Access audience/allowlists, and Cloudflare preview bindings have not been inspected through an authenticated Cloudflare connection in this environment. These measurements and local tests do not authorize production migration. Compare the target schema with all migrations and verify an isolated deployment before making production changes.
