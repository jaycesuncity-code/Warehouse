-- 0006: Equipment tracking foundation. Additive only; never run against an unchecked remote database.
-- Requires 0001-0005. Existing parts, stock, slots, and packouts are unchanged.
CREATE TABLE IF NOT EXISTS staff_accounts (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  display_name TEXT NOT NULL,
  employee_id TEXT REFERENCES employees(employee_id),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_permissions (
  email TEXT NOT NULL REFERENCES staff_accounts(email),
  permission TEXT NOT NULL CHECK(length(permission) BETWEEN 3 AND 64),
  granted_by_email TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY(email,permission)
);
CREATE INDEX IF NOT EXISTS staff_permissions_permission ON staff_permissions(permission,email);

CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 200),
  normalized_name TEXT NOT NULL,
  similarity_key TEXT NOT NULL,
  is_stock INTEGER NOT NULL DEFAULT 0 CHECK(is_stock IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  merged_into_customer_id TEXT REFERENCES customers(customer_id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK(is_stock=0 OR (active=1 AND merged_into_customer_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_stock_once ON customers(is_stock) WHERE is_stock=1;
CREATE INDEX IF NOT EXISTS customers_search ON customers(active,normalized_name);
CREATE INDEX IF NOT EXISTS customers_similar ON customers(similarity_key,active);
INSERT OR IGNORE INTO customers(customer_id,display_name,normalized_name,similarity_key,is_stock,created_by,created_at,updated_at)
 VALUES('cus-stk22222','STOCK','stock','stock',1,'system','2026-11-03T00:00:00Z','2026-11-03T00:00:00Z');

CREATE TABLE IF NOT EXISTS equipment_types (
  equipment_type_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  department TEXT NOT NULL CHECK(department IN ('HVAC Service','HVAC Install','HVAC New Construction','Plumbing Service','Plumbing Install')),
  serial_expected INTEGER NOT NULL DEFAULT 1 CHECK(serial_expected IN (0,1)),
  default_manufacturer TEXT,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_types_active_unique ON equipment_types(department,lower(trim(name))) WHERE active=1;
CREATE INDEX IF NOT EXISTS equipment_types_list ON equipment_types(active,department,name);
INSERT OR IGNORE INTO equipment_types(equipment_type_id,name,department,serial_expected,created_at,updated_at) VALUES
 ('ety-22222222','Furnace','HVAC Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-22222223','Air Handler','HVAC Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-22222224','Condenser','HVAC Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-22222225','Heat Pump','HVAC Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-22222226','Package Unit','HVAC Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-22222227','Mini-Split','HVAC Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-22222228','Evaporative Cooler','HVAC Service',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-22222229','Gas Water Heater','Plumbing Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-2222222a','Electric Water Heater','Plumbing Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-2222222b','Tankless Water Heater','Plumbing Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-2222222c','Boiler','Plumbing Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-2222222d','Pump','Plumbing Service',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-2222222e','Water Softener','Plumbing Install',1,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z'),
 ('ety-2222222f','Accessory','HVAC Install',0,'2026-11-03T00:00:00Z','2026-11-03T00:00:00Z');

CREATE TABLE IF NOT EXISTS equipment_entry_batches (
  entry_batch_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  po_number TEXT NOT NULL DEFAULT '',
  po_normalized TEXT NOT NULL DEFAULT '',
  requested_by_name TEXT NOT NULL,
  requested_by_email TEXT,
  expected_date TEXT,
  vendor TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  entered_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE INDEX IF NOT EXISTS equipment_batches_po ON equipment_entry_batches(customer_id,po_normalized,created_at);
CREATE INDEX IF NOT EXISTS equipment_batches_creator ON equipment_entry_batches(entered_by_email,created_at);
CREATE TABLE IF NOT EXISTS equipment_batch_lines (
  entry_line_id TEXT PRIMARY KEY,
  entry_batch_id TEXT NOT NULL REFERENCES equipment_entry_batches(entry_batch_id),
  line_no INTEGER NOT NULL CHECK(line_no>0),
  equipment_type_id TEXT NOT NULL REFERENCES equipment_types(equipment_type_id),
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  ordered_qty INTEGER NOT NULL CHECK(ordered_qty BETWEEN 1 AND 25),
  UNIQUE(entry_batch_id,line_no)
);

CREATE TABLE IF NOT EXISTS equipment (
  equipment_id TEXT PRIMARY KEY,
  entry_batch_id TEXT REFERENCES equipment_entry_batches(entry_batch_id),
  entry_line_id TEXT REFERENCES equipment_batch_lines(entry_line_id),
  unit_index INTEGER CHECK(unit_index>0),
  source TEXT NOT NULL CHECK(source IN ('ordered','unregistered_receipt')),
  equipment_type_id TEXT NOT NULL REFERENCES equipment_types(equipment_type_id),
  customer_id TEXT NOT NULL REFERENCES customers(customer_id),
  po_number TEXT NOT NULL DEFAULT '',
  po_normalized TEXT NOT NULL DEFAULT '',
  requested_by_name TEXT NOT NULL DEFAULT '',
  requested_by_email TEXT,
  expected_date TEXT,
  vendor TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  manufacturer_normalized TEXT NOT NULL DEFAULT '',
  ordered_model TEXT NOT NULL DEFAULT '',
  confirmed_model TEXT,
  serial_number TEXT,
  serial_normalized TEXT,
  status TEXT NOT NULL CHECK(status IN ('ordered','received','in_stock','reserved','installed','delivered','cancelled','returned')),
  received_at TEXT,
  received_by_email TEXT,
  fulfilled_at TEXT,
  fulfilled_by_email TEXT,
  cancelled_at TEXT,
  cancelled_by_email TEXT,
  zone_id TEXT REFERENCES zones(zone_id),
  floor_area_shelf_id TEXT REFERENCES shelves(shelf_id),
  location_note TEXT NOT NULL DEFAULT '',
  return_reason TEXT NOT NULL DEFAULT '',
  return_destination TEXT,
  entered_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_email TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK ((entry_batch_id IS NULL AND entry_line_id IS NULL AND unit_index IS NULL) OR (entry_batch_id IS NOT NULL AND entry_line_id IS NOT NULL AND unit_index IS NOT NULL)),
  CHECK(return_destination IS NULL OR return_destination IN ('vendor','customer','warehouse'))
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_line_ordinal ON equipment(entry_line_id,unit_index) WHERE entry_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS equipment_status_due ON equipment(status,expected_date);
CREATE INDEX IF NOT EXISTS equipment_customer_po ON equipment(customer_id,po_normalized,status);
CREATE INDEX IF NOT EXISTS equipment_batch ON equipment(entry_batch_id,entry_line_id,unit_index);
CREATE INDEX IF NOT EXISTS equipment_serial ON equipment(manufacturer_normalized,serial_normalized) WHERE serial_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS equipment_model ON equipment(equipment_type_id,ordered_model);
CREATE INDEX IF NOT EXISTS equipment_creator ON equipment(entered_by_email,created_at);
CREATE INDEX IF NOT EXISTS equipment_location ON equipment(zone_id,floor_area_shelf_id,status);

CREATE TABLE IF NOT EXISTS warehouse_review_items (
  review_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  issue_code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','critical')),
  dedupe_key TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json)),
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE UNIQUE INDEX IF NOT EXISTS review_open_unique ON warehouse_review_items(entity_type,entity_id,issue_code,dedupe_key) WHERE state='open';
CREATE INDEX IF NOT EXISTS reviews_queue ON warehouse_review_items(state,issue_code,created_at);
CREATE INDEX IF NOT EXISTS reviews_entity ON warehouse_review_items(entity_type,entity_id,state);

CREATE TABLE IF NOT EXISTS equipment_label_prints (
  label_print_id TEXT PRIMARY KEY,
  equipment_id TEXT NOT NULL REFERENCES equipment(equipment_id),
  entry_batch_id TEXT REFERENCES equipment_entry_batches(entry_batch_id),
  sheet_run_id TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK(page_number>0),
  sheet_position INTEGER NOT NULL CHECK(sheet_position BETWEEN 1 AND 8),
  printed_snapshot_json TEXT NOT NULL CHECK(json_valid(printed_snapshot_json)),
  label_fingerprint TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  prepared_by_email TEXT NOT NULL,
  confirmed_printed_at TEXT,
  confirmed_by_email TEXT
);
CREATE INDEX IF NOT EXISTS equipment_print_history ON equipment_label_prints(equipment_id,confirmed_printed_at);
CREATE INDEX IF NOT EXISTS equipment_print_batches ON equipment_label_prints(entry_batch_id,prepared_at);
