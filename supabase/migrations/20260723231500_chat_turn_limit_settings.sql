-- Usage tab work (2026-07-24): move the hardcoded per-tier chat turn limits
-- out of ProcessChatMessageUseCase.ts's inline
-- `{free: 5, pro: 30, enterprise: 100}` object and into the settings
-- registry (Wave D1, 20260723090000), following the same pattern as the
-- comments-fetch tunables in 20260723190000_comments_fetch_settings.sql --
-- standing rule: no hardcoded tunables, everything admin-editable via the
-- registry. Defaults below exactly match the values being replaced so this
-- migration is a pure relocation, not a behavior change.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'chat.turnLimit.free',
    'system',
    'number',
    '{"min": 1, "max": 50}'::jsonb,
    '5'::jsonb,
    'Maximum user messages per conversation for free-tier users before ERR_CHAT_LIMIT_EXCEEDED. Enforced in ProcessChatMessageUseCase.execute step 3.',
    'admin'
  ),
  (
    'chat.turnLimit.pro',
    'system',
    'number',
    '{"min": 1, "max": 200}'::jsonb,
    '30'::jsonb,
    'Maximum user messages per conversation for pro-tier users before ERR_CHAT_LIMIT_EXCEEDED. Enforced in ProcessChatMessageUseCase.execute step 3.',
    'admin'
  ),
  (
    'chat.turnLimit.enterprise',
    'system',
    'number',
    '{"min": 1, "max": 1000}'::jsonb,
    '100'::jsonb,
    'Maximum user messages per conversation for enterprise-tier users before ERR_CHAT_LIMIT_EXCEEDED. Enforced in ProcessChatMessageUseCase.execute step 3.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in (
  'chat.turnLimit.free',
  'chat.turnLimit.pro',
  'chat.turnLimit.enterprise'
)
on conflict (setting_key, scope_type, scope_id) do nothing;
