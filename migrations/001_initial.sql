-- Advanced Shipping for Shop - initial schema (prefix ash_).
-- All DDL idempotent so it is safe to re-run on every deploy.
--
-- Column types are chosen to stay inside the backup serialiser's supported set
-- (lib/backup/serialize.ts): TEXT, INTEGER, NUMERIC, BOOLEAN, JSONB, DATE,
-- TIMESTAMP. Times of day (cut-offs) are stored as TEXT "HH:MM" - a plain string
-- London wall-clock, never a TIME/TIMESTAMP, so no zone maths hides in the column.
--
-- One concept carries the whole estimate: the delivery service (ash_service_tiers)
-- and its per-scope grid (ash_tier_scope_config). Dispatch timing (cut-off, lead,
-- ship days) is shop-wide on ash_settings; each service carries its own transit
-- time in working days, overridable per range/category/supplier in the grid.
-- (Earlier installs had a separate ash_delivery_rules table plus per-product
-- overrides; migration 007 folds those into this shape.)

-- Singleton module settings. `range_attribute_id` names which product attribute
-- (pat_attributes.id) is treated as the product's "range" for scope matching -
-- nullable, because a shop need not use ranges. Timezone is read live from core
-- config, never copied here. Dispatch timing lives here because it is a fact
-- about the warehouse, not about any one delivery service: `cutoff_time` is the
-- order-by time on a ship day, `dispatch_lead_days` the working days from
-- clearing the cut-off to handover, `ship_days` a JSON array of weekday numbers
-- (0=Sun .. 6=Sat) the courier collects on.
CREATE TABLE IF NOT EXISTS "ash_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "range_attribute_id" TEXT,
    "holiday_region" TEXT NOT NULL DEFAULT 'england-and-wales',
    "holidays_synced_at" TIMESTAMP(3),
    "default_tier_key" TEXT,
    -- 'dropdown' | 'radios': how the cart shows the per-line service picker.
    "cart_control_style" TEXT NOT NULL DEFAULT 'dropdown',
    -- Whether a product page names the delivery services the chosen variation
    -- cannot have (greyed out, with the choice that does carry them).
    "show_unavailable_services" BOOLEAN NOT NULL DEFAULT true,
    "cutoff_time" TEXT NOT NULL DEFAULT '12:00',
    "dispatch_lead_days" INTEGER NOT NULL DEFAULT 1,
    "ship_days" JSONB NOT NULL DEFAULT '[1, 2, 3, 4, 5]',
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ash_settings_singleton" CHECK ("id" = 'singleton')
);
INSERT INTO "ash_settings" ("id") VALUES ('singleton') ON CONFLICT ("id") DO NOTHING;

-- A purchasable delivery service (e.g. standard, express, full installation).
-- `transit_days` is the service's usual courier time in working days, added on
-- top of the shop-wide dispatch timing; `min_lead_days` floors the whole
-- estimate at a working-day minimum (e.g. full installation ~10 days), never
-- brings it in. `description` is shopper-facing copy shown beside the service
-- wherever it is offered.
CREATE TABLE IF NOT EXISTS "ash_service_tiers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "transit_days" INTEGER NOT NULL DEFAULT 0,
    "min_lead_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_service_tiers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ash_service_tiers_key_key" ON "ash_service_tiers" ("key");

-- Where a service is offered, and at what price and timing. `scope_type` is
-- DEFAULT | SUPPLIER | CATEGORY | RANGE; `scope_ref` is the supplier name,
-- shp_categories.id, or pat_attribute_values.id it keys on (NULL for DEFAULT).
-- A product resolves each service to the most specific row that matches: range,
-- else category (nearest ancestor), else supplier, else default. A service with
-- no matching row is simply not offered for that product - absence is the
-- availability switch, which is also how a service is limited to one supplier
-- (give it a single SUPPLIER row). `transit_days` / `min_lead_days` are absolute
-- working-day values; NULL inherits the service's own.
CREATE TABLE IF NOT EXISTS "ash_tier_scope_config" (
    "id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_ref" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "price" NUMERIC(10, 2) NOT NULL DEFAULT 0,
    "transit_days" INTEGER,
    "min_lead_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_tier_scope_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ash_tier_scope_config_tier_fk"
        FOREIGN KEY ("tier_id") REFERENCES "ash_service_tiers"("id") ON DELETE CASCADE
);
-- One row per (service, scope). scope_ref is NULL for DEFAULT, so COALESCE keeps
-- the uniqueness real (a plain UNIQUE treats every NULL as distinct, which would
-- let two default rows coexist).
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
