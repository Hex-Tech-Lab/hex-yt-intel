-- ADR 040 (2026-10-05): save-time structural validation for cascade.* registry keys.
--
-- Previously every cascade.* row in setting_definitions carried
-- validation = '{}'::jsonb, which the admin settings save path
-- (web/app/api/admin/settings/[key]/route.ts) treats as "any object
-- accepted" — so any model ID (e.g. claude-3-5-haiku, zero references in
-- code) could be injected with no structural guard beyond the Haiku-4.5
-- providerOrder throw in LLMCascade.ts, and a bad value shipped silently
-- as runtime OpenRouter 404s.
--
-- This migration writes the {"kind":"cascadeRegistry"} marker, which the
-- save path dispatches to the code-derived zod validator
-- (web/lib/config/cascade-validation.ts). The model allowlist lives in
-- CODE (CASCADE_MODEL_ALLOWLIST, derived from CASCADE_FALLBACKS) so it
-- cannot drift from what the code resolves — updated via the same PR flow
-- as code changes, never stored in the DB.
--
-- Covers ALL cascade.* keys (the scan's five + cascade.digest and
-- cascade.entityExtraction, added later); future cascade.* keys are
-- covered by the `like` predicate automatically.
update public.setting_definitions
set validation = '{"kind":"cascadeRegistry"}'::jsonb
where key like 'cascade.%';
