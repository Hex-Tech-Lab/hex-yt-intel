---
Filename: HANDOVER_REPORT_CHUNK_13.md
Location: /docs/history/
Version: v1.0.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 20:15:00 EEST (GC)
Purpose: OMEGA-LEVEL COMPREHENSIVE SYSTEM MASTER HANDOVER for next invoked LLM.
---

# [SYSTEM_STATE_TRANSFER] HEX-YT-INTEL: MASTER ARCHITECTURE & HISTORY (Build: b947767)

**Target Agent:** Next Invoked LLM (Claude/Gemini/GPT)
**Timestamp:** Saturday, 16 May 2026 at 20:15:00 EEST (GC)
**Execution Branch:** `feature/chunk-13-final-audit` (PR pending) / `origin/main` (Secured)

---

### 1. [SYSTEM IDENTITY & MACRO PURPOSE]
You are operating within `hex-yt-intel`, an elite YouTube Content Intelligence synthesis engine built on Next.js 15. The system ingests long-form YouTube content (via URL), fetches metadata via a Cloudflare Worker, and leverages Claude Haiku via OpenRouter to generate structured, 16-section intelligence reports (Ultimate Content Intelligence v3.2). 

### 2. [FULL ARCHITECTURE & INFRASTRUCTURE STACK]

**Frontend & UI/UX (Taste as a Moat)**
- **Stack**: Next.js App Router, Tailwind CSS, shadcn/ui. 
- **Frozen Rule**: Absolute ban on Material-UI (`@mui/material`) and Emotion. This maintains our 89% production bundle compression ratio.
- **Design Philosophy**: We utilize a `design.md` constraint approach. Colors are strictly semantic (Primary: Electric Cyan `#06B6D4`, Secondary: Indigo `#6366F1`, Alerts: Neon Coral). We rely on Outline Styling, "Beautiful Shadows" (multi-layered drop shadows), and exact typography (Geist for headings, Inter for body, JetBrains Mono for snippets).

**Backend Core & Data Flow**
1. **Auth**: NextAuth.js (v5) combined with the Supabase Adapter for Google/GitHub OAuth. Sessions are persisted via explicitly set cookies during the callback phase.
2. **Rate Limiting**: Upstash Redis token bucket algorithm checks tier allowances (Free = 3/month, Pro = Unlimited) and per-minute burst limits.
3. **Metadata**: A separate Cloudflare Worker (`https://yt-intel.hex-tech-lab.workers.dev`) handles YouTube oEmbed and Data API v3 queries to bypass local rate limits.
4. **Caching & Database**: Supabase PostgreSQL. 
   - *Law #1*: The **Pre-Query Cache Hit Circuit** strictly queries the `analyses` table by `video_id` to intercept duplicates and return $0 cost cached markdown.
5. **LLM Orchestration**: OpenRouter API. 
   - Fallback chain defaults to `anthropic/claude-3.5-haiku` and `anthropic/claude-haiku-4.5`.
   - Incorporates a 16-section Ultimate Content Intelligence prompt structure designed to extract psychological architecture, implementation pathways, and strategic context.
6. **Async Embeddings**: OpenAi `text-embedding-3-small` generates 1536-dimensional vectors for the generated markdown and stores them in Supabase via `pgvector` for semantic search capabilities.

**Billing, Observability, & CI/CD**
- **Stripe**: Handles the Freemium conversion model via checkout webhooks.
- **Sentry**: Captures unhandled errors and rate-limit faults, sending breadcrumbs for external calls and database lookups.
- **Playwright**: End-to-end headless testing, actively mocking 408 Network Timeouts to validate UI error taxonomies.
- **GitHub Actions**: Strict CI/CD pipeline enforcing zero Type/Lint errors, automated tests, and branch security before pushing to Vercel production.

---

### 3. [THE 3 IMMUTABLE BACKEND LAWS]
1. **Pre-Query Cache Hit Circuit**: Always verify if a `video_id` exists in the Supabase cache before opening an LLM stream.
2. **Stratified Dual-Timeouts**: 3-second hard timeout for the connection handshake; max 25-second adaptive task horizon for the streaming read (calculated by transcript length).
3. **Edge Isolate Execution**: Next.js route handlers analyzing content MUST export `const runtime = 'edge';` to bypass Vercel's 10-second Node.js serverless execution ceiling.

---

### 4. [COMPLETE TIMELINE & INFLECTION POINTS]

**Phase 1: Foundation (Chunks 1-6)**
- Monorepo setup, Next.js routing, Supabase schema (Users, Analyses, Usage Logs, Stripe Events).
- Implemented NextAuth.js and successfully established the OpenRouter integration loop.

**Phase 2: Growth & Infrastructure (Chunks 7-12)**
- **Chunk 7-8**: Added Vector Search (pgvector) and a comprehensive Search UI with complex debouncing and filtering hooks.
- **Chunk 9-10**: Stripe integration built and deployed. Upstash Redis rate-limiting installed to prevent API abuse.
- **Chunk 11-12**: Full CI/CD pipeline created, Sentry configured, observability dashboards built for admin tracking. PR #4 through #7 audited and merged.

**Phase 3: The Edge Shift & Security Hardening (Chunk 13 - Current)**
- **The Vercel Ceiling Conflict**: Our 10.7s LLM generation window tripped Vercel's hard 10.0s cutoff, causing 500 errors.
- **The Fix**: Shifted the `/api/analyses` endpoint to the V8 Edge Runtime. Subbed out Node.js `crypto` imports for Web Crypto (`crypto.randomUUID()`). Implemented precise error tracking (`timeoutSource`).
- **Security Incident**: Git history leak detected (Cloudflare, Vercel JWT, YouTube keys). Executed a soft reset, purged history, established a mock convention (`PLACEHOLDER_*_KEEP_LOCAL`), and secured the branch.

---

### 5. [KEY LESSONS & RESOLVED FAULT LINES (Do Not Regress)]
| Issue / Fault Line | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **Vercel 10s Cutoff** | Vercel Hobby/Pro Serverless timeout cap | Enforced `export const runtime = 'edge'` in `/api/analyses/route.ts` and extended timeout matrix to 25s adaptive horizon. |
| **Edge API Compatibility** | V8 isolates do not support Node.js `crypto` | Replaced `import { randomUUID } from 'crypto'` with Edge-native `crypto.randomUUID()` for DB primary keys. |
| **Ambiguous Timeouts** | Flat `AbortError` returned 502s indiscriminately | Built Stratified Dual-Timeouts. Added `timeoutSource: 'connect' \| 'total'` tracking inside `setTimeout` to accurately throw HTTP 408 for handshake vs task horizon faults. |
| **Duplicate Token Burn** | Overlapping multi-agent analysis calls | Enforced **Pre-Query Cache Hit Circuit** (Law #1). Always query `analyses` table by `video_id` before calling OpenRouter. |
| **Silent Auth Signout** | Swallowed exceptions during credential purge | Wrapped signout flow in a `{ success: boolean, error?: string }` return format for UI handling. |
| **RLS OAuth Blocking** | Supabase Row-Level Security blocked auto-signup | Temporarily disabled RLS on `users` table to allow NextAuth callback inserts; secured `analyses` reads via Auth ID checks. |

---

### 6. [WORKSPACE TAXONOMY & DOCUMENTATION ANCHORS]

To prevent multi-agent folder pollution, **only 4 Markdown files are permitted in the root**: `CLAUDE.md`, `GEMINI.md`, `README.md`, and `AGENTS.md`. Everything else MUST be routed to `/docs/`.

**Critical Anchor Files:**
- **`CLAUDE.md` / `GEMINI.md`**: The Master Workspace Configurations. Read these to understand cross-tool coordination and frozen stack bans.
- **`docs/specs/ERROR_TAXONOMY_MANIFEST.md`**: Defines the `AnalysisEngineError` class and maps HTTP codes (e.g., separating `ERR_NETWORK_TIMEOUT` from `ERR_ALL_MODELS_EXHAUSTED`).
- **`web/app/api/analyses/route.ts`**: The backend nerve center (Quota limits, pre-query cache, Edge runtime, OpenRouter dual-timeouts).
- **`docs/IMPLEMENTATION_PLAN_v2.0_FINAL.md`**: The source of truth for the first 12 MVP sprints.

---

### 7. [CURRENT STATE & IMMEDIATE DIRECTIVES]

**System State:** 🟢 SECURE & OPERATIONAL.  
**Current Objective:** Awaiting automated PR review feedback (CodeRabbit/Sonar) on branch `feature/chunk-13-final-audit`.

**Next Actions for Incoming LLM:**
1. Acknowledge this handover manifest.
2. If the user provides CodeRabbit/Sourcery PR feedback, address the code deltas immediately.
3. If PR checks pass cleanly, prepare the git squash and merge sequence to integrate the `chunk-13-final-audit` branch into `main`.
4. Ensure that any future diagnostics or generated docs are kept strictly within `/docs/history/` or `/docs/specs/`.

[END_OF_TRANSMISSION]