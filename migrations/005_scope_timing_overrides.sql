-- Per-scope timing overrides on tier scope config (prefix ash_). Idempotent,
-- safe to re-run on every deploy.
--
-- Until now a tier's timing modifiers (next-day flag, dispatch/transit deltas,
-- minimum lead) lived only on the tier itself, so a shop whose "Installation"
-- takes longer for one range had to CLONE the whole tier - which is how
-- duplicate tier names ("installation2", "-dynamic" twins) crept into live
-- data. These nullable columns let one scope row patch the tier's timing for
-- just that range/category/supplier: NULL means "inherit the tier's value",
-- exactly the way ash_product_overrides patches a delivery rule. All columns
-- stay inside the backup serialiser's supported set (BOOLEAN, INTEGER).
--
-- Note "min_lead_days": NULL inherits the tier's floor; a scope that wants NO
-- floor where the tier has one sets 0 (a zero-day floor is a no-op).
ALTER TABLE "ash_tier_scope_config" ADD COLUMN IF NOT EXISTS "is_next_day" BOOLEAN;
ALTER TABLE "ash_tier_scope_config" ADD COLUMN IF NOT EXISTS "dispatch_lead_delta" INTEGER;
ALTER TABLE "ash_tier_scope_config" ADD COLUMN IF NOT EXISTS "transit_delta" INTEGER;
ALTER TABLE "ash_tier_scope_config" ADD COLUMN IF NOT EXISTS "min_lead_days" INTEGER;
