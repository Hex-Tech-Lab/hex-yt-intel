-- ADR 019: remediate-missing-dimensions budget as a dollar-denominated
-- token bucket instead of a fixed batch size / mutex lock. See
-- docs/specs/ADR_019_REMEDIATION_BUDGET_TOKEN_BUCKET_2026-07-31.md.
-- OpenRouter exposes no hard concurrency limit (rate_limit.requests is -1,
-- deprecated) -- the real constraint is the account's monthly $ spend cap,
-- shared with live paying traffic. Every number here is retunable from the
-- settings page without a redeploy, per the standing no-hardcoded-tunables
-- directive.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'remediation.enabled',
    'system',
    'boolean',
    '{}'::jsonb,
    'true'::jsonb,
    'Kill switch for the dimension-remediation harness (web/lib/services/dimension-remediation.ts). Set false to pause without a redeploy.',
    'admin'
  ),
  (
    'remediation.budgetPercentOfRemaining',
    'system',
    'number',
    '{"min": 0, "max": 100}'::jsonb,
    '10'::jsonb,
    'Percent of OpenRouter''s LIVE remaining monthly balance (GET /api/v1/auth/key, re-fetched periodically, not a one-time snapshot) that remediation''s token-bucket capacity is derived from.',
    'admin'
  ),
  (
    'remediation.hardCapUsdCents',
    'system',
    'number',
    '{"min": 0, "max": 10000000}'::jsonb,
    '200'::jsonb,
    'Absolute ceiling on remediation token-bucket capacity, in USD cents, applied via min() alongside budgetPercentOfRemaining. 0 = no hard cap (percentage alone governs). Default $2.00 for bootstrap/dev; raise once in pilot/production per ADR 019.',
    'admin'
  ),
  (
    'remediation.periodDays',
    'system',
    'number',
    '{"min": 1, "max": 365}'::jsonb,
    '30'::jsonb,
    'Token-bucket refill window in days -- capacity refills continuously over this period, matching OpenRouter''s own monthly reset cadence. A full bucket can still burst-spend its entire capacity immediately; this only bounds the steady-state refill rate.',
    'admin'
  ),
  (
    'remediation.maxRetries',
    'system',
    'number',
    '{"min": 1, "max": 20}'::jsonb,
    '3'::jsonb,
    'Max remediation attempts per analysis before it is excluded from future sweeps, to bound spend on a persistently-failing row.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in (
  'remediation.enabled',
  'remediation.budgetPercentOfRemaining',
  'remediation.hardCapUsdCents',
  'remediation.periodDays',
  'remediation.maxRetries'
)
on conflict (setting_key, scope_type, scope_id) do nothing;
