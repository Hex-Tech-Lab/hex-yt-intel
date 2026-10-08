-- Phase C grounded-claims persist retry policy (2026-10-09). Registers the
-- Settings Registry key read by web/lib/usecases/epistemic-shadow-grant.ts and
-- parsed by parseEpistemicPersistRetry (web/lib/config/epistemic-shadow.ts).
-- Before this row existed, the lookup always returned the code fallback, so
-- the registry value could never take effect.
--
-- Default matches EPISTEMIC_PERSIST_RETRY_DEFAULT. The validation object
-- documents the bounds that parseEpistemicPersistRetry enforces (code is the
-- authority; keep the two in step): maxAttempts 1..10, attemptTimeoutMs
-- 1000..60000, each backoff delay 0..60000 with exactly maxAttempts-1 entries,
-- and the whole timeline (backoff plus attempt timeouts) at most 240000 ms.
-- NOT applied by the implementing agent (ADR 018/013: CI applies on merge).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.pipeline.retry.epistemic',
    'system',
    'json',
    '{"maxAttempts": {"min": 1, "max": 10}, "attemptTimeoutMs": {"min": 1000, "max": 60000}, "backoffDelays": {"itemMin": 0, "itemMax": 60000, "lengthEquals": "maxAttempts-1"}, "maxTotalMs": 240000}'::jsonb,
    '{"maxAttempts": 3, "backoffDelays": [250, 500], "attemptTimeoutMs": 10000}'::jsonb,
    'Retry policy for the Epistemic grounded-claims persist (worker to Vercel). maxAttempts counts the first attempt; backoffDelays[i] is the wait before attempt i+2; attemptTimeoutMs bounds each POST. Invalid values fall back to the code default.',
    'admin'
  )
on conflict (key) do nothing;
