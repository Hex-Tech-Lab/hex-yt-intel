-- Phase C shadow mode flag (2026-10-08). When true, Vercel signs a grant that
-- lets the worker run the Epistemic pipeline in the background for an analysis
-- (web/lib/config/epistemic-shadow.ts); the live dimension stream is unchanged.
-- Default false: production keeps the legacy pipeline only until an admin flips it.
-- NOT applied by the implementing agent (ADR 018/013: CI applies on merge).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.pipeline.epistemic',
    'system',
    'boolean',
    '{}'::jsonb,
    'false'::jsonb,
    'Phase C shadow mode: also run the Epistemic pipeline (sensor fusion, grounded extraction, projective synthesis) in the background and store grounded claims on the analysis. Does not change what users see. Defaults to false.',
    'admin'
  )
on conflict (key) do nothing;
