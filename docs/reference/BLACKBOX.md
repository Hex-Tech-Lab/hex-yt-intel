# hex-yt-intel: YouTube Content Intelligence Platform

## Project Overview

**hex-yt-intel** is a YouTube Content Intelligence Platform that implements the **Hybrid Edge Symphony** architecture for deep video analysis. The platform transcends standard serverless limitations by separating high-security authentication/billing from high-latency LLM compute using a triple-redundant trust model.

### Core Purpose
- Perform deep YouTube video analysis using UCIS v5.1 framework (11-16 dimensions)
- Provide secure, reliable analysis with zero timeouts and zero exposed database keys
- Enable persistent storage of results even if client disconnects during processing

### Main Technologies
- **Frontend**: Next.js 16.2.6 (React 19) with Tailwind CSS
- **Backend**: Cloudflare Worker (Hono) for LLM streaming
- **Database**: Supabase PostgreSQL with Row Level Security
- **Caching**: Upstash Redis (rate limiting, vector search)
- **AI Models**: OpenRouter cascade (nemotron-3-nano-30b:free → glm-4.5-air:free → gemma-4-26b:free → anthropic/claude-haiku-4.5)
- **Monitoring**: Sentry for error tracking
- **Package Manager**: pnpm 11.1.3
- **Runtime**: Node.js 24.16.0 LTS

### Architecture: Hybrid Edge Symphony (ADR 005)
The platform implements a three-layer architecture:

1. **Layer 1: Vercel (The Bouncer) — ~8 Seconds**
   - Security perimeter & gatekeeper
   - Verifies Supabase Auth, enforces atomic monthly quota via Upstash Redis Lua
   - Ingests metadata & subtitles, mints HMAC-signed StreamToken
   - Inserts 'processing' placeholder row, returns 202 Accepted + Worker URL

2. **Layer 2: Cloudflare (The Streaming Engine) — ~58 Seconds**
   - Stateless compute & real-time delivery
   - Verifies StreamToken HMAC, builds UCIS v5.1 prompt server-side
   - Executes model cascade, streams chunks via SSE to browser
   - Computes final ContentSignature for tamper-proofing

3. **Layer 3: S2S /persist (The Closer)**
   - Secure data persistence via server-to-server calls
   - Worker calls Vercel persist endpoint via ctx.waitUntil
   - Vercel verifies ContentSignature, writes canonical result to Supabase using service_role key

## Building and Running

### Prerequisites
- Node.js >= 24.0.0
- pnpm >= 9.0.0
- Supabase project with required tables
- Upstash Redis account
- OpenRouter API key
- Vercel and Cloudflare accounts for deployment

### Local Development Setup
```bash
# Clone repository
git clone <repository-url>
cd hex-yt-intel

# Install dependencies (from web subdirectory)
cd web
pnpm install --frozen-lockfile

# Environment setup (copy .env.example to .env.local and fill in values)
# Required variables:
# NEXT_PUBLIC_SUPABASE_URL
# NEXT_PUBLIC_SUPABASE_ANON_KEY
# OPENROUTER_API_KEY
# STRIPE_SECRET_KEY
# STRIPE_WEBHOOK_SECRET
# UPSTASH_VECTOR_REST_URL
# UPSTASH_VECTOR_REST_TOKEN
# Optional but recommended:
# SUPABASE_SERVICE_ROLE_KEY
# CLOUDFLARE_WORKER_URL
# SENTRY_AUTH_TOKEN
# UPSTASH_REDIS_REST_URL
# UPSTASH_REDIS_REST_TOKEN
# QSTASH_TOKEN
# DECODO_API_KEY
# STREAM_HMAC_SECRET

# Start development server
pnpm dev
```

### Available Scripts (in web/ directory)
- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint
- `pnpm type-check` - Run TypeScript type checking
- `pnpm format` - Format code with Prettier
- `pnpm test` - Run Playwright tests

### Worker Scripts (in worker/ directory)
- `pnpm dev` - Start Cloudflare Worker locally
- `pnpm deploy` - Deploy to Cloudflare Workers
- `pnpm build` - Build worker bundle

### Deployment
- **Web**: Auto-deployed to Vercel on `main` branch push
- **Worker**: `cd worker && pnpm deploy`

### Preflight Check (Recommended before development)
```bash
cd web
pnpm type-check && pnpm lint && pnpm build
```

## Development Conventions

### Code Organization
- `/web` - Next.js 16.2.6 application (dashboard, bouncer, API routes)
- `/worker` - Cloudflare Worker (Hono) for LLM streaming
- `/docs` - Specifications, ADRs, historical logs, operational guides
- `/supabase` - Database migrations and edge functions
- `/scripts` - Utility scripts for deployment and maintenance

### Key Conventions
1. **Package Management**: pnpm only (version 11.1.3)
2. **CSS Framework**: Tailwind CSS + shadcn/ui exclusively
3. **Runtime**: Node.js 24.16.0 LTS (pinned for CI/deployment)
4. **TypeScript**: 5.6.2 (strict mode enabled)
5. **State Management**: Zustand + Zod (always aligned versions)
6. **Authentication**: Supabase Auth only (`getSupabaseClientWithAuth()` server-side only)
7. **File Volume**: Maximum 4 Markdown files in root directory (README.md, CLAUDE.md, GEMINI.md, AGENTS.md)
8. **Documentation**: All documentation lives in `/docs/`, not in code comments

### Banned Dependencies
- ❌ Material-UI (`@mui/material`)
- ❌ Emotion styling (`@emotion/react`, `@emotion/styled`)
- ❌ Any runtime CSS-in-JS injection engine
- ❌ `next-auth` (removed in favor of native Supabase `getSupabaseClientWithAuth()` pattern)

### Architectural Laws (from GEMINI.md and CLAUDE.md)
1. **Law #1: Pre-Query Cache Hit Circuit**
   - Before EVERY analysis request, query Supabase `analyses` table matching `video_id` and `user_id`
   - If found, return cached markdown instantly
   - Goal: Save duplicate video tokens across multi-agent sessions, deliver $0 cost queries

2. **Law #2: Stratified Dual-Timeouts**
   - Connection Handshake: 3-second hard timeout
   - Token Streaming Window: 25-second (Vercel) / 90-second (Worker) maximum read
   - Adaptive horizon engineered to fit inside Vercel execution limit

3. **Law #3: Streaming Response Execution**
   - All analytical route handlers MUST implement dynamic response streaming
   - Extends connection lifetime beyond Vercel's standard 10-second Serverless limit
   - Implementation pattern: Use `new NextResponse()` with chunked data transfer

### Security Constraints (ADR 005)
1. **HMAC Mandatory**: Every stream must be signed by Vercel (`StreamToken`). Every persistence call must be signed by the Worker (`ContentSignature`). Shared secret: `STREAM_HMAC_SECRET`
2. **Key Segregation**: `SUPABASE_SERVICE_ROLE_KEY` MUST NOT exist in the Cloudflare Worker environment
3. **Token Expiry**: Stream tokens expire 120s after minting (`TOKEN_TTL_MS` in `web/lib/stream-token.ts`)

### Verification Protocols
#### 10x Verification Preflight Mandate
Before writing any file mutations or executing concurrent agent tasks:
1. **For Source Code Changes**:
   - `git status` — Confirm working tree state
   - `git diff HEAD <file>` — Check if target file already has the fix
   - `grep -r "pattern" web/` — Verify the problem still exists before fixing it

2. **For Dependency/Build Issues**:
   - `cd web && pnpm list <package>` — Confirm current package state
   - `cat pnpm-lock.yaml | grep <package>` — Verify lock file dependencies
   - `pnpm build --dry-run` — Check if build issue persists before applying fix

3. **For Configuration Files**:
   - `find . -maxdepth 1 -name "*.md" | wc -l` — Verify root folder structure (max 4 files)
   - `ls -la .vercelignore` — Check if ignore rules already exist
   - `grep -n "pattern" CLAUDE.md` — Confirm if documentation is already current

4. **For API/Route Changes**:
   - `grep -A5 "return" web/middleware.ts` — Verify early return statements are present
   - `grep -r "export const runtime" web/app/api/` — Check Edge Runtime configuration

## Database Schema

### Core Tables (from Supabase migrations)
1. **users**
   - id (uuid, primary key)
   - email (text, not null)
   - name (text)
   - avatar_url (text)
   - tier (text, default 'free')
   - stripe_customer_id (text)
   - stripe_subscription_id (text)
   - analyses_used (integer, default 0)
   - last_reset_date (timestamptz, default now())
   - created_at (timestamptz, default now())
   - updated_at (timestamptz, default now())

2. **analyses**
   - id (uuid, primary key)
   - user_id (uuid, not null)
   - video_id (text, not null)
   - title (text)
   - channel_title (text)
   - channel_id (text)
   - published_at (timestamp)
   - duration_seconds (integer)
   - view_count (bigint, default 0)
   - like_count (integer, default 0)
   - comment_count (integer, default 0)
   - thumbnail_url (text)
   - analysis_markdown (text, not null)
   - embedding (vector(1536))
   - created_at (timestamp, default current_timestamp)
   - updated_at (timestamp, default current_timestamp)
   - shared_token (varchar)
   - shared_expires_at (timestamptz)
   - model_attempted (text, default 'anthropic/claude-haiku-4.5')
   - validation_report (jsonb)
   - validation_passed (boolean, default false)
   - model_used (text, default 'anthropic/claude-haiku-4.5')

3. **usage_logs**
   - id (uuid, primary key)
   - user_id (uuid, not null)
   - action (text, not null)
   - tokens_used (integer, default 0)
   - cost_usd (numeric, default 0)
   - metadata (jsonb)
   - created_at (timestamptz, default current_timestamp)

4. **stripe_events**
   - id (text, primary key)
   - user_id (uuid)
   - event_type (text, not null)
   - amount_cents (integer)
   - status (text)
   - payload (jsonb)
   - created_at (timestamptz, default current_timestamp)

### Security
- Row Level Security (RLS) enabled on all sensitive tables
- Request-scoped Supabase clients for RLS enforcement
- Service role key used only for server-to-server persistence

## API Endpoints

### Web API Routes (`/web/app/api/`)
- `POST /api/analyses` - Initiate analysis (auth + quota + token minting)
- `GET /api/analyses` - Get user's analysis history
- `POST /api/analyses/persist` - S2S persistence endpoint (worker → Vercel)
- `GET /api/health` - Health check endpoint
- `GET /api/metadata` - Public video metadata endpoint
- `POST /api/transcript-proxy` - Transcript proxy (diagnostic bypass)
- `POST /api/stripe` - Stripe webhooks
- `POST /api/webhooks` - Generic webhooks
- `GET /auth/callback` - Supabase OAuth callback

### Worker API Routes (`/worker/src/`)
- `GET /` - Health check
- `GET /fetch-metadata` - YouTube metadata extraction
- `GET /fetch-transcript` - Transcript extraction
- `POST /analyze-llm-stream` - Direct browser→worker SSE streaming (LLM cascade)
- `POST /chat-stream` - Conversational streaming endpoint

## Environment Variables

### Required
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anon key
- `OPENROUTER_API_KEY` - OpenRouter API key for LLM access
- `STRIPE_SECRET_KEY` - Stripe secret key
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook secret
- `UPSTASH_VECTOR_REST_URL` - Upstash Vector REST URL
- `UPSTASH_VECTOR_REST_TOKEN` - Upstash Vector REST token

### Optional
- `NEXT_PUBLIC_SENTRY_DSN` - Sentry DSN for error tracking
- `NEXT_PUBLIC_APP_VERSION` - Application version
- `NEXT_PUBLIC_APP_URL` - Application URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (server-only)
- `CLOUDFLARE_WORKER_URL` - Cloudflare Worker URL
- `SENTRY_AUTH_TOKEN` - Sentry auth token
- `UPSTASH_REDIS_REST_URL` - Upstash Redis REST URL
- `UPSTASH_REDIS_REST_TOKEN` - Upstash Redis REST token
- `QSTASH_TOKEN` - QStash token
- `QSTASH_CURRENT_SIGNING_KEY` - QStash signing key
- `QSTASH_NEXT_SIGNING_KEY` - QStash next signing key
- `DECODO_API_KEY` - Decodo API key for metadata/proxy
- `STREAM_HMAC_SECRET` - Shared HMAC secret for Vercel↔Worker token signing

## Known Good State Verification

Before starting development, verify the system is in a Known Good State by running:

```bash
cd web
pnpm type-check && pnpm lint && pnpm build
```

Or run the full 25-item checklist from `/docs/ops/KNOWN_GOOD_STATE_CHECKLIST.md` which includes:
- Commit and Git state verification
- CI/CD pipeline status
- Codebase state checks
- Database and auth state validation
- Production deployment status
- Local development state verification

## Current Status

**Phase**: Phase 2 (MVP 1.5 Feature Expansion) - READY TO START
**Build**: 872f92e
**Last Updated**: 2026-05-21
**Production Deployment**: https://hex-yt-intel.vercel.app (LIVE)

All infrastructure (Tier 0-3) is stabilized and locked:
- ✅ Tier 0: Build & Deployment (Node/pnpm versioning, CI/CD pipeline)
- ✅ Tier 1: Authentication & Security (Middleware auth gates, RLS enforcement)
- ✅ Tier 2: Rate Limiting & Quota Enforcement (Redis circuit breaker, Lua-backed quota)
- ✅ Tier 3: Ready for Feature Work (Database schema, test infrastructure, API structure)

The system is production-ready and awaiting Phase 2 feature specifications.