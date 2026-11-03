-- Additive, nullable precision markers. Coordinates are inches in the established map reference frame.
-- Requires 0006. Never apply to production without an independently verified migration rehearsal.
ALTER TABLE equipment ADD COLUMN marker_x_in REAL;
ALTER TABLE equipment ADD COLUMN marker_y_in REAL;
CREATE INDEX IF NOT EXISTS equipment_map_coordinates ON equipment(zone_id,marker_x_in,marker_y_in)
  WHERE marker_x_in IS NOT NULL AND marker_y_in IS NOT NULL;
