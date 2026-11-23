-- Advanced Shipping for Shop - closed days the shop adds by hand.
--
-- The Holidays screen only ever held the imported gov.uk calendar, so a shop
-- shut for Christmas week or a stocktake had no way to tell the delivery
-- dates. These rows sit beside the imported calendar (never in it: the import
-- replaces ash_holidays wholesale) and count as closed days whichever region
-- the shop follows. One row is one day or an inclusive run of days.
--
-- 001 carries the same table for fresh installs, so this is a harmless no-op
-- there. Idempotent, safe to re-run on every deploy.
CREATE TABLE IF NOT EXISTS "ash_custom_closures" (
    "id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ash_custom_closures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ash_custom_closures_range" CHECK ("end_date" >= "start_date")
);
