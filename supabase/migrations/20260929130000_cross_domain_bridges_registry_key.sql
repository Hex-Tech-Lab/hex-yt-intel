-- Cross-Domain Bridges cap (2026-09-29, R1b): replaces an inline hardcoded
-- max-length for the new top-level `crossDomainBridges` payload field (dim 8.3
-- Cross-Domain Bridges, produced by the projective bundle and stitched into
-- dimension 8's content). Registry-resolved at the stitch step; the code
-- fallback is 4000. It is display text, not a security boundary — over-cap
-- output is truncated with a warning, never rejected.
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.layer2.crossDomainBridgesMaxChars',
    'system',
    'number',
    '{"min": 200, "max": 20000}'::jsonb,
    '4000'::jsonb,
    'Maximum characters for the crossDomainBridges payload field (UCIS sub-dimension 8.3 Cross-Domain Bridges, produced by the projective Layer-2 bundle). Over-cap markdown is truncated at the stitch step with a logged warning; it is display text, not a security boundary.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key = 'analysis.layer2.crossDomainBridgesMaxChars'
on conflict (setting_key, scope_type, scope_id) do nothing;
