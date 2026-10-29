-- PROPOSAL ONLY: NEVER APPLY TO PRODUCTION WITHOUT APPROVAL.
-- Label registration creates catalog identity, not stock or location inventory.
CREATE TABLE IF NOT EXISTS parts (
 part_id TEXT PRIMARY KEY,
 part_code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(part_code)) BETWEEN 1 AND 150),
 part_name TEXT NOT NULL CHECK(length(trim(part_name)) BETWEEN 1 AND 500),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS part_audit (
 event_id TEXT PRIMARY KEY,
 part_id TEXT NOT NULL REFERENCES parts(part_id),
 event_type TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_part_audit_part ON part_audit(part_id,recorded_at);
