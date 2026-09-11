-- ADR 021 Phase 4 (2026-09-11): flip abort_on_partial_failure default from
-- true to false. The module constant in synthesis.ts was already flipped to
-- false, but the DB column default and the adapter default
-- (getDefaultAdminSettings) were still true, making the module constant dead
-- code in production: adminSettings.abortOnPartialFailure resolved to true
-- (from DB or adapter default) before the ?? DEFAULT_ABORT_ON_PARTIAL_FAILURE
-- fallback in synthesis-with-settings.ts could fire.
--
-- This migration:
-- 1. Updates any existing rows that still have the old default true.
-- 2. Changes the column default to false so future inserts agree with the
--    code-level default.
-- An admin can still explicitly set this to true via the settings UI — this
-- only changes the DEFAULT, not a hard constraint.

UPDATE admin_settings SET abort_on_partial_failure = false WHERE abort_on_partial_failure = true;

ALTER TABLE admin_settings ALTER COLUMN abort_on_partial_failure SET DEFAULT false;
