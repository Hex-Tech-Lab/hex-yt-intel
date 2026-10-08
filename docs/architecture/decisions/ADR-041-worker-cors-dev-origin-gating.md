# ADR 041: Worker CORS — Production-Gated Localhost Trust & Fail-Closed Origin Parsing

**Status:** Accepted (implemented on `phase-c`, PR #442 — 718f6580, 7cd52b6d)
**Date:** 2026-10-08
**Context:** `worker/src/middleware/cors.ts`'s `resolveCorsOrigin` trusted `LOCAL_DEV_ORIGINS` (`localhost:3000/3005`) unconditionally, while `isValidAppUrl` already rejected localhost in production. QualityEngine flagged this as "localhost fallback in production route" and blocked CI (run 37615906693). Worker-side `NODE_ENV` is never set on Cloudflare Workers (see `worker/src/env-utils.ts`), so a `NODE_ENV !== 'production'` guard — as first proposed — would read every deployed worker as non-production and re-open the hole. Separately, Cubic (PR #442) flagged that the `[CORS]` error log inside the URL-parse catch let an unauthenticated caller emit one error log per request with a malformed `Origin`.

### Decisions

1. **One production test for every trust path.** `resolveCorsOrigin(origin, isProd = true)` and `isValidAppUrl(..., isProd)` both take `isProd` from `isProductionEnv(env)` — `ENVIRONMENT` first, `NODE_ENV` fallback, **unset ⇒ production (fail closed)**. All four callers (`worker.ts` CORS middleware, `error-handler.ts`, `chat-stream.ts`, `routes/analysis.ts`) pass it explicitly. Never gate on `NODE_ENV` alone in the worker.
2. **Localhost is dev-only.** `LOCAL_DEV_ORIGINS` is honoured only when `isProd === false`. Production and preview allowlists (`PRODUCTION_ORIGINS`, `OWN_VERCEL_PREVIEW_RE`) are unchanged and remain the single source of truth for both CORS and callback validation.
3. **Malformed origins are expected input, not errors.** `isTrustedProductionOrigin` rejects anything that fails a cheap `^https?://host[:port]$` shape check *before* `new URL()`. The catch keeps `console.error('[CORS]', error)` (QualityEngine observability rule) but is unreachable for attacker-shaped input, so log volume cannot be driven by request headers.

### Consequences

- `wrangler.toml` sets `ENVIRONMENT="production"` at top level, so plain `wrangler dev` now rejects `localhost` origins. **Local worker development must set `ENVIRONMENT=development` in `worker/.dev.vars`.**
- The fatal-error path (`errorHandler`) echoes CORS headers using the same gate, so dev and prod 500s stay readable by exactly the same origins as normal responses.
- Tests: `worker/src/__tests__/cors.test.ts` (prod/dev gating, malformed origin ⇒ null with no log), `worker/src/middleware/__tests__/error-handler.test.ts` (kept under `middleware/__tests__` so the QualityEngine sibling-test rule sees it; added to `web/vitest.config.ts`'s include list so it actually runs).

### Alternatives rejected

- **Delete `LOCAL_DEV_ORIGINS` / throw 500 when `APP_URL` is missing** — breaks local development and does not address the real trust question.
- **`NODE_ENV`-only gate** — always non-production on Workers; fail-open.
- **Drop the catch log** — violates the QualityEngine observability rule; the pre-check removes the flooding vector instead.
