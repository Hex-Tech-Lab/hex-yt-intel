# AGENTS.md — HEX-YT-INTEL Production Runbook

_Read on session start. Do not override with assumptions — this is ground truth._

**Last updated:** 2026-05-21 01:15 (UTC+3)  
**Current Commit:** 872f92e (PR #22 squash-merged to main)  
**Branch:** `origin/main` — clean, no commits ahead  
**Pipeline status:** `pnpm type-check` ✓ · `pnpm lint` ✓ · `pnpm build` ✓ · `pnpm test` ✓  
**Deployment:** https://hex-yt-intel.vercel.app ✅ LIVE (47s build time)

---

## 1. PROJECT IDENTITY

| Field | Value |
|---|---|
| Name | **HEX-YT-INTEL** |
| Registry | `@hex-yt-intel/web` (Next.js app) |
| Packaged worker | `youtube-intelligence-worker` (Cloudflare Workers) |
| Goal | Transform YouTube masterclasses → structured content-intelligence reports (16-section markdown) |
| Users | Content creators, indie makers, consultants |
| Deployment | Vercel (web) + Cloudflare Workers (metadata fetch) |
| Database | Supabase (PostgreSQL) |
| LLM | OpenRouter / Claude Haiku 4.5 → 3.5 Haiku |

---

## 2. MONOREPO STRUCTURE

```
hex-yt-intel/
├── web/                          # Next.js 15 App Router (Vercel deploy target)
│   ├── app/
│   │   ├── api/analyses/route.ts      ← primary API endpoint
│   │   ├── api/analyses/[id]/
│   │   │   ├── export/route.ts
│   │   │   └── share/route.ts
│   │   ├── api/admin/stats/route.ts
│   │   ├── api/search/route.ts
│   │   ├── analyses/saved/page.tsx
│   │   └── search/page.tsx
│   ├── lib/
│   │   ├── supabase.ts                # getSupabaseClient()
│   │   ├── rate-limit.ts              # applyRateLimit(), getUserTier()
│   │   ├── youtube.ts                 # extractVideoId()
│   │   ├── embeddings.ts              # generateEmbedding()
│   │   ├── prompts.ts                 # createUCISPrompt()
│   │   ├── auth/
│   │   │   └── provider-factory.ts   # getAuthSession()
│   │   ├── monitoring/
│   │   │   └── sentry-utils.ts       # trackExternalCall(), trackDatabaseQuery(), ...
│   │   └── schemas.ts                 # AnalysisCreateSchema (zod)
│   ├── middleware.ts
│   ├── instrumentation.ts             # Sentry SDK integration
│   └── package.json
├── worker/                         # Cloudflare Worker (metadata fetcher)
│   └── package.json
├── docs/
│   ├── code_review_report.md
│   ├── history/review-loop-nohup.log_*
│   └── security/remediation_2026_05_16.md
├── .claude/                         # Claude agent config & memory
│   ├── SECURITY.md
│   ├── MEMORY.md
│   └── settings.local.json
├── .gemini/                         # Gemini agent config & memory
│   ├── SECURITY.md
│   └── MEMORY.md
├── design-system/
│   └── claude-design-system-prompt.md
└── .gitignore
```

---

## 3. MONOREPO WORKSPACE SUB-ROOT COMMAND LOCK

### Institutional Rule: All pnpm Operations Must Execute from `web/` Sub-Root
Because the system utilizes a multi-package layout where **node manifests are isolated inside `/web`**, all execution tracking loops, verification tasks, and `pnpm` operations MUST be invoked directly from the sub-root directory to protect the workspace from root configuration crashes.

### The Problem (Prevention Rule)
```bash
# ❌ BROKEN: Running pnpm from repository root
$ pnpm type-check
# Error: ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND
```

The root directory contains NO `package.json` and NO `pnpm-workspace.yaml`. All package definitions are scoped to `/web` (Next.js app) and `/worker/` (Cloudflare Worker).

### The Correct Pattern
```bash
# ✅ CORRECT: Always cd into /web before running pnpm commands
$ cd web
$ pnpm type-check      # TypeScript verification
$ pnpm lint            # ESLint + Prettier
$ pnpm build           # Production build
$ pnpm dev             # Local development server
$ pnpm test            # Jest test suite
```

### Pre-Commit Gate (Non-Negotiable)
```bash
# Always execute from /web sub-root
cd web && pnpm type-check && pnpm lint && pnpm build
```

### Why This Matters
1. **Lock files are scoped**: `web/pnpm-lock.yaml` is the authoritative dependency resolution
2. **Scripts are packaged**: `web/package.json` contains all executable scripts (dev, build, test, lint)
3. **TypeScript config is isolated**: `web/tsconfig.json` defines type-checking rules for the app
4. **Build targets are segregated**: `web/next.config.js` controls Next.js compilation, separate from `worker/`

Running `pnpm` from root will produce:
- `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` — root directory is not a valid pnpm workspace
- Dependency resolution failures — lock file not found
- Script execution failures — package.json scripts not defined
- Build failures — Next.js config not found

### Verification Checklist
Before EVERY pnpm command:
```bash
# Confirm you're in the /web directory
$ pwd
/home/kellyb_dev/projects/hex-yt-intel/web

# Confirm package.json exists here
$ ls package.json
package.json

# Confirm lock file is present
$ ls pnpm-lock.yaml
pnpm-lock.yaml

# NOW safe to run pnpm operations
$ pnpm type-check
```

---

## 4. DEVELOPMENT WORKFLOW

### pnpm scripts (web/)

| Script | Command | When to use |
|---|---|---|
| `pnpm dev` | `next dev` | Local development |
| `pnpm type-check` | `tsc --noEmit` | Pre-commit / CI gate |
| `pnpm lint` | `eslint . --ext .ts,.tsx` | Pre-commit / CI gate |
| `pnpm build` | `next build` | Production build validation |
| `pnpm format` | `prettier --write .` | Code formatting |

### npm scripts (worker/)

| Script | Command | When to use |
|---|---|---|
| `pnpm dev` | `wrangler dev` | Local worker development |
| `pnpm build` | `wrangler build` | Worker compilation |
| `pnpm deploy` | `wrangler deploy --env production` | Deploy worker |

### Pre-flight before any commit

```
pnpm type-check && pnpm lint && pnpm build
```

---

## 5. SECURITY DIRECTIVES (MANDATORY — READ BEFORE ANY COMMIT)

### 4.1 Never-Commit Credentials Rule

**Real API keys and secrets MUST NOT be committed to git under any circumstances.**

#### Sanitization Marker Table

| Secret Type | Placeholder to use in committed files |
|---|---|
| Cloudflare API Token | `PLACEHOLDER_CLOUDFLARE_TOKEN_KEEP_LOCAL` |
| Vercel OIDC JWT | `PLACEHOLDER_VERCEL_JWT_KEEP_LOCAL` |
| YouTube API Key | `PLACEHOLDER_YOUTUBE_KEY_KEEP_LOCAL` |
| Supabase URL / Key | `PLACEHOLDER_SUPABASE_<KEY>_KEEP_LOCAL` |
| Generic secret | `PLACEHOLDER_<TYPE>_KEEP_LOCAL` |

#### Where Real Secrets ARE Permitted

1. Local `.gitignore`'d files: `.env`, `.env.local`, `.env.*.local`
2. Vercel / deployment environment variables dashboard
3. Secret vault system (1Password, Doppler, etc.) — never in source control
4. GitHub Secret Scanning unblock URLs are **NOT** a way to force-push real secrets

#### `process.env` Enforcement

```
OPENROUTER_API_KEY     → access via process.env.OPENROUTER_API_KEY only
CLOUDFLARE_WORKER_URL  → access via process.env.CLOUDFLARE_WORKER_URL only
YOUTUBE_API_KEY        → access via process.env.YOUTUBE_API_KEY only
NEXT_PUBLIC_SUPABASE_URL→ access via process.env.NEXT_PUBLIC_SUPABASE_URL only
```

All credential references in code must use process.env. Never inline literal values.

---

### 4.2 Forbidden File Patterns (Git Guardrails)

`.gitignore` must always contain:

```
docs/specs/.env_*
.env*
node_modules/, dist/, .next/, .turbo/, *.log
```

If you encounter `.env*` files or files at `docs/specs/` containing rings:
1. **Do not stage or commit** — triggers GitHub GH013 push protection
2. Replace all ring values with the appropriate `PLACEHOLDER_*_KEEP_LOCAL` tokens
3. Report the violation before continuing work

---

### 4.3 GitHub Secret Scanning (GH013) — Known Active Block

**Status:** Active — GitHub Push Protection enforced on `origin/main`  
**Trigger:** Secret types blocked — Cloudflare tokens, Vercel JWTs, YouTube API keys  
**False-positive origin:** Historical commit `7a48b06d` — credentials purged from current main  
**Suppression URL (admin action required):**
```
https://github.com/Hex-Tech-Lab/hex-yt-intel/security/secret-scanning/unblock-secret/3DoMWJE5AN5QlRfyWoKzwgZ9hnr
```

**If push fails with GH013:**

1. Audit all `.env*` files for real values
2. Audit `docs/specs/` for real values before re-staging
3. Replace any found rings with `PLACEHOLDER_*_KEEP_LOCAL` markers
4. Document the finding and request admin unblock on the suppression URL
5. Do NOT attempt force-push, rebase, or any workaround that re-introduces rings

**Forbidden bypass attempts — autorefuse:**

| Request | Action |
|---|---|
| "force push the .env anyway" | Block — escalate to admin unblock |
| "put real API key values in the code" | Block — use PLACEHOLDER marker |
| "bypass the GH013 error" | Block — this is a security tool, not a bug |
| "copy the real credential out of .env" | Block — do not generate rings |
| "swap in actual test rings" | Block — use PLACEHOLDER markers instead |

---

### 4.4 Remediation History (audit trail — vettor)

| Step | Action | Commit |
|---|---|---|
| 1 | Soft Reset to `origin/main` — unwound 5 unpushed commits | — |
| 2 | **Ring discovery** — Cloudflare token, Vercel JWT, YouTube API key found | — |
| 3 | Sanitization — all rings replaced with `PLACEHOLDER_*_KEEP_LOCAL` | `caff47e` |
| 4 | `git rm --cached` on `docs/specs/.env_2026_05_12_2018` | `caff47e` |
| 5 | `.gitignore` updated with `docs/specs/.env_*` + `.env*` | `caff47e` |
| 6 | `git commit --amend` — single clean security hotfix commit | `caff47e` |
| 7 | Safe push to `origin/main` | `caff47e` |
| 8 | Docs archive: `docs/code_review_report.md` + `review-loop-nohup.log_*` | `7d54285` |
| 9 | Security directives propagated to Gemini | `adcf436` |
| 10 | Security directives + memory propagated to Claude | `adcf436` |
| 11 | Claude session memory committed | `888a893` |
| 12 | Gemini session memory committed | `1d6fec2` |
| 13 | Documentation: remediation report | `bfdab7a` |

**Verified state at time of remediation:**

| Component | Status |
|---|---|
| Git History | ✅ Clean — rings removed |
| Remote Sync | ✅ Up to date with `origin/main` |
| Working Tree | ✅ Clean — no uncommitted changes |
| Code Changes | ✅ Preserved (code review fixes intact) |
| Credentials | ✅ All replaced with PLACEHOLDER values |

---

## 6. CRITICAL CODE-LEVEL PATTERNS

These issues triggered production-integrity bugs. Re-instatement means roll-back. Never revert or work around them.

### 5.1 UUID Type-Safety (route.ts:391 — `randomUUID`)

```typescript
import { randomUUID } from 'crypto';
// …
const analysisId = randomUUID();
```

Use `randomUUID()` from the native `crypto` module for all Supabase insert IDs.  
Do NOT use `${Date.now()}-${Math.random().toString(36)}` or any timestamp-pattern.  
Supervise the type column `uuid` in Supabase (`analyses.id`) — this must always be RFC 4122.

### 5.2 Timeout Race Condition (route.ts:115–126 — `connectionHandshakePassed`)

```typescript
let connectionHandshakePassed = false;

// Set flag AFTER fetch resolves, connectTimeoutId is cleared
connectionHandshakePassed = true;

// In catch block — use the flag for ham duties-over-timeout distinction
catch (err) {
  const error = err as Error;
  if (error.name === 'AbortError' && !connectionHandshakePassed) {
    // true connect-level timeout (≤ 3s: Abort during handshake)
  } else {
    // total-level timeout or whatever error (response arrived, then timed out)
  }
}
```

---

## 7. OPENROUTER CALLER PATTERN (`callOpenRouter`)

Location: `web/app/api/analyses/route.ts:34`

| Parameter | Behavior |
|---|---|
| Models tried (in order) | `anthropic/claude-haiku-4.5` → `anthropic/claude-3.5-haiku` |
| Connect timeout | 3 s (AbortController) |
| Total timeout | `Math.min(25000, 5000 + floor(transcriptLength / 5000) * 1000)` ms |
| Temperature | 0.7 |
| Max tokens | 4000 |
| Stream | false |
| Retry on 404 | yes (continue to next model) |
| Hard-fail on 401 | yes (throws immediately) |

Errors are accummulated in `Record<string, string> errors` by model key and the caller surface when all models are depleted.

---

## 8. API ROUTE PATTERNS

### 7.1 Standard request envelope

All `POST /api/*` routes must:
1. `getAuthSession()` → validate user, return 401 if absent
2. `getUserTier(userId)` → set Sentry context
3. `applyRateLimit(request, 'resource', userId, tier)` → 429 if exceeded
4. Parse with `zod` safeParse → 400 on mismatch
5. `trackExternalCall()` around third-party IO
6. `trackDatabaseQuery()` around Supabase calls
7. `generateEmbeddingAsync()` as non-blocking background job
8. `addBreadcrumb()` at each major milestone
9. `Sentry.captureException()` on failures with tagged contexts/tags

---

## 9. SENTRY OBSERVABILITY CONVENTIONS

Defined in `web/lib/monitoring/sentry-utils.ts`

| Utility | Purpose |
|---|---|
| `trackExternalCall(service, operation, fn, meta)` | Wraps external HTTP fetch with Sentry span tracking |
| `trackDatabaseQuery(op, table, fn, meta)` | Wraps Supabase CRUD with Sentry span tracking |
| `addBreadcrumb(message, data?, category?)` | Structured breadcrumb for Sentry timeline |
| `setUserContext(userId, email, tier)` | Identifies user in all Sentry events |

**Breadcrumb categories used:** `validation`, `external_service`, `database`, `rate_limiting`, `cache`, `quota`

---

## 10. SUPABASE CONVENTIONS

Defined in `web/lib/supabase.ts`

| Item | Convention |
|---|---|
| `getSupabaseClient()` | Creates factory-bound client; use in every supabase interaction |
| `analyses.id` | column type `uuid` — must be `randomUUID()` value |
| `analyses.embedding` | `vector(1536)` — populated asynchronously after insert |
| `analyses.user_id` | `uuid` — always filter on this for RLS compliance |
| Plans | `users` table: `tier` = `'free'` | `'pro'` |
| Quota enforcement | Count rows in `analyses` per user per month |
| `users.analyses_used` | Counter column; don't forget to increment after INSERT |
| `usage_logs` | Fire-and-forget audit trail; don't fail the request on write errors |

---

## 11. KEY ENVIRONMENT VARIABLES

| Variable | Purpose | Where set |
|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter / Claude Haiku API key | Vercel env vars |
| `CLOUDFLARE_WORKER_URL` | Metadata worker base URL (default: `https://yt-intel.hex-tech-lab.workers.dev`) | Vercel env vars |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase HTTP endpoint | Vercel env vars |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase key | Vercel env vars |
| `NEPTUNE_API_KEY` | Neptune Analytics graph DB | (future) |
| `SENTRY_DSN` | Sentry error reporting | Vercel env vars |

> All must be referenced as `process.env.<KEY>` — never hardcoded.

---

## 12. AUTH & RBAC

Defined in `web/lib/auth/provider-factory.ts`

| Item | Convention |
|---|---|
| `getAuthSession()` | Provider-agnostic; supports NextAuth / custom setups via `AUTH_PROVIDER` env |
| `session.user.id` | Supabase `uuid` — authoritative user identifier |
| `session.user.email` | Sentinel/notification channel |
| `userTierAuth` | Quota source; `'free'` = 3 analyses/month, `'pro'` = unlimited |

---

## 13. RATE-LIMIT CONVENTIONS

| Tier | Rate window | Burst | Hard cap |
|---|---|---|---|
| `free` | Per minute | Low | `analyses` table monthly cap |
| `pro` | Per minute | Higher | None |

Apply via `applyRateLimit(request, 'analyses', userId, userTierAuth)` before any expensive work.

---

## 14. OPENROUTER TIMEOUT CONFIGURATION

```typescript
const transcriptLength = transcript?.length || 0;
const adaptiveTimeout = Math.min(25000, 5000 + Math.floor(transcriptLength / 5000) * 1000);
// connect timeout: 3000 ms (hard-coded)
// total timeout: adaptiveTimeout ms (scales with transcript size)
// cancel: AbortController signal on both timeouts
```

---

## 15. CODE STYLE & LINTING

| Rule | Required |
|---|---|
| TypeScript | Strict mode, `tsc --noEmit` clean |
| ESLint | Default Next.js config — zero violations |
| Prettier | Two-space indent, single-quote strings |
| Async error handling | `const error = err as Error` in catch blocks; avoid bare `unknown` |
| Dead flag cleanup | Always `clearTimeout(id); id = undefined;` in finally blocks |

---

## 16. PANDO — KNOWN BLOCKING STATUS

> **GitHub Push Protection GH013** (false positive, administrative hold)  
> Origin: Historical commit `7a48b06d` — credential purge has been validated  
> Status: **Admin unblock required** before any further push to `origin/main`  
> Suppression URL: https://github.com/Hex-Tech-Lab/hex-yt-intel/security/secret-scanning/unblock-secret/3DoMWJE5AN5QlRfyWoKzwgZ9hnr  
> Blocks: Re-push introducing any environment secret into `.env*` or `docs/specs/`

---

## 17. QUICK-REFERENCE FILE INDEX

| Pattern | File | Purpose |
|---|---|---|
| **API** | `web/app/api/analyses/route.ts:384` | UUID + handshake-pass flag (CRITICAL QZ) |
| **Modules** | `web/app/api/analyses/route.ts:384` | Router route (primary entry point) |
| **Modules** | `web/lib/prompts.ts:[lines]` | createUCISPrompt() — UCIS 16-section builder |
| **Modules** | `web/lib/embeddings.ts:[lines]` | generateEmbedding() — OpenAI text-embedding-3-small |
| **Modules** | `web/lib/supabase.ts:[lines]` | getSupabaseClient() — Supabase factory |
| **Modules** | `web/lib/schemas.ts:[lines]` | zod schemas for request validation |
| **Modules** | `web/lib/rate-limit.ts:[lines]` | Rate-limit and tier helpers |
| **Modules** | `web/lib/youtube.ts:[lines]` | extractVideoId() — URL normalization |
| **Modules** | `web/lib/monitoring/sentry-utils.ts:[lines]` | Sentry tracking utilities |
| **Modules** | `web/middleware.ts:[lines]` | Edge middleware (CORS, auth pre-flight) |
| **Modules** | `web/instrumentation.ts:[lines]` | Sentry server instrumentation |
| **Lib** | `web/lib/auth/provider-factory.ts:[lines]` | getAuthSession() — auth provider abstraction |
| **Utility** | `web/lib/rate-limit.ts:[lines]` | Rate-limit helpers |
| **Utility** | `web/lib/youtube.ts:[lines]` | extractVideoId() — URL pattern matching |
| **Routes** | `web/app/api/analyses/[id]/export/route.ts:[lines]` | Export analysis GET route |
| **Routes** | `web/app/api/analyses/[id]/export/route.ts:[lines]` | Export copy handlers |
| **Routes** | `web/app/api/analyses/search/route.ts:[lines]` | Semantic search endpoint |
| **Routes** | `web/app/api/analyses/search/route.ts:[lines]` | Embedding similarity search |
| **Routes** | `web/app/api/metadata/route.ts:[lines]` | Worker meta-proxy endpoint |
| **Routes** | `web/app/api/analyses/route.ts:[lines]` | Supabase-backed user profile |
| **Routes** | `web/app/api/rate-limit-status/route.ts:[lines]` | Rate-limit quota endpoint |
| **Routes** | `web/app/api/health/route.ts:[lines]` | Health check / uptime probe |
| **Routes** | `web/app/api/billing/checkout/route.ts:[lines]` | Stripe checkout session |
| **Routes** | `web/app/api/stripe/webhook/route.ts:[lines]` | Stripe event handler |
| **Routes** | `web/app/api/admin/stats/route.ts:[lines]` | Admin analytics dashboard |
| **Widgets** | `web/app/api/analyses/route.ts:[lines]` | Diary entry (query/builders/schema) |
| **Routes** | `web/app/auth/callback/page.tsx:[lines]` | OAuth / magic-link callback page |
| **Routes** | `web/app/auth/error/page.tsx:[lines]` | Auth error page |
| **Routes** | `web/app/share/[token]/page.tsx:[lines]` | Public share preview |
| **Services** | `web/app/api/analyses/route.ts:[lines]` | Supabase RBAC |
| **Services** | `web/lib/monitoring/sentry-utils.ts:[lines]` | trackExternalCall() / trackDatabaseQuery() |
| **Services** | `web/lib/supabase.ts:[lines]` | Supabase factory + service-role client |
| **Services** | `worker/src/index.ts:[lines]` | Cloudflare Worker YT metadata fetch |
| **External** | `web/app/api/analyses/route.ts:[lines]` | OpenRouter HTTP API client |
| **External** | `web/lib/embeddings.ts:[lines]` | OpenAI REST API (text-embedding-3-small) |
| **External** | `worker/src/index.ts:[lines]` | YouTube Data API v3 proxy |
| **Domain** | `web/lib/schemas.ts:[lines]` | zod schemas (AnalysisCreateSchema, …) |
| **Utility** | `web/lib/youtube.ts:[lines]` | extractVideoId() (youtube.com / youtu.be / shorts) |
| **Utility** | `web/lib/schemas.ts:[lines]` | NormaliseYouTubeUrl for query params |
| **Design** | `design-system/claude-design-system-prompt.md:[lines]` | UI/UX design system spec |

---

## 18. RECENT FIX LOG (chunk 13 — code review verdicts applied)

All CRITICAL issues from the code review have been surgically applied to `main`.

### 17.1 UUID Type-Safety — `web/app/api/analyses/route.ts:1, 391-403`

- **Import:** `import { randomUUID } from 'crypto';`
- **Production ID:** `const analysisId = randomUUID();`
- Supabase insert and response both receive the true V4 UUID.

### 17.2 Timeout Race Condition — `route.ts:62, 97, 118–127`

- **State anchor:** `let connectionHandshakePassed = false;`
- **Flag set:** immediately after `connectTimeoutId` cleared + fetch response received (line 97)
- **Catch-block classification:** `error.name === 'AbortError' && !connectionHandshakePassed` isolates true connect-level timeouts from total-level timeouts and non-timeout faults.

### 17.3 Catch-block Unknown Type Fix

- `const error = err as Error;` replaces `err instanceof Error` so `error.name` and `error.message` are type-safe under `tsc --noEmit strict`.

### 17.4 Credential Purge — docs/specs + .gitignore

- `git rm --cached docs/specs/.env_2026_05_12_2018` — blob removed from index
- `.gitignore` appended with `docs/specs/.env_*` and `.env*` globs

### 17.5 Legacy Documentation Archive

- `docs/code_review_report.md` — review verdicts staged as docs
- `docs/history/review-loop-nohup.log_*` — structured reference logs

### 17.6 Agent Security Config Propagation

- `.claude/SECURITY.md` — runtime security policy
- `.claude/MEMORY.md` — session memory + fix log
- `.gemini/SECURITY.md` — Gemini security policy
- `.gemini/MEMORY.md` — Gemini session memory + fix log
- `.gitignore` — `docs/specs/.env_*` + `.env*` guardrails

---

## 19. AGENT ENFORCEMENT SURFACE

Every agent session must scan (or reference) these files before taking any action:

| File | Watches |
|---|---|
| `.claude/SECURITY.md` | **Claude-only** — security policy |
| `.claude/MEMORY.md` | **Claude-only** — session memory + fix log |
| `.gemini/SECURITY.md` | **Gemini-only** — security policy |
| `.gemini/MEMORY.md` | **Gemini-only** — session memory + fix log |
| `AGENTS.md` | **KC / Kilo** — production runbook (this file) |

---

## 20. PHASE 1 STABILIZATION ✅ COMPLETE (2026-05-21)

**Status**: All deliverables merged to `main` (commit 872f92e, PR #22)

### What Changed in Phase 1

| Layer | Status | Key Deliverables |
|-------|--------|------------------|
| **Infrastructure** | ✅ Locked | Node 24 + pnpm 11.1.3 in `action.yml`; Composite Action pattern (7 jobs consolidated) |
| **CI/CD Pipeline** | ✅ Locked | Monorepo context anchoring (`pnpm --filter`); environment fallback strategy; all 7 stages passing |
| **Security** | ✅ Locked | RLS enforced on all tables; auth middleware with explicit returns; Upstash token rotated |
| **Database** | ✅ Locked | Supabase OAuth live (Google, GitHub); test user seeded (`da4381c6-f774-4c99-8f04-2c1c9e27d1fb`) |
| **Resilience** | ✅ Locked | SSRF prevention, embedding timeouts, webhook verification, Redis circuit breaker |
| **Observability** | ✅ Locked | Sentry integration + breadcrumbs, usage logs table, health-check endpoint |
| **Deployment** | ✅ Live | https://hex-yt-intel.vercel.app (47s build time, all gates passing) |

### Phase 1 Handover Documentation

**Read these before Phase 2 work**:
- `/docs/history/HANDOVER_REPORT_2026-05-21.md` — 10x THOS with 4 ADRs, Known Good State, brittleness points
- `/ROADMAP.md` — Phase 1→2 transition with week-by-week Phase 2 schedule
- `/docs/history/INDEX_HANDOVER_VERSIONS.md` — Master version index of all handover documents

### Known Good State Verification

Before starting Phase 2, verify all Phase 1 systems:
```bash
# From /web directory
pnpm type-check && pnpm lint && pnpm build

# Verify Vercel deployment
curl https://hex-yt-intel.vercel.app/api/health

# Verify database connectivity
# (check Supabase dashboard → auth users are present)
```

**See**: `/docs/ops/KNOWN_GOOD_STATE_CHECKLIST.md` (25-item operational checklist)

---

## 21. PHASE 2 READINESS 🚀 (Next: 2026-05-22)

**Status**: Ready to start (blocked on Shopify API credentials)

### What Phase 2 Requires

| Week | Feature | Blocker |
|------|---------|---------|
| 1 | Shopify Integration | SHOPIFY_STORE_ID, SHOPIFY_ACCESS_TOKEN |
| 2 | Catalog Search | Product schema approval |
| 3 | Checkout Flow | Payment processor decision (Stripe vs Shopify Payments) |
| 4 | Analytics + Polish | None (all prior weeks complete) |

### Unblocking Actions

Before Phase 2 kickoff:
1. [ ] Obtain Shopify credentials from business stakeholder
2. [ ] Add `SHOPIFY_STORE_ID` + `SHOPIFY_ACCESS_TOKEN` to Vercel env
3. [ ] Approve `products` table schema (fields: id, title, description, price, image_url, created_at, tags)
4. [ ] Decide on payment processor (Stripe or Shopify Payments)

### Phase 2 Reference

**See**: `/ROADMAP.md` for full Phase 2-3 roadmap with:
- Week-by-week breakdown (4 weeks)
- Acceptance criteria per week
- Success metrics
- Dependency chain

---

## 22. CRITICAL STATE AT PHASE BOUNDARY

**Do not start Phase 2 unless ALL of these are true**:

- ✅ Vercel deployment healthy (check `/api/health`)
- ✅ Supabase RLS enforced + auth working
- ✅ All 7 CI/CD pipeline stages passing
- ✅ Redis circuit breaker functional
- ✅ Sentry integration logging events
- ✅ Shopify credentials in Vercel env

**If ANY of these fail**, revert to Phase 1 troubleshooting and consult the Known Good State checklist.

---

*EOF*
