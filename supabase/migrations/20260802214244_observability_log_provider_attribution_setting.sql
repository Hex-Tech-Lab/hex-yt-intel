-- Standing directive (2026-08-02): all external OpenRouter calls (not just
-- stance-relations) should be able to log the requested-vs-actually-served
-- provider, toggleable from settings rather than hardcoded on/off per call
-- site. Defaults true during active development/troubleshooting per
-- explicit instruction ("we need it logged... we are in troubleshooting
-- mode"). console.log only (not Sentry) -- free, high-volume-safe, visible
-- in Vercel/CF Worker log streams without adding Sentry event volume/cost.
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values (
  'observability.logProviderAttribution',
  'system',
  'boolean',
  '{}'::jsonb,
  'true'::jsonb,
  'When true, every OpenRouter completion call logs (console.log only, not Sentry) the requested providerOrder vs the provider OpenRouter''s response actually attributes as having served the request. Default true while in active development -- flip to false once provider-routing questions are resolved and the log volume is no longer needed.',
  'admin'
);
