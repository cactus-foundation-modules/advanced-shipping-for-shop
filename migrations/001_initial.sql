-- Advanced Shipping for Shop - initial schema (prefix ash_).
-- All DDL idempotent so it is safe to re-run on every deploy.
--
-- Column types are chosen to stay inside the backup serialiser's supported set
-- (lib/backup/serialize.ts): TEXT, INTEGER, NUMERIC, BOOLEAN, JSONB, DATE,
-- TIMESTAMP. Times of day (cut-offs) are stored as TEXT "HH:MM" - a plain string
-- London wall-clock, never a TIME/TIMESTAMP, so no zone maths hides in the column.

-- Singleton module settings. `range_attribute_id` names which product attribute
-- (pat_attributes.id) is treated as the product's "range" for rule matching -
-- nullable, because a shop need not use ranges. Timezone is read live from core
-- config, never copied here.
CREATE TABLE IF NOT EXISTS "ash_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "range_attribute_id" TEXT,
    "holiday_region" TEXT NOT NULL DEFAULT 'england-and-wales',
    "holidays_synced_at" TIMESTAMP(3),
    "default_tier_key" TEXT,
    -- 'dropdown' | 'radios': how the cart shows the per-line tier picker.
    "cart_control_style" TEXT NOT NULL DEFAULT 'dropdown',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ash_settings_singleton" CHECK ("id" = 'singleton')
);
INSERT INTO "ash_settings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;

-- One delivery rule per scope. `scope_type` is DEFAULT | SUPPLIER | CATEGORY |
-- RANGE; `scope_ref` is the supplier name, shp_categories.id, or
-- pat_attribute_values.id it keys on (NULL for DEFAULT). A product resolves to
-- the most specific list it matches: range, else category, else supplier, else
-- default - the whole winning rule is used, no field-level inheritance.
--   fulfilment_mode STOCKED     -> cut-off -> dispatch lead -> transit
--   fulfilment_mode MADE_TO_ORDER -> mto_lead_days -> transit (no cut-off)
-- ship_days is a JSON array of weekday numbers (0=Sun .. 6=Sat) the courier
-- collects on; default Mon-Fri.
CREATE TABLE IF NOT EXISTS "ash_delivery_rules" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_ref" TEXT,
    "fulfilment_mode" TEXT NOT NULL DEFAULT 'STOCKED',
    "cutoff_time" TEXT NOT NULL DEFAULT '12:00',
    "dispatch_lead_days" INTEGER NOT NULL DEFAULT 1,
    "mto_lead_days" INTEGER NOT NULL DEFAULT 10,
    "transit_days" INTEGER NOT NULL DEFAULT 2,
    "ship_days" JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 5]',
    "backorder_lead_days" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_delivery_rules_pkey" PRIMARY KEY ("id")
);
-- One rule per scope. scope_ref is NULL for DEFAULT, so COALESCE keeps the
-- uniqueness real (a plain UNIQUE treats every NULL as distinct, which would let
-- two default rules coexist).
CREATE UNIQUE INDEX IF NOT EXISTS "ash_delivery_rules_scope_key"
    ON "ash_delivery_rules" ("scope_type", COALESCE("scope_ref", ''));

-- A purchasable delivery-and-assembly service tier (e.g. standard, next-day,
-- prebuilt-standard, full-install). Timing modifiers are applied on top of the
-- resolved rule: force next ship day, shift dispatch/transit, or floor the whole
-- estimate at a working-day minimum (e.g. full installation ~10 days).
CREATE TABLE IF NOT EXISTS "ash_service_tiers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_next_day" BOOLEAN NOT NULL DEFAULT false,
    "dispatch_lead_delta" INTEGER NOT NULL DEFAULT 0,
    "transit_delta" INTEGER NOT NULL DEFAULT 0,
    "min_lead_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_service_tiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ash_service_tiers_key_key" ON "ash_service_tiers" ("key");

-- Per-scope price and availability for a tier, resolved most-specific-wins per
-- product just like rules (so Seating can be priced differently from other
-- categories). scope_ref semantics match ash_delivery_rules.
CREATE TABLE IF NOT EXISTS "ash_tier_scope_config" (
    "id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_ref" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "price" NUMERIC(10, 2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_tier_scope_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ash_tier_scope_config_tier_fk"
        FOREIGN KEY ("tier_id") REFERENCES "ash_service_tiers"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ash_tier_scope_config_key"
    ON "ash_tier_scope_config" ("tier_id", "scope_type", COALESCE("scope_ref", ''));

-- Public holidays imported from gov.uk, persisted so date maths never makes a
-- live network call during render. One shop-wide calendar; `region` is the
-- gov.uk division key (england-and-wales | scotland | northern-ireland).
CREATE TABLE IF NOT EXISTS "ash_holidays" (
    "region" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "ash_holidays_pkey" PRIMARY KEY ("region", "date")
);

-- Per-product exception layer. Any non-null field patches the winning rule for
-- that product (the one place field-level patching happens); `disabled` hides
-- the delivery estimate for the product entirely.
CREATE TABLE IF NOT EXISTS "ash_product_overrides" (
    "product_id" TEXT NOT NULL,
    "fulfilment_mode" TEXT,
    "mto_lead_days" INTEGER,
    "cutoff_time" TEXT,
    "dispatch_lead_days" INTEGER,
    "transit_days" INTEGER,
    "backorder_lead_days" INTEGER,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_product_overrides_pkey" PRIMARY KEY ("product_id"),
    CONSTRAINT "ash_product_overrides_product_fk"
        FOREIGN KEY ("product_id") REFERENCES "shp_products"("id") ON DELETE CASCADE
);
