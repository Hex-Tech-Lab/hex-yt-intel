-- Registers the channel-metadata fetch tunables in the settings registry
-- (Wave D1, 20260723090000) instead of leaving them as hardcoded worker
-- constants -- same reasoning as chat.comments.* (20260723190000).
--
-- RCA (2026-07-24): worker/src/routes/analysis.ts had two hardcoded
-- constants gating channel-metadata fetch (a 4s race timeout and a 20KB
-- payload cap). Both silent-drop paths had zero Sentry telemetry, unlike the
-- fetch's other two failure paths (non-2xx response, thrown exception) --
-- this is why the "Channel Meta" history chip was consistently grey with no
-- corresponding Sentry issue anywhere: the drop was happening through the
-- two uninstrumented paths. Sentry telemetry was added to both drop paths in
-- the same fix; this migration additionally moves the two magic numbers
-- themselves into the registry per this project's no-hardcoded-magic-numbers
-- convention, mirroring the comments-fetch settings pattern exactly.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'chat.channelMeta.timeoutMs',
    'system',
    'number',
    '{"min": 1000, "max": 15000}'::jsonb,
    '4000'::jsonb,
    'Time budget (ms) for the Decodo youtube_channel scrape before the worker proceeds without channel metadata for this analysis. A race, not a request timeout -- the underlying fetch keeps running in the background and is cached for the next request even if this one times out.',
    'admin'
  ),
  (
    'chat.channelMeta.maxPayloadBytes',
    'system',
    'number',
    '{"min": 2000, "max": 100000}'::jsonb,
    '20000'::jsonb,
    'Serialized-size cap for the scraped channel metadata object persisted into validation_report.channelMeta and included in chat grounding. Decodo''s youtube_channel scrape can return large nested objects with no upstream shape/size constraint; anything over this cap is dropped entirely (not truncated) since there is no safe partial-object cut point.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('chat.channelMeta.timeoutMs', 'chat.channelMeta.maxPayloadBytes')
on conflict (setting_key, scope_type, scope_id) do nothing;
