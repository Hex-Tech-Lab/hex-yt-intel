-- Registers the Settings Registry key cascade.diarization (2026-10-09).
-- resolveDiarizationCascade (web/lib/config/cascade.ts) reads this key, but no
-- setting_definitions row existed, so every lookup returned the code fallback
-- and the cascade could never be tuned from settings.
--
-- Carries the ADR 040 cascadeRegistry validation marker so the admin save path
-- dispatches to validateDiarizationCascadeValue (web/lib/config/cascade-validation.ts).
-- Default matches DIARIZATION_CASCADE_FALLBACK. Each item is an object with
-- provider, name and timeoutMs; the resolver normalizes items and falls back
-- to the code default when the value is empty or invalid.
-- NOT applied by the implementing agent (ADR 018/013: CI applies on merge).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'cascade.diarization',
    'system',
    'json',
    '{"kind": "cascadeRegistry"}'::jsonb,
    '[
      {"provider": "assemblyai", "name": "AssemblyAI Universal-1", "timeoutMs": 15000},
      {"provider": "deepgram", "name": "Deepgram Nova-2", "timeoutMs": 10000}
    ]'::jsonb,
    'Speaker diarization provider cascade: array of {provider, name, timeoutMs} tried in order. Provider must be on the DIARIZATION_PROVIDER_ALLOWLIST (assemblyai, deepgram).',
    'admin'
  )
on conflict (key) do nothing;
