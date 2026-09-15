-- PR #310 post-merge review, P1b (2026-09-11): when the failure-counter write
-- itself fails persistently (Supabase-side outage), the row's retry count can
-- never increment, so it would be retried unboundedly — the exact 2026-09-01
-- budget-drain class of bug PR #310 was written to prevent, one layer down.
-- The harness now quarantines such rows in Redis
-- (remediation:quarantine:<analysis_id>) so they stop being selected even
-- without the counter. This setting bounds that quarantine's TTL; no
-- empirical incident-length data exists yet, so the fallback outlasts typical
-- Supabase incident windows (minutes-to-hours) while a still-broken write
-- re-quarantines immediately on the next 5-minute tick after expiry.
-- Editable from the settings page without a redeploy, per the standing
-- no-hardcoded-tunables directive (same convention as the ADR 019 seeds in
-- 20260731000000_remediation_budget_settings.sql).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'remediation.quarantineTtlSeconds',
    'system',
    'number',
    '{"min": 60, "max": 2592000}'::jsonb,
    '21600'::jsonb,
    'How long (seconds) an analysis stays quarantined after its failure-counter write failed persistently (P1b, PR #310 post-merge review). Quarantined rows are skipped by the remediation harness even though their retry counter could not be incremented. A still-failing write re-quarantines on the next tick, so this only delays recovery after the underlying write path heals.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('remediation.quarantineTtlSeconds')
on conflict (setting_key, scope_type, scope_id) do nothing;
