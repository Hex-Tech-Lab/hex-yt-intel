-- Live production report (2026-07-25): a chat request for "what was said in
-- minute 42" returned a transcript excerpt starting slightly AFTER the
-- actual relevant discussion -- the matched minute boundary doesn't align to
-- where a sentence actually starts, so a few seconds of lead-in context were
-- being dropped. Fix: extractRequestedTranscriptRange (extract-transcript-
-- range.ts) now widens its inclusion window's start earlier by this many
-- seconds. Per standing rule (no hardcoded tunables), the buffer amount is
-- registry-driven, following the exact same pattern as
-- 20260723231500_chat_turn_limit_settings.sql. Default of 5s chosen as a
-- typical single-sentence lead-in without swallowing the bulk of the prior
-- minute's unrelated discussion; admin-tunable via 'min'/'max' bounds below
-- without a code deploy.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'chat.transcriptRange.leadInSeconds',
    'system',
    'number',
    '{"min": 0, "max": 30}'::jsonb,
    '5'::jsonb,
    'Seconds subtracted from a detected minute/timestamp range''s start before slicing transcript lines for chat grounding, so the excerpt includes lead-in context instead of starting mid-thought. Clamped to >=0 in extractRequestedTranscriptRange. Enforced in ProcessChatMessageUseCase.execute.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'chat.transcriptRange.leadInSeconds'
on conflict (setting_key, scope_type, scope_id) do nothing;
