-- Bind a service tier to a single supplier (prefix ash_). Idempotent, safe to
-- re-run on every deploy.
--
-- A tier may now be offered only for products from one named supplier, so a shop
-- can run several same-named tiers (e.g. "Full installation") that differ by
-- which supplier fulfils them - the storefront offers each line only the tiers
-- whose supplier matches its product. NULL keeps a tier supplier-agnostic
-- (offered to every product, exactly as before this column existed), so the
-- column is inert on every existing tier. TEXT stays inside the backup
-- serialiser's supported set.
ALTER TABLE "ash_service_tiers"
    ADD COLUMN IF NOT EXISTS "supplier" TEXT;
