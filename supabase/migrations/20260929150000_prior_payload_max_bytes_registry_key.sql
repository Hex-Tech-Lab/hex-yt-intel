-- R1d (2026-09-29): byte cap for the prior_payload guard at the worker stream
-- boundary. Registry-resolved by CreateAnalysisUseCase and forwarded per-request
-- in the signed job fields to the worker (no DB access there, ADR 005) --
-- standing no-hardcoded-tunables directive; the code constant
-- PRIOR_PAYLOAD_MAX_BYTES_FALLBACK (65536, web/lib/config/prior-payload.ts)
-- is the ONLY fallback. Default derived from the R1b grounded-payload shape:
-- 11 dimensions x a few KB of extracted content each sits comfortably under
-- 64 KiB; legitimate payloads are structurally bounded by the grounded
-- bundles' own output contract, so 65536 is a guardrail, not a tuned knob.
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.layer2.priorPayloadMaxBytes',
    'system',
    'number',
    '{"min": 1024, "max": 65536}'::jsonb,
    '65536'::jsonb,
    'Maximum serialized byte length of the prior_payload (grounded dimensions) accepted at the worker /analyze-llm-stream boundary for projective bundles. Oversized or schema-invalid payloads are rejected with HTTP 400 invalid_prior_payload BEFORE any LLM call (R1d, Finding 4). Can only LOWER the cap: the worker clamps every request to a hard ceiling of 65536 (PRIOR_PAYLOAD_MAX_BYTES_CEILING) because the value travels unsigned in the stream request.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'analysis.layer2.priorPayloadMaxBytes'
on conflict (setting_key, scope_type, scope_id) do nothing;
