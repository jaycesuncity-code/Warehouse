# Checkpoint recovery — 2026-10-29

The integration branch and PR #1 pointed to `6475680a16decb8d5e8bda26d5243a752905deba` at takeover. GitHub's recursive tree confirmed six unintended empty blobs (`e69de29…`, zero bytes): `package-lock.json`, `eslint.config.js`, the Pages API entrypoint, the Access authentication module, and migrations 0002 and 0003. The intentional `.gitkeep` files were unchanged.

Direct HTTPS cloning could not authenticate in this execution environment. A clean checkout was reconstructed from the connected GitHub API and matching local artifact blobs. Every file's Git object hash, the complete tree (`294da245ed84f402b37b0c0baca01dda493bee89`), and the exact commit object were verified against GitHub before any repair. No earlier placeholder files were substituted.

The missing implementations were recovered from the prior integration workspace, which retained the actual nonempty source. History shows `auth.ts` was introduced empty in the emergency checkpoint; the previous API entrypoint was an older catalog-only implementation. The surviving newer source was therefore used instead of reverting the backend. The lockfile was regenerated against the current manifest using npm's lockfile generator.

## Focused recovery evidence

- Clean `npm ci`: 376 packages installed successfully.
- `npm run typecheck`: passed.
- `npm test`: 153 tests passed in 11 files at the recovered baseline.
- `npm run build`: passed, all six original application entries produced.
- `wrangler pages functions build`: compiled successfully.
- Migrations 0001, 0002 and 0003: successfully applied in order to an isolated local D1 emulator with foreign-key-aware persistence tests. The database name was `warehouse-local-test`, with an all-zero local-only ID.

This milestone repairs reproducibility; it does not certify application completion. Authentication hardening, packouts, label/browser regression, performance, deployment readiness and the final full test gate follow separately. Production schema and Access configuration have not been inspected or changed. No production migration, deployment, merge, or Access policy change was performed.
