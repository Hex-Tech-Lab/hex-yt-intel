-- Grants for the new /admin/settings page (Wave D1's settings_access_matrix,
-- previously unpopulated -- "Settings admin write-path UI is unexercised" per
-- the roster). Admin gets read+write on the page; every other role stays
-- hidden (enforced today by the page's own server-side role check, this
-- table is the declared intent the route layer should read going forward
-- rather than hardcoding 'admin' checks per-route as new settings surfaces
-- are added).

insert into public.settings_access_matrix (role, surface_type, surface_id, setting_key, permission)
values
  ('admin', 'page', 'admin/settings', null, 'write'),
  ('moderator', 'page', 'admin/settings', null, 'hidden'),
  ('user', 'page', 'admin/settings', null, 'hidden')
on conflict (role, surface_type, surface_id, setting_key) do nothing;

-- Field-level: every currently-registered setting is admin-write, hidden to
-- everyone else. Loops over setting_definitions so newly-added settings need
-- no matching matrix row edit (defaults to admin-only via the page grant
-- above); this makes the intent explicit per-key for auditability.
insert into public.settings_access_matrix (role, surface_type, surface_id, setting_key, permission)
select 'admin', 'setting', key, key, 'write' from public.setting_definitions
on conflict (role, surface_type, surface_id, setting_key) do nothing;
