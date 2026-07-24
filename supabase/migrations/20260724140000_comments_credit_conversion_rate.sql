-- Adds comments.credit.creditsPerUsd, missed in the initial Phase 1 migration
-- (20260724130000): the Tier 3 credit-estimate adapter needed a USD<->credit
-- conversion rate that didn't exist anywhere in the codebase (verified via
-- grep before adding -- there is no established "1 credit = $X" precedent
-- elsewhere), and it should not be a hardcoded multiplier in application
-- code per this project's no-hardcoded-magic-numbers convention.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'comments.credit.creditsPerUsd',
    'system', 'number', '{"min": 1, "max": 10000}'::jsonb, '100'::jsonb,
    'Conversion rate for Tier 3 credit estimates: how many credits equal $1 USD. No prior convention exists elsewhere in the codebase -- this is a new ratio introduced for this feature, kept registry-driven rather than hardcoded so it can be repriced without a deploy.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'comments.credit.creditsPerUsd'
on conflict (setting_key, scope_type, scope_id) do nothing;
