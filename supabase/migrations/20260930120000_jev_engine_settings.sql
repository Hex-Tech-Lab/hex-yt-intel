-- ADR 037 (R3b step 1): Jev semantic chunking engine tunables.
-- Pure deterministic boundary engine config; the pipeline wiring (dynamic
-- stream count, signing, finalize/reaper) is step 2 and gated behind
-- `analysis.jev.enabled` (default false). Editable without redeploy per the
-- standing no-hardcoded-tunables directive, same convention as
-- 20260911180911_remediation_quarantine_ttl_setting.sql.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.jev.enabled',
    'system',
    'boolean',
    '{}'::jsonb,
    'false'::jsonb,
    'Master switch for the Jev semantic chunking pipeline (ADR 037). When false, the legacy whole-transcript 5-stream path is used. Wiring lands in step 2; this key exists so the flag is in place before any pipeline change.',
    'admin'
  ),
  (
    'analysis.jev.windowWords',
    'system',
    'number',
    '{"min": 20, "max": 1000}'::jsonb,
    '100'::jsonb,
    'Sliding window size N in words for the Conceptual Density Index (CDI = target terms / total words within the window). ADR 037 locked spec: N=100.',
    'admin'
  ),
  (
    'analysis.jev.windowStrideWords',
    'system',
    'number',
    '{"min": 10, "max": 1000}'::jsonb,
    '100'::jsonb,
    'Stride in words between consecutive CDI windows. Equal to N (100) gives disjoint windows; smaller strides overlap windows for finer boundary resolution.',
    'admin'
  ),
  (
    'analysis.jev.deltaCdiThreshold',
    'system',
    'number',
    '{"min": 0, "max": 1}'::jsonb,
    '0.08'::jsonb,
    'Tau: the |ΔCDI| between consecutive windows above which the window start becomes a boundary candidate. Strictly greater-than comparison; a difference exactly equal to tau is NOT a candidate.',
    'admin'
  ),
  (
    'analysis.jev.fluffCdiThreshold',
    'system',
    'number',
    '{"min": 0, "max": 1}'::jsonb,
    '0.05'::jsonb,
    'Theta_fluff: a window whose CDI is below this is a fluff window (low information density). Per-chunk fluffRatio counts these windows.',
    'admin'
  ),
  (
    'analysis.jev.minChunkTokens',
    'system',
    'number',
    '{"min": 100, "max": 50000}'::jsonb,
    '1500'::jsonb,
    'Minimum chunk size in tokens (tokens = whitespace-separated words; no tokenizer exists). Candidate cuts are searched in [cursor+min, cursor+max]; a short final remainder below this is merged into the previous chunk when that keeps it within max.',
    'admin'
  ),
  (
    'analysis.jev.maxChunkTokens',
    'system',
    'number',
    '{"min": 200, "max": 100000}'::jsonb,
    '6000'::jsonb,
    'Maximum chunk size in tokens (whitespace-separated words). Chunks exceeding this can only arise from the documented maxChunks merge exception.',
    'admin'
  ),
  (
    'analysis.jev.maxChunks',
    'system',
    'number',
    '{"min": 1, "max": 32}'::jsonb,
    '8'::jsonb,
    'Upper bound on the number of chunks produced for one transcript. Excess chunks are merged (smallest combined pair first) until within the bound; merges may exceed maxChunkTokens (documented exception).',
    'admin'
  ),
  (
    'analysis.jev.acronymMinLength',
    'system',
    'number',
    '{"min": 2, "max": 6}'::jsonb,
    '2'::jsonb,
    'Minimum character length for an all-caps acronym to count as a target term.',
    'admin'
  ),
  (
    'analysis.jev.contentWordMinLength',
    'system',
    'number',
    '{"min": 1, "max": 12}'::jsonb,
    '4'::jsonb,
    'Minimum character length for a lowercase content word to count as a target term.',
    'admin'
  ),
  (
    'analysis.jev.countAcronyms',
    'system',
    'boolean',
    '{}'::jsonb,
    'true'::jsonb,
    'Whether all-caps acronyms (e.g. NASA, API) count as target terms in the CDI numerator.',
    'admin'
  ),
  (
    'analysis.jev.countProperNouns',
    'system',
    'boolean',
    '{}'::jsonb,
    'true'::jsonb,
    'Whether capitalized mid-sentence words (proper nouns) count as target terms in the CDI numerator.',
    'admin'
  ),
  (
    'analysis.jev.countNumbers',
    'system',
    'boolean',
    '{}'::jsonb,
    'true'::jsonb,
    'Whether words starting with a digit count as target terms in the CDI numerator.',
    'admin'
  ),
  (
    'analysis.jev.countContentWords',
    'system',
    'boolean',
    '{}'::jsonb,
    'true'::jsonb,
    'Whether non-stopword, non-filler lowercase content words count as target terms in the CDI numerator.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key like 'analysis.jev.%'
on conflict (setting_key, scope_type, scope_id) do nothing;
