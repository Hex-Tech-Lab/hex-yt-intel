-- Migration to update model_config in app_settings table to use claude-haiku-4.5 and claude-sonnet-4.6:nitro
update public.app_settings
set value = (
  replace(
    replace(value::text, 'anthropic/claude-haiku-4.5', 'anthropic/claude-haiku-4.5'),
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-sonnet-4.6:nitro'
  )
)::jsonb
where key = 'model_config';
