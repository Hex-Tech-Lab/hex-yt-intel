-- Wave D2: register the comments-grounding fetch tunables in the settings
-- registry (Wave D1, 20260723090000) instead of leaving them as hardcoded
-- module constants in worker/src/routes/analysis.ts.
--
-- These are read server-side (Vercel, which has DB access) by
-- CreateAnalysisUseCase at analysis-kickoff time and forwarded to the
-- Cloudflare Worker as part of the signed stream payload -- the worker has
-- no direct Supabase access (it's a pure fetch/stream service, see ADR 005),
-- so this is the correct place in the hybrid-edge architecture to resolve a
-- live, admin-editable value and hand it down, rather than giving the worker
-- its own DB dependency for one tuning knob.
--
-- Values below replace the ad-hoc constants introduced in commit b8907f65
-- (initial comments grounding) and 0b05f7f0 (a blind 4s->9s timeout bump,
-- corrected here): the fetch is sized against the video's KNOWN comment
-- count (already available pre-fetch from videos.list) rather than a single
-- fixed timeout picked without checking what's actually being fetched.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'chat.comments.maxResults',
    'system',
    'number',
    '{"min": 1, "max": 100}'::jsonb,
    '20'::jsonb,
    'Maximum comments fetched per video via commentThreads.list (relevance-ordered). The actual request size is min(this, the video''s known total comment count) -- never requests more than exists. YouTube Data API caps a single page at 100.',
    'admin'
  ),
  (
    'chat.comments.maxAttempts',
    'system',
    'number',
    '{"min": 1, "max": 5}'::jsonb,
    '2'::jsonb,
    'Retry attempts for the commentThreads.list call through the residential proxy before giving up for this analysis (403/404 short-circuit immediately regardless -- comments disabled/quota-denied never changes on retry).',
    'admin'
  ),
  (
    'chat.comments.timeoutPerAttemptMs',
    'system',
    'number',
    '{"min": 1000, "max": 15000}'::jsonb,
    '4000'::jsonb,
    'Per-attempt timeout budget for one commentThreads.list round trip through the residential proxy. Total worst-case wait = this * chat.comments.maxAttempts. A prior incident (2026-07-23) used a single fixed 4s timeout racing a function that internally retried twice, so it silently lost the race on nearly every real analysis -- comments must budget per attempt, not as one flat constant.',
    'admin'
  ),
  (
    'chat.comments.maxPayloadBytes',
    'system',
    'number',
    '{"min": 2000, "max": 100000}'::jsonb,
    '20000'::jsonb,
    'Serialized-size cap for the comments list persisted into validation_report.comments and included in chat grounding. Comments are dropped from the end (already relevance-ordered) until the list fits.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in (
  'chat.comments.maxResults',
  'chat.comments.maxAttempts',
  'chat.comments.timeoutPerAttemptMs',
  'chat.comments.maxPayloadBytes'
)
on conflict (setting_key, scope_type, scope_id) do nothing;
