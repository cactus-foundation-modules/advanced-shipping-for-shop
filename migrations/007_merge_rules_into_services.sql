-- Folds the separate delivery-rules layer into the delivery services themselves
-- (prefix ash_). Idempotent, safe to re-run on every deploy.
--
-- Why: in practice every rule had degenerated into "base transit days per
-- range" - cut-off, dispatch lead and ship days were shop-wide constants, and
-- the per-product override layer sat empty. Yet estimating a line still meant
-- resolving TWO parallel most-specific-wins stacks (rule + tier config) and
-- adding deltas across them. After this migration one stack remains:
--
--   ash_settings           gains cutoff_time / dispatch_lead_days / ship_days
--                          (the shop-wide dispatch timing)
--   ash_service_tiers      gains transit_days (ABSOLUTE working days, replacing
--                          the delta pair) and description (shopper-facing copy)
--   ash_tier_scope_config  gains transit_days (absolute per-scope override,
--                          NULL inherits the service's own)
--   ash_delivery_rules     dropped, after its numbers are folded in
--   ash_product_overrides  dropped (empty everywhere; per-product exceptions
--                          were never used)
--
-- The fold keeps every live estimate identical: a service's absolute transit =
-- its old deltas + the transit of the rule its scope resolved to. Dispatch
-- deltas fold into transit too - dispatch lead and transit are added working
-- days on the same calendar, so their sum is what the shopper ever saw. The
-- supplier binding column (migration 004, unused) is folded to a SUPPLIER scope
-- row where possible and dropped: absence of a matching scope row is already the
-- "not offered" switch, so a single SUPPLIER row expresses the same thing.
--
-- Exactness note: the fold matches each config row to the rule at the SAME
-- scope, falling back to the DEFAULT rule. A config row whose products resolved
-- to a rule at a *different* scope level (say a CATEGORY price over a RANGE
-- rule) folds to the default rule's base instead - inherently approximate, as
-- one config row can span products under many different rules. Config rows for
-- a DEFAULT-scoped service under non-DEFAULT rules are materialised per rule
-- scope first, so the common "one default price, per-range rules" layout stays
-- exact. All DDL/DML below is dynamic (EXECUTE) and guarded, so a fresh install
-- whose 001 already has the merged shape parses and runs this file cleanly.

-- 1. New columns (no-ops when 001 already created them).
ALTER TABLE "ash_settings" ADD COLUMN IF NOT EXISTS "cutoff_time" TEXT NOT NULL DEFAULT '12:00';
ALTER TABLE "ash_settings" ADD COLUMN IF NOT EXISTS "dispatch_lead_days" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ash_settings" ADD COLUMN IF NOT EXISTS "ship_days" JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 5]';
ALTER TABLE "ash_service_tiers" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "ash_service_tiers" ADD COLUMN IF NOT EXISTS "transit_days" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ash_tier_scope_config" ADD COLUMN IF NOT EXISTS "transit_days" INTEGER;

-- 2. Fold the rule numbers in - only on an install that still has the old
-- tables/columns (to_regclass and column checks make re-runs and fresh installs
-- skip the whole block).
DO $$
DECLARE
  has_rules boolean;
  has_deltas boolean;
BEGIN
  has_rules := to_regclass('ash_delivery_rules') IS NOT NULL;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ash_service_tiers' AND column_name = 'transit_delta'
  ) INTO has_deltas;

  IF has_rules AND has_deltas THEN
    -- 2a. Shop-wide dispatch timing: the DEFAULT rule's, else the oldest rule's
    -- (on the installs this fold targets they were identical across rules).
    EXECUTE $sql$
      UPDATE "ash_settings" s SET
        "cutoff_time" = r."cutoff_time",
        "dispatch_lead_days" = r."dispatch_lead_days",
        "ship_days" = r."ship_days",
        "updated_at" = CURRENT_TIMESTAMP
      FROM (
        SELECT "cutoff_time", "dispatch_lead_days", "ship_days"
        FROM "ash_delivery_rules"
        ORDER BY ("scope_type" = 'DEFAULT') DESC, "position" ASC, "created_at" ASC
        LIMIT 1
      ) r
      WHERE s."id" = 'singleton'
    $sql$;

    -- 2b. Materialise per-rule-scope rows for services priced only at DEFAULT,
    -- so their transit can differ per rule scope exactly as it used to.
    EXECUTE $sql$
      INSERT INTO "ash_tier_scope_config"
        ("id", "tier_id", "scope_type", "scope_ref", "available", "price", "per_person",
         "transit_days", "min_lead_days", "created_at", "updated_at")
      SELECT
        md5(d."tier_id" || ':' || r."scope_type" || ':' || COALESCE(r."scope_ref", '')),
        d."tier_id", r."scope_type", r."scope_ref", d."available", d."price", d."per_person",
        NULL, d."min_lead_days", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM "ash_tier_scope_config" d
      JOIN "ash_delivery_rules" r ON r."scope_type" <> 'DEFAULT'
      WHERE d."scope_type" = 'DEFAULT'
      ON CONFLICT ("tier_id", "scope_type", COALESCE("scope_ref", '')) DO NOTHING
    $sql$;

    -- 2c. Service-level absolute transit: old deltas over the DEFAULT rule's
    -- base (no default rule = base 0). Clamped at zero like the old date maths.
    EXECUTE $sql$
      UPDATE "ash_service_tiers" t SET
        "transit_days" = GREATEST(0,
          t."dispatch_lead_delta" + t."transit_delta" + COALESCE(dr."transit_days", 0)),
        "updated_at" = CURRENT_TIMESTAMP
      FROM (SELECT 1) one
      LEFT JOIN (
        SELECT "transit_days" FROM "ash_delivery_rules" WHERE "scope_type" = 'DEFAULT' LIMIT 1
      ) dr ON true
    $sql$;

    -- 2d. Per-scope absolute transit: the row's effective deltas over the rule
    -- at its own scope (else the DEFAULT rule, else 0). Written only where it
    -- differs from the service's new absolute; identical rows stay NULL and
    -- inherit.
    EXECUTE $sql$
      UPDATE "ash_tier_scope_config" c SET
        "transit_days" = folded.abs_transit,
        "updated_at" = CURRENT_TIMESTAMP
      FROM (
        SELECT c2."id",
          GREATEST(0,
            COALESCE(c2."dispatch_lead_delta", t."dispatch_lead_delta")
            + COALESCE(c2."transit_delta", t."transit_delta")
            + COALESCE(r."transit_days", dr."transit_days", 0)) AS abs_transit,
          t."transit_days" AS tier_abs
        FROM "ash_tier_scope_config" c2
        JOIN "ash_service_tiers" t ON t."id" = c2."tier_id"
        LEFT JOIN "ash_delivery_rules" r
          ON r."scope_type" = c2."scope_type"
         AND COALESCE(r."scope_ref", '') = COALESCE(c2."scope_ref", '')
        LEFT JOIN (
          SELECT "transit_days" FROM "ash_delivery_rules" WHERE "scope_type" = 'DEFAULT' LIMIT 1
        ) dr ON true
      ) folded
      WHERE c."id" = folded."id"
        AND c."transit_days" IS NULL
        AND folded.abs_transit <> folded.tier_abs
    $sql$;
  END IF;

  -- 2e. A supplier-bound service's DEFAULT rows become SUPPLIER rows, keeping
  -- "offered only for that supplier" true through the scope system alone.
  -- Guarded separately: runs wherever the old column still exists.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ash_service_tiers' AND column_name = 'supplier'
  ) THEN
    EXECUTE $sql$
      UPDATE "ash_tier_scope_config" c SET
        "scope_type" = 'SUPPLIER',
        "scope_ref" = t."supplier",
        "updated_at" = CURRENT_TIMESTAMP
      FROM "ash_service_tiers" t
      WHERE t."id" = c."tier_id" AND t."supplier" IS NOT NULL
        AND c."scope_type" = 'DEFAULT'
        AND NOT EXISTS (
          SELECT 1 FROM "ash_tier_scope_config" x
          WHERE x."tier_id" = c."tier_id" AND x."scope_type" = 'SUPPLIER'
            AND COALESCE(x."scope_ref", '') = t."supplier"
        )
    $sql$;
  END IF;
END $$;

-- 3. Retire the old shape.
ALTER TABLE "ash_service_tiers" DROP COLUMN IF EXISTS "dispatch_lead_delta";
ALTER TABLE "ash_service_tiers" DROP COLUMN IF EXISTS "transit_delta";
ALTER TABLE "ash_service_tiers" DROP COLUMN IF EXISTS "supplier";
ALTER TABLE "ash_tier_scope_config" DROP COLUMN IF EXISTS "dispatch_lead_delta";
ALTER TABLE "ash_tier_scope_config" DROP COLUMN IF EXISTS "transit_delta";
DROP TABLE IF EXISTS "ash_product_overrides";
DROP TABLE IF EXISTS "ash_delivery_rules";
