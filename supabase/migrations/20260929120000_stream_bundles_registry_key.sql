-- R1a (2026-09-29): bundle map single source of truth.
-- The dispatch topology (which dimensions each of the 5 parallel LLM streams
-- produces) previously had THREE disagreeing sources: the code constant
-- STREAM_BUNDLES (web/lib/config/synthesis.ts), the hardcoded
-- getDefaultAdminSettings().streamBundles literal, and the live
-- admin_settings.stream_bundles DB row (which silently won in production).
-- This migration seeds the Settings Registry key `analysis.streamBundles`
-- (the new single authority, resolved server-side by CreateAnalysisUseCase
-- and delivered to the client as job.streamBundles) with the user-approved
-- target map, and aligns admin_settings.stream_bundles to the same map.
--
-- NOTE: admin_settings.stream_bundles is DEPRECATED in favour of the
-- registry key `analysis.streamBundles`. Remaining readers must migrate;
-- this column is only kept aligned so any straggler reader agrees.
--
-- Target map (user-approved 2026-09-29), order fixed:
--   [1, 10]  grounded (Apex + Credibility)
--   [2, 4, 6] grounded (Provenance, Psychological, Comparative)
--   [5, 7]   grounded (Core Intelligence, Implementation)
--   [3, 8]   grounded (Architecture + Semantic/KG; dim 8 = 8.1/8.2/8.4 only)
--   [9, 11]  projective (Forward Foresight + Commercial Yield)
-- TOTAL_STREAMS stays 5 (persist chunk accounting, finalize and the reaper
-- depend on it).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.streamBundles',
    'system',
    'json',
    '{"type": "array", "items": {"type": "array", "items": {"type": "integer"}}}'::jsonb,
    '[[1,10],[2,4,6],[5,7],[3,8],[9,11]]'::jsonb,
    'Dimension partition for the 5 parallel synthesis streams. INVARIANT (enforced server-side by assertBundlePartition before use): exactly 5 bundles, every dimension 1..11 appears exactly once, no 0 and no duplicates. Invalid values fall back to the code constant STREAM_BUNDLES with a Sentry error. Supersedes admin_settings.stream_bundles (deprecated).',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'analysis.streamBundles'
on conflict (setting_key, scope_type, scope_id) do nothing;

-- Align the deprecated column so any remaining reader (admin settings UI,
-- /api/admin/settings) agrees with the registry.
update public.admin_settings
set stream_bundles = '[{"dimensions":[1,10]},{"dimensions":[2,4,6]},{"dimensions":[5,7]},{"dimensions":[3,8]},{"dimensions":[9,11]}]'::jsonb
where id = 'default';
