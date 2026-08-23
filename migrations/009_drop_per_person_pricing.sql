-- Retires per-person service pricing (prefix ash_). Idempotent, safe to re-run
-- on every deploy.
--
-- A price row could be ticked "per person", which multiplied it by a count read
-- off a nominated product attribute ("6 People"). It never earned its keep: no
-- install ever ticked one, and the machinery cost every line a second attribute
-- read and gave the basket a state it could not price at all - a line whose
-- product carried no readable number simply blocked. Delivery prices are now a
-- flat figure per line, as every live price row already was.
--
-- Nothing is lost with it: no scope row anywhere had the flag set, so dropping
-- the column changes no price. The nominated count attribute goes too; the
-- attribute itself and its values are untouched, only the nomination.
ALTER TABLE "ash_tier_scope_config" DROP COLUMN IF EXISTS "per_person";
ALTER TABLE "ash_settings" DROP COLUMN IF EXISTS "per_person_attribute_id";
