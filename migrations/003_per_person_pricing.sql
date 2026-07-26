-- Per-person tier pricing (prefix ash_). All DDL idempotent, safe to re-run.
--
-- A service-tier price can be charged per person rather than per line: the base
-- price is multiplied by a count read off a nominated product attribute (e.g. a
-- "Seats" attribute whose values read "2 People", "6 People"). Nothing here is
-- specific to any one shop's attribute - the shop nominates which attribute
-- carries the count, exactly as it already nominates its "range" attribute.

-- Which scope prices are charged per person. Default false keeps every existing
-- price flat, so the column is inert until an admin ticks it. BOOLEAN stays
-- inside the backup serialiser's supported set.
ALTER TABLE "ash_tier_scope_config"
    ADD COLUMN IF NOT EXISTS "per_person" BOOLEAN NOT NULL DEFAULT false;

-- Nominates the product attribute (pat_attributes.id) whose value carries the
-- person count for a line. Nullable: a shop using no per-person pricing leaves
-- it unset, and a per-person price with no count attribute nominated simply has
-- nothing to multiply by (the line is then blocked, never silently mispriced).
ALTER TABLE "ash_settings"
    ADD COLUMN IF NOT EXISTS "per_person_attribute_id" TEXT;
