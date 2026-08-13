-- Caught by /pr-review-workflow breakage-hunt on PR #233: DubShortLinkAdapter
-- had no timeout, so a stalled Dub request could hold a worker open
-- indefinitely. No hardcoded tunables -- Settings Registry per standing
-- directive.
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values (
  'dub.requestTimeoutMs',
  'system',
  'number',
  '{"min": 1000, "max": 30000}'::jsonb,
  '8000'::jsonb,
  'AbortController timeout for outbound Dub.co API calls (create/analytics/delete short links). Prevents a stalled Dub request from holding a worker open indefinitely.',
  'admin'
)
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'dub.requestTimeoutMs'
on conflict (setting_key, scope_type, scope_id) do nothing;
