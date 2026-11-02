-- Additive migration. Apply only after inspecting the target schema and receiving approval.
-- Marks a zone as a clickable floor area (Tools, Packouts). NULL keeps an ordinary room.
ALTER TABLE zones ADD COLUMN area_kind TEXT CHECK(area_kind IN ('tools','packouts'));
