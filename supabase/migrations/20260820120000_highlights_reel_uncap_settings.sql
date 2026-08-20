-- Highlights-reel selection was silently ceilinged in two independent
-- places (live user report 2026-08-20, docs/UI_FEEDBACK_TRIAGE_2026-08-20.md
-- items 6-8): (1) the extraction prompt itself said "Select between 4 and 12
-- moments" and (2) parseHighlightsExtraction hard-capped at
-- MAX_HIGHLIGHTS=12 regardless of what the transcript actually contained --
-- for a dense long-form video this produced a reel capped at roughly
-- 10-20% of runtime no matter how much genuinely important content existed.
-- A THIRD, less obvious cap compounded this: the highlights completion call
-- in GenerateExecutiveDigestUseCase never passed an explicit maxTokens, so
-- it silently used OpenRouterCompletionAdapter's DEFAULT_MAX_TOKENS=2000 --
-- a JSON array of 30-40 labeled highlights would have been truncated
-- mid-array by the model's own output limit before the count cap even
-- mattered, causing an 'invalid'/unparseable result on dense videos.
--
-- Per the user's explicit instruction there is no fixed target percentage:
-- capture every genuinely important point, however many that is. These two
-- new registry keys replace the hardcoded MAX_HIGHLIGHTS constant and the
-- implicit 2000-token completion default for this one call path -- no
-- hardcoded magic numbers, per the standing project rule.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values (
  'highlights.maxCount',
  'system',
  'number',
  '{"min": 4, "max": 80}'::jsonb,
  '40'::jsonb,
  'Hard ceiling on how many highlight moments a single extraction pass may keep, after parsing/de-duping/sorting. Replaces the prior hardcoded MAX_HIGHLIGHTS=12 constant in highlights-extraction.ts, which produced a reel capped at roughly 10-20% of video runtime regardless of how much genuinely important content the video contained (live user report 2026-08-20). 40 is a generous defensive ceiling, not a target -- the extraction prompt instructs the model to select every genuinely important moment, however many that is, up to this ceiling.',
  'admin'
),
(
  'highlights.maxOutputTokens',
  'system',
  'number',
  '{"min": 500, "max": 8000}'::jsonb,
  '6000'::jsonb,
  'max_tokens for the highlights-extraction completion call. Previously unset, silently falling back to OpenRouterCompletionAdapter''s DEFAULT_MAX_TOKENS=2000 -- too small for a dense video''s full highlight set once highlights.maxCount was raised, truncating the JSON array mid-response and causing a spurious ''invalid''/unparseable result. 6000 tokens comfortably fits highlights.maxCount(80) x ~200-char labels plus JSON overhead.',
  'admin'
)
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('highlights.maxCount', 'highlights.maxOutputTokens')
on conflict (setting_key, scope_type, scope_id) do nothing;
