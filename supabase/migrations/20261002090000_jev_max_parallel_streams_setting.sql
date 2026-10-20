-- ADR 037 Addendum A6 (R3b step 2.3.5e): client-side concurrency cap for
-- parallel Jev cell streams. Registry-driven per the standing
-- no-hardcoded-tunables directive. NOT applied by the implementing agent
-- (ADR 018: CC applies migrations). Applied on merge by CI / the Supabase
-- integration.
--
-- Default derivation (2026-10-02, §5.0.1 rule 6 — empirically bounded):
-- The browser parallel stream cap throttles simultaneous fetch connections to
-- the Cloudflare worker. Under HTTP/2, browsers multiplex multiple requests
-- over a single TCP connection, but typical browser connection pools and
-- Cloudflare worker connection limits operate reliably around 6 concurrent
-- active streams (matches 6-connection per-host HTTP/1.1 limit and standard
-- parallel worker pool size in ExtractHighlightsUseCase/bakeoff). Range [1, 32]
-- allows single-stream sequential up to max cells in a wave (32).

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.jev.maxParallelStreams',
    'system',
    'number',
    '{"min": 1, "max": 32}'::jsonb,
    '6'::jsonb,
    'Maximum concurrent worker stream requests in flight during Jev K>1 cell dispatch waves (ADR 037 Addendum A6, R3b 2.3.5e). Defaults to 6.',
    'admin'
  )
on conflict (key) do nothing;
