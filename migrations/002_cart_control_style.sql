-- Advanced Shipping for Shop - add the cart tier-picker display style.
-- Existing installs ran 001 before this column existed; 001 also carries the
-- column now for fresh installs, so this ALTER is a harmless no-op there.
-- Idempotent, safe to re-run on every deploy.
--
-- 'dropdown' (default) shows the per-line delivery-tier picker as a compact
-- <select>; 'radios' shows every tier at once as a radio group.
ALTER TABLE "ash_settings" ADD COLUMN IF NOT EXISTS "cart_control_style" TEXT NOT NULL DEFAULT 'dropdown';
