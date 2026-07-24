-- Wires Phase 3b's paginated fetch (worker/src/services/MetadataScraper.ts
-- fetchCommentsPage) into the live synchronous Tier 0-2 analysis path.
-- Building a representative pool for stratified sampling needs more than
-- one page, but this runs inside the dual-timeout streaming budget (ADR 002),
-- not Tier 3's async queue -- so the pool build itself must stay bounded.
-- Tier 3 has no such bound (uncapped by design); these keys are specific to
-- the synchronous Tier 0-2 path only.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'comments.sampling.syncPoolMaxPages',
    'system', 'number', '{"min": 1, "max": 50}'::jsonb, '10'::jsonb,
    'Max commentThreads.list pages (100/page) fetched to build the stratified-sampling pool for the synchronous Tier 0-2 analysis path. Bounded because this runs inside the dual-timeout streaming budget (ADR 002), not Tier 3''s uncapped async queue -- for very large comment counts, sampling is over a partial (but far larger/more representative than the old single-page fetch) pool, not the true full population.',
    'admin'
  ),
  (
    'comments.sampling.syncPoolTimeoutMs',
    'system', 'number', '{"min": 1000, "max": 20000}'::jsonb, '8000'::jsonb,
    'Time budget for the synchronous Tier 0-2 pool-fetch loop, independent of syncPoolMaxPages -- whichever bound hits first stops the loop. Mirrors the existing chat.comments.timeoutPerAttemptMs / chat.channelMeta.timeoutMs bounded-best-effort pattern.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('comments.sampling.syncPoolMaxPages', 'comments.sampling.syncPoolTimeoutMs')
on conflict (setting_key, scope_type, scope_id) do nothing;
