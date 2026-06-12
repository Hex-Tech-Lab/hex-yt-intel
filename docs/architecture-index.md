# Architecture Index & Platform Boundaries

**Version**: 1.0.0  
**Build**: feat/three-strikes-qstash-zustand-graphql  
**Timestamp**: Tuesday, 19 May 2026 at 2:30 PM EEST  
**Purpose**: Master taxonomy of all architectural components, service boundaries, and data flow patterns

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Service Boundaries](#service-boundaries)
3. [Data Flow Pipelines](#data-flow-pipelines)
4. [State Management](#state-management)
5. [Async Execution Patterns](#async-execution-patterns)
6. [Documentation Taxonomy](#documentation-taxonomy)

---

## System Architecture

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js Edge Network (Vercel)                │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Browser / Client Layer                       │   │
│  │  - React Components (HomeContent, DashboardClient)       │   │
│  │  - Zustand Global State (useAnalysisStore)              │   │
│  │  - SSE Stream Decoder (consumeSSEStream)                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           ↓                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           API Layer (Next.js Route Handlers)            │   │
│  │  - POST /api/analyses (Streaming Response)             │   │
│  │  - POST /api/analyses/search (Semantic Search)         │   │
│  │  - POST /api/webhooks/validate (QStash Intake)        │   │
│  │  - POST /api/webhooks/embed (QStash Intake)           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           ↓                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │       Background Services (Async Guaranteed)            │   │
│  │  - Upstash QStash (Reliable Message Queue)             │   │
│  │  - Supabase Database (PostgreSQL + pgvector)          │   │
│  │  - OpenRouter API (LLM Claude + Fallback Chain)        │   │
│  │  - Sentry (Error Telemetry)                           │   │
│  │  - Upstash Redis (Rate Limiting + Quotas)            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Service Boundaries

### 1. Client Layer
**Scope**: Browser-side React application  
**Responsibility**: UI rendering, user interaction, state management  
**Key Components**:
- `web/components/HomeContent.tsx` — Main analysis interface
- `web/components/DashboardClient.tsx` — Results display
- `web/store/useAnalysisStore.ts` — Global state (Zustand)

**Invariant**: Client code does NOT import from `web/app/api/` (no circular dependencies)

---

### 2. API Layer (Serverless Middleware)
**Scope**: Next.js route handlers executing on Vercel Serverless (Node.js)  
**Responsibility**: Request validation, auth checks, orchestration, streaming response construction  
**Key Routes**:

#### `POST /api/analyses`
- **Input**: `{ url, timezone }`
- **Output**: Server-Sent Event (SSE) stream of markdown tokens
- **Execution**: Serverless (Node.js), 10-second timeout → Edge Runtime streaming extends to ~25s
- **Error Handling**: 429 on rate limit, 403 on auth failure, 500 on recoverable errors
- **Async Pattern**: `after()` for guaranteed post-response validation webhook publication

#### `POST /api/analyses/search`
- **Input**: `{ query, limit, threshold, filters, page }`
- **Output**: JSON array of matching analyses with similarity scores
- **Execution**: GraphQL query to Supabase pgvector, 30-second timeout
- **Error Handling**: 429 on rate limit, 500 on database errors

#### `POST /api/webhooks/validate`
- **Input**: QStash webhook with validation payload (from background queue)
- **Output**: JSON `{ success, analysisId, passed }`
- **Execution**: Serverless, 10-second timeout
- **Auth**: QStash signature verification (HMAC-SHA256, fail-fast on missing key)
- **Async Pattern**: `after()` to trigger embedding generation webhook

#### `POST /api/webhooks/embed`
- **Input**: QStash webhook with embedding payload
- **Output**: Vector embeddings stored in Supabase pgvector
- **Execution**: Serverless
- **Error Handling**: Non-blocking, Sentry breadcrumbs on failure

---

### 3. Background Services (Guaranteed Async)
**Scope**: Async operations that continue after Vercel Serverless timeout  
**Responsibility**: Durable task execution, data persistence, ML operations

#### Upstash QStash (Message Queue)
**Purpose**: Guarantee webhook delivery even if Vercel cuts connection at 10s  
**Mechanism**:
1. Client initiates analysis → API creates QStash task
2. QStash calls webhook endpoint with exponential backoff (up to 3 retries)
3. Webhook processes task independently of client connection
4. Idempotency keys prevent duplicate execution

**Idempotency Keys**: Each task uses `analysisId` as unique key → QStash deduplicates within 24h window

**Implementation**: `web/lib/qstash-client.ts`

#### Supabase Database (PostgreSQL + pgvector)
**Purpose**: Durable analysis storage, semantic search via vector embeddings  
**Schema**:
- `analyses` table: stores markdown, validation reports, metadata
- `usage_logs` table: tracks quota usage (free tier: 3/month)
- RLS: Disabled on `users` table (OAuth signup), Enabled on `analyses` (row-level security)

**Implementation**: `web/lib/supabase.ts` factory

#### OpenRouter API (Claude Fallback Chain)
**Purpose**: LLM inference for analysis generation  
**Model Chain**:
1. Primary: `anthropic/claude-haiku-4.5` (default OpenRouter routing)
2. Alternate Route: `anthropic/claude-haiku-4.5` (explicit CSP routing via Google Vertex / Amazon Bedrock to bypass default route transit issues)
3. Emergency Fallback: `anthropic/claude-sonnet-4.6:nitro`
4. Timeouts: Early 3-second connection handshake timeout (early fault detection) followed by an adaptive ~25-second token streaming window.

**Implementation**: `web/lib/config/cascade.ts` and `web/lib/services/openrouter.ts`

#### Sentry (Error Telemetry)
**Purpose**: Error logging, performance monitoring, breadcrumbs  
**Integration Points**:
- Store: All `Sentry.captureException()` calls with phase tags
- API: All error paths log to Sentry with context
- Decoder: `stream_parse` warnings (malformed JSON) and `stream_read` errors (network)

**Implementation**: `web/lib/monitoring/sentry-utils.ts`

#### Upstash Redis (Rate Limiting)
**Purpose**: Per-user quota enforcement (free: 3/month, pro: unlimited)  
**Mechanism**:
1. Check Redis key `quota:{userId}:{year}-{month}` (TTL = 30 days)
2. If count >= limit, return 429 (with Retry-After header)
3. Lua script atomically increments counter
4. Type coercion utility prevents string/number comparison bugs

**Implementation**: `web/lib/rate-limit.ts`

---

## Data Flow Pipelines

### Pipeline 1: Analysis Creation (User → OpenRouter → Supabase)

```
1. Client: POST /api/analyses
   ├─ Input: { url, timezone }
   ├─ Auth check (middleware)
   ├─ Rate limit check (Redis)
   └─ Cache check (Supabase): existing analysis?

2. API Handler (/api/analyses)
   ├─ Validate input (zod schema)
   ├─ Extract video ID
   ├─ Query YouTube metadata (worker-client.ts)
   ├─ Stream analysis from OpenRouter (HTTP with timeout)
   ├─ Return SSE stream to client
   └─ (Via after()): Publish validation task to QStash

3. Client: Consume SSE stream
   ├─ Create TextDecoder
   ├─ Read chunks → buffer → split lines
   ├─ parseSSELine() → extract tokens
   ├─ Accumulate markdown
   └─ Process final tail buffer on stream close

4. Background: QStash Webhook (POST /api/webhooks/validate)
   ├─ Verify QStash signature (HMAC)
   ├─ Run UCIS v5.1 validation
   ├─ Update Supabase: validation_report, validation_passed
   └─ (Via after()): Publish embedding task to QStash

5. Background: QStash Webhook (POST /api/webhooks/embed)
   ├─ Extract embeddings from markdown (OpenRouter)
   └─ Store vectors in Supabase pgvector
```

**Invariant**: No data loss at stream boundaries; final tokens processed even if incomplete.

### Pipeline 2: Semantic Search (Query → Supabase pgvector → GraphQL)

```
1. Client: POST /api/analyses/search
   ├─ Input: { query, limit, threshold, filters, page }
   ├─ Auth check (middleware)
   └─ Rate limit check (Redis)

2. API Handler (/api/analyses/search)
   ├─ Create GraphQL client (fail-fast on missing Supabase URL/key)
   ├─ Generate embedding for query (OpenRouter)
   ├─ Execute vector similarity search (pgvector cosine distance)
   ├─ Apply filters (date, status)
   ├─ Apply pagination (limit, offset)
   └─ Return { results[], hasMore }

3. Client: Zustand store
   ├─ Check for 429 rate limit response
   ├─ If locked: Set isLockedOut=true, lockedUntil=timestamp
   └─ Display results or lockout message
```

**Error Handling**:
- 429 → Extract Retry-After, set lockout window
- 500 → Sentry, user sees error message
- GraphQL timeout (30s) → AbortSignal, rethrow as network error

---

## State Management

### Zustand Store: `useAnalysisStore`

**Location**: `web/store/useAnalysisStore.ts`

**State Fields**:
```typescript
{
  // Current analysis
  analysis: AnalysisResult | null,
  analysisId: string | null,
  
  // UI state
  isLoading: boolean,
  status: 'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error',
  error: string | null,
  
  // Rate limiting
  lockoutTimeRemaining: number,
  isLockedOut: boolean,
  lockedUntil: number | null,
  
  // History
  analysisHistory: AnalysisResult[]
}
```

**Deduplication**: `addToHistory()` checks for existing `analysisId` and merges instead of pushing duplicates

**Rate Limit Handling**: On 429 response, set `isLockedOut=true` and calculate `lockedUntil` from Retry-After header

**PII Sanitization**: Before Sentry capture, `sanitizeErrorContext()` redacts URLs, emails, and stack traces

---

## Async Execution Patterns

### Pattern 1: Guaranteed Post-Response Execution (via `after()`)

**Used in**: `web/app/api/analyses/route.ts` (validation webhook), `web/app/api/webhooks/validate/route.ts` (embedding webhook)

```typescript
// In API handler
export async function POST(request: NextRequest) {
  // ... main request handling, return response ...
  
  after(async () => {
    // This runs AFTER response is sent to client
    // Guaranteed to complete (even if 10s Serverless timeout would occur)
    await publishValidationTask({...});
  });
  
  return NextResponse.json({ success: true });
}
```

**Benefit**: Decouples client response time from background operations

### Pattern 2: Error Callback with Observability

**Used in**: SSE decoder, streaming response consumption

```typescript
await consumeSSEStream(
  reader,
  (token) => { markdown += token; },
  (error, phase) => {
    Sentry.captureException(error, {
      tags: { phase: `stream_${phase}` },
      level: phase === 'parse' ? 'warning' : 'error'
    });
    
    if (phase === 'read') throw error;  // Fatal
  }
);
```

**Benefit**: Parse errors don't crash stream; read errors properly propagate

### Pattern 3: Explicit Environment Validation

**Used in**: All client factory functions (Supabase, GraphQL, QStash)

```typescript
export function createSupabaseGraphQLClient(): GraphQLClient {
  const endpoint = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!endpoint) throw new Error('NEXT_PUBLIC_SUPABASE_URL required');
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY required');
  
  try {
    new URL(endpoint);
  } catch {
    throw new Error(`Invalid URL format: ${endpoint}`);
  }
  
  return new GraphQLClient(endpoint, anonKey, 30000);
}
```

**Benefit**: Fail-fast on missing credentials; no silent fallbacks

---

## Documentation Taxonomy

### Master Index Files
- **This File**: Architecture boundaries and data flows
- `CLAUDE.md`: Deployment instructions, environment variables, quick start

### Technical Specifications
- `docs/streaming-decoder.md` — SSE decoder architecture, complete token processing
- `docs/IMPLEMENTATION_PLAN_v2.0_FINAL.md` — Feature breakdown, milestones
- `docs/SECURITY_FIXES_REQUIRED.md` — Security hardening checklist

### Infrastructure & Operations
- `docs/ops/DATABASE_SEEDING_E2E_2026_05_17_1339.md` — Test user setup, E2E testing
- `docs/ops/REDIS_SETUP.md` — Upstash Redis configuration
- `docs/ops/VERCEL_ENV_SETUP.md` — Environment variables reference

### Testing & Validation
- `docs/testing/OAUTH_TESTING_CHECKLIST.md` — OAuth flow verification
- `docs/testing/visible_production_telemetry.spec.ts` — E2E test suite (Playwright)

### Historical Records
- `docs/history/HANDOVER_REPORT_*.md` — Session exit reports with context
- `docs/history/TRIAL_LOG_*.md` — Consolidated decision logs

### Domain-Specific Guides
- `docs/OAUTH_SETUP_CHECKLIST.md` — Google/GitHub OAuth configuration
- `docs/OBSERVABILITY.md` — Sentry, logging, monitoring setup
- `docs/UCIS_V5_ROLLOUT_COMPLETE.md` — Validation schema documentation

---

## Circular Dependency Audit

**Scope**: Check for imports that would create cycles between:
- Global state (Zustand store)
- API endpoints
- Client utilities

**Result**: ✅ CLEAN
- Store (`web/store/`) is only imported by React components
- API endpoints (`web/app/api/`) do not import from store
- Libraries (`web/lib/`) have no cross-imports with API/store

**Verification Command**:
```bash
# Check if any API route imports from store
grep -r "from.*useAnalysisStore\|import.*useAnalysisStore" web/app/api
# Expected: No results
```

---

## Build & Performance Constraints

**Next.js Bundle Target**: 4.63 kB (gzipped production bundle)

**Bundle Breakdown**:
- React + React-DOM: 40 kB
- Zustand: 2 kB
- Sentry SDK: 50+ kB (only production builds)
- Tailwind CSS + shadcn/ui: ~60 kB

**Total Uncompressed**: ~152 kB  
**Gzipped**: ~35 kB (acceptable for Next.js app)

**Permanently Banned**:
- Material-UI (@mui/material) → +50 kB
- Emotion CSS-in-JS → +40 kB (introduces hydration mismatches on Edge)

---

## Version History

### v1.0.0 (2026-05-19)
- Initial architecture index
- Complete platform boundary documentation
- Data flow pipelines for analysis and search
- Async execution patterns
- Documentation taxonomy
- Circular dependency audit (clean)
