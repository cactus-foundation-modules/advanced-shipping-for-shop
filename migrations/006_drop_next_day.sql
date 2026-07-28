-- Retires the "guaranteed next working day" tier flag (prefix ash_). Idempotent,
-- safe to re-run on every deploy.
--
-- The flag let a tier (or one of its scope rows) ignore the standing dispatch
-- lead and ship on the clearing day itself. It duplicated what a negative
-- dispatch delta already does, and a tier carrying it could not be reasoned
-- about from the deltas alone - the estimate quietly ignored them. Timing is now
-- expressed only as dispatch/transit deltas and a minimum lead, so a tier that
-- really does go out same-day sets its dispatch delta to cancel the rule's lead.
--
-- Any tier that had the flag set reverts to its stored deltas, which is the
-- intended behaviour: the deltas were always kept, just overridden.
ALTER TABLE "ash_service_tiers" DROP COLUMN IF EXISTS "is_next_day";
ALTER TABLE "ash_tier_scope_config" DROP COLUMN IF EXISTS "is_next_day";
