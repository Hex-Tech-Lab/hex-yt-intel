---
Filename: ERROR_TAXONOMY_MANIFEST.md
Location: /docs/specs/
Version: v1.5.0
Build: caff47e
Timestamp: Saturday, 16 May 2026 at 19:45:00 EEST (GCW)
Purpose: Reference guide documenting type-safe API error codes and client-side UI action hooks.
---

# Error Taxonomy Manifest

**File:** `web/app/api/analyses/route.ts`  
**Build anchor:** `caff47e`  
**Status:** Production — live in `main`

---

## 1 · Root Mechanical Cause

The system previously treated every infrastructure failure identically: a flat HTTP 500 with no discriminating detail. A 10-second serverless timeout, an invalid API key, an exhausted credit pool, and a transient DNS drop all returned the same generic error to the caller, making troubleshooting cyclical and opaque.

```
[Upstream DNS Drop] ──────┐
[OpenRouter 401 Unauthorized] ├─► [Flat Catch-all Exception] ─► HTTP 500 (Generic Loop Trap)
[Vercel 10s Server Cutoff] ┘
```

This manifest defines the single, authoritative error classification layer that replaces that black-box behaviour.

---

## 2 · The `AnalysisEngineError` Class

Location: `web/app/api/analyses/route.ts:34`

```typescript
class AnalysisEngineError extends Error {
  code: string;          // e.g. 'ERR_NETWORK_TIMEOUT'
  statusCode: number;    // HTTP status returned to the client
  modelAttempted: string; // which model in the fallback chain broke
  retryAfter?: number;   // seconds, populated only for 429/rate-limit responses
  meta?: AnalysisErrorMeta;
}
```

Every error surfaced from `callOpenRouter` or the route handler carries this shape. The POST handler (line 462) checks `instanceof AnalysisEngineError` and forwards `statusCode` directly; everything else falls through to generic 500.

---

## 3 · Error Taxonomy (Primary Route Table)

| Intercepted Exception Target | `code` | `statusCode` | `modelAttempted` | `retryAfter` | Client UI Action |
|---|---|---|---|---|---|
| Connect handshake exceeded 3 s before response received | `ERR_NETWORK_TIMEOUT` | `408` | model in current loop slot | — | Auto-trigger next backup model fallback layer |
| OpenRouter key rejected — `401` or `403` | `ERR_PROVIDER_AUTH_FAILED` | `401` / `403` | model in current loop slot | — | Alert user: "API key invalid — contact support" |
| Provider returned `429` with optional `Retry-After` header | `ERR_RATE_LIMIT_EXCEEDED` | `429` | model in current loop slot | seconds from header | Fire Tailwind countdown alert / progress bar |
| Non-2xx response that is neither 401/403/429/404 | `ERR_PROVIDER_HTTP_ERROR` | raw upstream status | model in current loop slot | — | Generic provider failure surface |
| All models in the fallback chain exhausted | `ERR_ALL_MODELS_EXHAUSTED` | `502` | last model in chain | — | Surface aggregated `errors` record to UI |
| AbortError *after* handshake confirmed (total-level timeout) | `ERR_UNEXPECTED_FAILURE` | `502` | model in current loop slot | — | Generic unexpected fault surface |
| Non-timeout, non-AnalysisEngineError fault in catch block | `ERR_UNEXPECTED_FAILURE` | `502` | model in current loop slot | — | Generic unexpected fault surface |
| Monthly quota consumed — free tier limit hit | *(route handler)* | `402` | — | — | `{ quotaExceeded: true, remaining: 0 }` returned to UI |
| Rate-limit burst window still active | *(rate-limit middleware)* | `429` | — | — | `applyRateLimit` supplies per-minute burst headers |

---

## 4 · Interceptor Implementation Detail

### 4.1 Connect-Level Handshake Monitoring

Location: `web/app/api/analyses/route.ts:88–127`

```typescript
let connectTimeoutId: NodeJS.Timeout | undefined;
let totalTimeoutId: NodeJS.Timeout | undefined;
let connectionHandshakePassed = false;

connectTimeoutId = setTimeout(() => controller.abort(), 3000);
totalTimeoutId = setTimeout(() => controller.abort(), adaptiveTimeout);

const response = await fetch(/* … */);

clearTimeout(connectTimeoutId);
connectTimeoutId = undefined;
connectionHandshakePassed = true;   // ← set AFTER response is received
```

The critical ordering: `connectionHandshakePassed` is set to `true` only after `fetch` resolves and the connect-timer is cleared. The Abort timed-out path in the catch block (line 182) short-circuits on `!connectionHandshakePassed` to distinguish a genuine connect-level failure from a total-elapsed expiry.

### 4.2 Response-Level Status Classification

Location: `web/app/api/analyses/route.ts:129–167`

| Response status | Action taken |
|---|---|
| `401` / `403` | Throw `ERR_PROVIDER_AUTH_FAILED` — stop fallback, surface to client |
| `429` | Parse `Retry-After` header → throw `ERR_RATE_LIMIT_EXCEEDED` with `retryAfter` seconds |
| `404` | Model not found/retired → `continue` to next model in chain |
| Other non-2xx | Throw `ERR_PROVIDER_HTTP_ERROR` — stop fallback |

### 4.3 Catch-Block Fault Classification

Location: `web/app/api/analyses/route.ts:172–198`

| Condition | Outcome |
|---|---|
| `err instanceof AnalysisEngineError` | Rethrow unchanged — preserves typed error from loop body |
| `error.name === 'AbortError' && !connectionHandshakePassed` | `ERR_NETWORK_TIMEOUT` (408) |
| `error.name === 'AbortError' && connectionHandshakePassed` | `ERR_UNEXPECTED_FAILURE` (502) |
| Any other fault | `ERR_UNEXPECTED_FAILURE` (502) |

---

## 5 · Route Handler Surface (Front-End JSON Contract)

Location: `web/app/api/analyses/route.ts:455–476`

On success the handler returns full `AnalysisResponse` (`id`, `videoId`, `title`, `markdown`, `createdAt`, `model_attempted`, `model_used`, `cacheHit?`).

On failure every `AnalysisEngineError` is unwrapped into:

```json
{ "error": "<AnalysisEngineError.message>" }
```

with `statusCode` forwarded verbatim. The client can pattern-match against `error` text to drive each UI action state.

---

## 6 · Adaptive Timeout Formula

Location: `web/app/api/analyses/route.ts:86`

```
adaptiveTimeout = min(25 000 ms, 5 000 ms + floor(transcriptLength / 5 000) × 1 000 ms)
```

Transcripts up to 25 k chars get the 5 s floor; each additional 5 k block adds 1 s, capped at 25 s total. The connect-level hard limit remains a fixed 3 s regardless of transcript size.

---

## 7 · Model Fallback Chain

| Priority | Model |
|---|---|
| 1 (primary) | `anthropic/claude-haiku-4.5` |
| 2 (fallback) | `anthropic/claude-haiku-4.5` |

A `404 Not Found` response from the primary model triggers an automatic retry on the fallback. `401` / `403` / `429` / other non-2xx do **not** fall back — they surface immediately with their typed error.

---

## 8 · Quota and Rate-Limit Surface

These two layers sit *above* the OpenRouter interceptor and gate the request before any upstream call is attempted.

| Gate | Trigger | HTTP status | Payload |
|---|---|---|---|
| Monthly quota (free tier) | `analyses_used` ≥ 3 for the month | `402 Payment Required` | `{ error, quotaExceeded: true, remaining: 0 }` |
| Per-minute rate limit | Burst window consumed | `429 Too Many Requests` | `applyRateLimit` standard payload + `Retry-After` headers |

Both gates short-circuit the handler early; no OpenRouter call is made on their behalf.

---

## 9 · Mutation-Layer Checklist (Derived from Code Review)

- `analyses.id` must always be a `randomUUID()` V4 value — no timestamp-based patterns.
- `connectionHandshakePassed` flag must be cleared only after `fetch` resolves; ordered before the flag flip.
- `metadata` belongs on the worker fetch path; the worker URL is read from `process.env.CLOUDFLARE_WORKER_URL`.
- `retryAfter` is populated by parsing the `Retry-After` response header, not guessed.

---

<!-- PR AUDIT TRIGGER: audit-trigger chunk-13-final-audit architecture validation -->
*End of Error Taxonomy Manifest v1.5.0*
