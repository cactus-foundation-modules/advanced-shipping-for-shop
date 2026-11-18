-- Splits a delivery price row into what the shop pays and what it charges
-- (prefix ash_). Idempotent, safe to re-run on every deploy.
--
-- Until now each scope row carried one figure, `price`, and it did two jobs: it
-- was what the shopper was charged, and - because purchase orders read the
-- charge back off the order line - what the supplier was paid. A shop that
-- wants to make anything on delivery needs those to differ.
--
-- After this migration:
--   price       the SALES price, charged to the shopper (unchanged meaning on
--               the storefront, so nothing a shopper sees moves today)
--   cost_price  the COST price, what the shop pays the supplier or courier for
--               the service; snapshotted onto each order line at checkout and
--               put on purchase orders raised from it
--
-- Existing rows have their current price copied into cost_price, because the
-- current price IS the cost on every install that has been passing it straight
-- through. The copy runs only in the same step that adds the column, so a
-- re-run never overwrites a cost somebody has since edited. A fresh install's
-- 001 already has the column and skips the whole block. NUMERIC stays inside
-- the backup serialiser's supported set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ash_tier_scope_config' AND column_name = 'cost_price'
  ) THEN
    ALTER TABLE "ash_tier_scope_config"
      ADD COLUMN "cost_price" NUMERIC(10, 2) NOT NULL DEFAULT 0;
    UPDATE "ash_tier_scope_config" SET "cost_price" = "price";
  END IF;
END $$;
