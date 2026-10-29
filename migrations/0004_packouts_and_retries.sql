-- Additive migration. Apply only after inspecting the target schema and receiving approval.
-- Kit contents use the existing stock table; issue changes custody, return records consumption.
ALTER TABLE shelves ADD COLUMN location_type TEXT NOT NULL DEFAULT 'primary'
  CHECK(location_type IN ('primary','overstock','packout'));

CREATE TABLE employees (
  employee_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 150),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(email)) BETWEEN 3 AND 254),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE TABLE packouts (
  kit_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 150),
  slot_id TEXT NOT NULL REFERENCES slots(slot_id),
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','issued')),
  employee_id TEXT REFERENCES employees(employee_id),
  issued_at TEXT,
  issued_contents TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(issued_contents)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  CHECK((status='available' AND employee_id IS NULL AND issued_at IS NULL)
     OR (status='issued' AND employee_id IS NOT NULL AND issued_at IS NOT NULL))
);
CREATE UNIQUE INDEX packouts_slot ON packouts(slot_id) WHERE active=1;
CREATE UNIQUE INDEX packouts_name ON packouts(lower(name)) WHERE active=1;
CREATE INDEX packouts_employee ON packouts(employee_id,status,active);
CREATE TABLE idempotency_requests (
  actor TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  response_headers TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor,key)
);
CREATE INDEX idempotency_created ON idempotency_requests(created_at);
CREATE INDEX parts_active_name ON parts(active,part_name COLLATE NOCASE);
CREATE INDEX parts_active_category ON parts(active,category COLLATE NOCASE);
CREATE INDEX stock_part_active ON stock(part_id,active);
CREATE INDEX events_newest ON events(at DESC,event_id);
