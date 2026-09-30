-- Jev comment classifier tunables (dispatch 2026-09-30, CommentClassificationPort
-- adapter JevCommentClassifier). TypeSafe System One (`~typesafe/jev-latest`
-- via the OpenRouter Decisions API) is the classification model per user
-- directive 2026-09-30 — never a chat LLM. Same registry convention as
-- 20260930120000_jev_engine_settings.sql / 20260911180911; seeds mirror the
-- adapter's JEV_CLASSIFIER_CONFIG_DEFAULTS. NOT applied here — CC applies
-- migrations (ADR 018).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'comments.jev.minConfidence',
    'system',
    'number',
    '{"min": 0, "max": 1}'::jsonb,
    '0.5'::jsonb,
    'Sentiment-confidence threshold for Jev comment classifications: a comment whose sentiment confidence is strictly BELOW this is flagged lowConfidence (confidence exactly equal to the threshold is NOT low). Pilot 2026-09-30: 11/111 sampled comments fell below 0.5.',
    'admin'
  ),
  (
    'comments.jev.concurrency',
    'system',
    'number',
    '{"min": 1, "max": 32}'::jsonb,
    '8'::jsonb,
    'Max in-flight Jev Decisions calls per classifyBatch. Pilot 2026-09-30 ran 8 parallel with p95 0.78s and no errors.',
    'admin'
  ),
  (
    'comments.jev.requestTimeoutMs',
    'system',
    'number',
    '{"min": 1000, "max": 60000}'::jsonb,
    '15000'::jsonb,
    'Per-call AbortSignal timeout for one Jev Decisions classification call. Pilot p95 latency was 0.78s; 15s is a ~19x safety margin, bounded to avoid a hung call stalling a batch.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key like 'comments.jev.%'
on conflict (setting_key, scope_type, scope_id) do nothing;
