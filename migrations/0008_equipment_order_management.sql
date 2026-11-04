-- 0008: Additive equipment order-management fields. Never alter applied 0006/0007.
-- Existing records retain identities and historical quantities. Unknown flags default to false for legacy data.
ALTER TABLE equipment_batch_lines ADD COLUMN manufacturer_unknown INTEGER NOT NULL DEFAULT 0 CHECK(manufacturer_unknown IN (0,1));
ALTER TABLE equipment_batch_lines ADD COLUMN model_unknown INTEGER NOT NULL DEFAULT 0 CHECK(model_unknown IN (0,1));
ALTER TABLE equipment ADD COLUMN manufacturer_unknown INTEGER NOT NULL DEFAULT 0 CHECK(manufacturer_unknown IN (0,1));
ALTER TABLE equipment ADD COLUMN model_unknown INTEGER NOT NULL DEFAULT 0 CHECK(model_unknown IN (0,1));
ALTER TABLE equipment ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS equipment_batches_recent ON equipment_entry_batches(created_at DESC,entry_batch_id DESC);
CREATE INDEX IF NOT EXISTS equipment_batches_requested ON equipment_entry_batches(requested_by_name);
CREATE INDEX IF NOT EXISTS equipment_batches_vendor ON equipment_entry_batches(vendor);
