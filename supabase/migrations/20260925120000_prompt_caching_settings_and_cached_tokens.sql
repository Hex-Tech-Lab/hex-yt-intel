-- Prompt caching for the 5 bundle LLM calls (perf/bundle-prompt-caching, 2026-09-25).
-- Measured (CC, 2026-09-25, analysis 434ef182, Haiku 4.5 via OpenRouter $1/M in,
-- $5/M out): each of the 5 bundles sends ~19.2k input tokens (identical prompt +
-- transcript package), output 1.6k-6.2k; per-analysis cost $0.187 of which input
-- ~= $0.096. Anthropic prompt caching via OpenRouter explicit `cache_control`
-- breakpoints: cache write 1.25x base input, cache read 0.1x -- expected input
-- cost 0.096 -> ~0.032 per analysis (1 write @ 1.25x + 4 reads @ 0.1x on the
-- shared ~19.2k-token prefix).

-- 1) Per-chunk cache accounting: cached_tokens mirrors the existing
-- tokens_used/cost_usd pattern (ADR 020 Phase 3) -- each chunk is an
-- independent OpenRouter call whose `usage.prompt_tokens_details.cached_tokens`
-- is captured in worker/src/services/LLMCascade.ts and persisted so cache
-- savings are measurable per analysis (finalize path can SUM across chunks).
alter table public.analysis_chunks
  add column if not exists cached_tokens integer default 0;

-- 2) Settings Registry keys (standing no-hardcoded-tunables directive) --
-- resolved web-side by CreateAnalysisUseCase and forwarded per-request to the
-- worker, which has no DB access (ADR 005).
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.promptCaching.enabled',
    'system',
    'boolean',
    '{"type": "boolean"}'::jsonb,
    'true'::jsonb,
    'Anthropic prompt caching via OpenRouter explicit cache_control breakpoints on the 5 bundle LLM calls. The shared UCIS-core+metadata+transcript prefix (~19.2k tokens, above Haiku 4.5''s 4096-token cacheable minimum) is marked ephemeral: bundle 1 pays a 1.25x cache write, bundles 2-5 read at 0.1x. Kill switch -- set false to disable (e.g. if a provider route misbehaves with content-block messages).',
    'admin'
  ),
  (
    'analysis.llmCascade.cacheWarmTimeoutMs',
    'system',
    'number',
    '{"min": 0, "max": 30000}'::jsonb,
    '3000'::jsonb,
    'Client-side (useSSEStream) bounded wait before bundles 2-5 start, so Anthropic''s cache entry (written only once the first request''s response begins streaming, per Anthropic''s concurrent-requests caveat) is readable. Derived empirically, not asserted: production Haiku 4.5 first-token latency measured ~3s in the 2026-06-02 cascade benchmark (see worker/src/services/LLMCascade.ts header comment), so a 3s cap covers the TTFB window in which the cache write commits; bundles start immediately on timeout rather than blocking (bounded wait, never a hard gate).',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('analysis.promptCaching.enabled', 'analysis.llmCascade.cacheWarmTimeoutMs')
on conflict (setting_key, scope_type, scope_id) do nothing;