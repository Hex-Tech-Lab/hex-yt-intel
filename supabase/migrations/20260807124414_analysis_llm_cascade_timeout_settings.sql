-- worker/src/services/LLMCascade.ts hardcoded a 120000ms (2 min) total
-- execution timeout per model-tier LLM call in streamCascade -- CLAUDE.md
-- documented this as respecting a "90-second Worker" platform ceiling, but
-- that figure was never a real Cloudflare Workers constraint: CF's own docs
-- confirm wall-clock duration is unlimited for a connected HTTP client on
-- paid plans, only CPU *time* is budgeted (default 30s/invocation,
-- configurable to 5 min), and time spent waiting on an outgoing fetch (the
-- OpenRouter call) does not count toward CPU time at all. OpenRouter's own
-- docs similarly document no hard server-side timeout for streaming
-- completions -- they send SSE keep-alive comments specifically to support
-- long-running generations. This exact 90s-vs-code mismatch was flagged as
-- an open, unresolved issue in this project's own audit history as far back
-- as docs/audit/10X_CODEBASE_AUDIT_2026_06_07.md, never actually fixed.
--
-- Root-caused 2026-08-07 against a real incident: a ~64-minute video (larger
-- transcript = longer LLM generation) hit this 120s timeout, got force-
-- aborted mid-generation, and lost all progress because persistence is
-- bundle-level not dimension-level (separate follow-up) -- with ZERO Sentry
-- visibility because timeouts were deliberately excluded from capture
-- (also fixed in the same commit as this migration).
--
-- Raised to 240000ms (4 min) with real headroom under both platforms'
-- actual constraints, and moved into the registry per the standing
-- no-hardcoded-tunables directive so it's retunable without a worker
-- redeploy if a future incident needs a different value.

-- Also moves the two sibling hardcoded timeouts in this same request path,
-- per explicit user directive: "everything has to be settings registry
-- based" -- not just the one value directly implicated in the incident.
-- handshakeTimeoutMs: worker-internal per-model connect timeout
-- (LLMCascade.ts callLLMStream, was hardcoded 15000). connectionTimeoutMs:
-- the OUTER client-side (Vercel) connection-handshake timeout wrapping the
-- worker call in dimension-remediation.ts (was hardcoded 3000) -- this one
-- genuinely IS bounded by real network/TLS-handshake latency, not LLM
-- generation time, so it stays short; kept separate from timeoutMs
-- intentionally, not merged into one value.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.llmCascade.timeoutMs',
    'system',
    'number',
    '{"min": 30000, "max": 300000}'::jsonb,
    '240000'::jsonb,
    'Total execution timeout (ms) per model-tier LLM call in worker/src/services/LLMCascade.ts streamCascade. Was hardcoded to 120000, which falsely assumed a 90s Cloudflare Worker platform ceiling that does not actually exist for a connected streaming client -- see migration comment for the full RCA.',
    'admin'
  ),
  (
    'analysis.llmCascade.handshakeTimeoutMs',
    'system',
    'number',
    '{"min": 3000, "max": 60000}'::jsonb,
    '15000'::jsonb,
    'Per-model connection-handshake timeout (ms) in worker/src/services/LLMCascade.ts callLLMStream -- how long to wait for OpenRouter to accept the connection before aborting, separate from timeoutMs (the total generation budget once connected). Was hardcoded to 15000.',
    'admin'
  ),
  (
    'analysis.remediation.connectionTimeoutMs',
    'system',
    'number',
    '{"min": 1000, "max": 30000}'::jsonb,
    '3000'::jsonb,
    'Outer client-side (Vercel, web/lib/services/dimension-remediation.ts) connection-handshake timeout before the worker stream itself starts responding -- bounded by real network/TLS latency, deliberately kept short and separate from analysis.llmCascade.timeoutMs. Was hardcoded to 3000.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key in ('analysis.llmCascade.timeoutMs', 'analysis.llmCascade.handshakeTimeoutMs', 'analysis.remediation.connectionTimeoutMs')
on conflict (setting_key, scope_type, scope_id) do nothing;
