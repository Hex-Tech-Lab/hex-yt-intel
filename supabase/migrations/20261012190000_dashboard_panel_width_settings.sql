-- Dashboard default panel widths into the Settings Registry (2026-10-12, T18).
-- Percent widths, in Group order: 2col = [sidebar, center], 3col = [sidebar, center, right].
-- Mirrors DEFAULT_LAYOUT in web/lib/hooks/useDashboardLayout.ts (code fallback,
-- used when the registry is unreachable or the stored value is invalid).
-- A user's saved localStorage layout still takes precedence over these defaults.
-- NOT applied by the implementing agent (ADR 018/013: CI applies on merge).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'ui.dashboard.panelWidths.2col',
    'system',
    'array',
    '{}'::jsonb,
    '[18, 82]'::jsonb,
    'Default dashboard panel widths (percent) for the 2-column desktop layout: [sidebar, center]. Used until a user resizes their own panels.',
    'admin'
  ),
  (
    'ui.dashboard.panelWidths.3col',
    'system',
    'array',
    '{}'::jsonb,
    '[18, 54, 28]'::jsonb,
    'Default dashboard panel widths (percent) for the 3-column desktop layout: [sidebar, center, right]. Used until a user resizes their own panels.',
    'admin'
  )
on conflict (key) do nothing;
