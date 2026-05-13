# hex-yt-intel Product Requirements Document (PRD)
**Version**: 1.0 (Foundational)  
**Status**: Approved for implementation  
**Date**: 2026-05-13  
**Scope**: Complete product (MVP includes all core features, not skeletal)

---

## EXECUTIVE SUMMARY

**hex-yt-intel** is a YouTube Content Intelligence System that analyzes videos using the UCIS v3.2 framework, stores results, enables semantic search across your analysis history, and integrates with your knowledge management system (second brain).

**Core Value Proposition**: Transform one-off video analysis into cumulative intelligence. Over time, your analysis library becomes searchable, exportable, and actionable.

**Target User**: Content creators, researchers, product managers, investors who consume YouTube content and want to extract + retain insights.

**Revenue Model**: Freemium ($9/month Pro tier)

---

## VISION STATEMENT (2026)

By end of 2026, hex-yt-intel becomes the "second brain for YouTube content":
- Users analyze videos once, search insights forever
- Semantic search finds related videos across 100+ analyses
- One-click export to Markdown/JSON/CSV for Obsidian/Notion/custom vaults
- Usage-based billing ensures cost efficiency (free tier: 3 analyses; Pro: unlimited)
- Vector embeddings enable future integration with hex-adhd-prep system

---

## PRODUCT TIERS

### Free Tier
| Feature | Limit |
|---------|-------|
| Monthly analyses | 3 |
| Search | ❌ No (read-only history only) |
| History retention | 30 days (auto-delete) |
| Export | ❌ No |
| API access | ❌ No |
| Users | Individual only |

### Pro Tier ($9/month)
| Feature | Limit |
|---------|-------|
| Monthly analyses | Unlimited |
| Search | ✅ Unlimited vector search |
| History retention | 1 year (manual delete only) |
| Export | ✅ Markdown, JSON, CSV |
| API access | ✅ 100 requests/day |
| Users | Individual (future: teams) |
| Custom integrations | ✅ (Phase 2) |

### Enterprise (TBD)
- Custom retention (7 years for compliance)
- Audit logs
- Team collaboration
- Webhook events
- SLA / priority support

---

## CORE FEATURES (Prioritized)

### P0: Foundation (MVP Required)
1. **Video Analysis** (UCIS v3.2)
   - Input: YouTube URL
   - Output: 16-section comprehensive analysis (markdown)
   - Integration: Cloudflare Worker for metadata
   - Cost: Use Claude subscription (CCW, no API calls)

2. **Authentication**
   - OAuth: Google + GitHub
   - User profiles (email, tier, quota usage)
   - Session management (JWT in httpOnly cookies)

3. **Analysis Storage**
   - PostgreSQL (Supabase)
   - Store: user_id, video_id, title, metadata, analysis (markdown), embeddings (1536-dim vector)
   - RLS: Users can only see/search their own analyses
   - Timestamps: created_at, updated_at

4. **History & Search**
   - List past analyses (paginated)
   - Semantic search via pgvector (cosine similarity)
   - Filter by date, title, channel, likes, views
   - Sort by relevance, newest, most viewed

5. **Export**
   - Download single analysis as Markdown
   - Bulk export: all analyses as ZIP (Markdown files) or JSON
   - CSV export: metadata + summary (for spreadsheet analysis)

6. **Billing & Usage**
   - Stripe integration (free → Pro conversion)
   - Usage tracking: analyses used this month (free: 0-3, Pro: unlimited)
   - Quota enforcement: block analysis if free tier exhausted
   - Invoice history (Pro users)

7. **Rate Limiting**
   - Upstash Redis: 10 analyses/hour per user (free), unlimited (Pro)
   - IP-based DOS protection: 100 analyses/hour per IP

### P1: Polish & Observability
8. **Error Tracking** (Sentry)
   - Frontend errors + stack traces
   - Backend API errors
   - Worker errors (metadata fetch failures)
   - Issue alerting (Slack/email for critical errors)

9. **Analytics**
   - Daily active users (DAU)
   - Analyses per day
   - Free → Pro conversion rate
   - Search query patterns
   - Export usage

10. **Performance Monitoring**
    - Response time: Web app load time, API latency
    - Vector search latency (pgvector queries)
    - Worker response times
    - Database query performance

### P2: Second Brain Integration (Post-MVP)
11. **API for External Systems**
    - REST API: GET /api/analyses, POST /api/search
    - Webhook support: Notify external systems on new analysis
    - Data export: Bulk export for syncing to Obsidian/Notion

12. **Semantic Cross-System Search**
    - Future: Query both hex-yt-intel + hex-adhd-prep analyses in one search
    - Unified vector store (shared Supabase)
    - Cross-reference insights

---

## DATA MODEL

### Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  tier TEXT DEFAULT 'free', -- 'free' | 'pro' | 'enterprise'
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  analyses_used INT DEFAULT 0,
  last_reset_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Analyses Table
```sql
CREATE TABLE analyses (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT,
  channel_title TEXT,
  channel_id TEXT,
  published_at TIMESTAMP,
  duration_seconds INT,
  view_count BIGINT,
  like_count INT,
  comment_count INT,
  thumbnail_url TEXT,
  
  -- Analysis content
  analysis_markdown TEXT NOT NULL, -- Full UCIS v3.2 output
  
  -- Vector embedding (1536 dimensions)
  embedding vector(1536),
  
  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT unique_analysis_per_video UNIQUE(user_id, video_id)
);

CREATE INDEX ON analyses USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### Usage Tracking Table
```sql
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'analysis', 'search', 'export'
  tokens_used INT DEFAULT 0,
  cost_usd DECIMAL(10, 4),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Stripe Events Table
```sql
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'charge.succeeded', 'subscription.updated', etc.
  amount_cents INT,
  status TEXT, -- 'success' | 'failed'
  payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### RLS Policies
- Users can only read/write their own analyses
- Users can only see their own usage logs
- Admin (future) can see all data for support

---

## API SPECIFICATION

### Authentication
- **OAuth Providers**: Google (Google Cloud Console), GitHub (GitHub OAuth App)
- **Session Management**: JWT stored in httpOnly cookie, refresh token rotation
- **CORS**: Allow only vercel.app + localhost:3000

### Endpoints

#### POST /api/auth/login
```json
// Request
{ "provider": "google" | "github" }

// Response 200
{
  "user": { "id", "email", "name", "tier" },
  "token": "jwt_token"
}
```

#### POST /api/auth/logout
```json
// Response 200
{ "success": true }
```

#### POST /api/analyses
```json
// Request
{ "video_id": "dQw4w9WgXcQ" }

// Response 200
{
  "id": "uuid",
  "video_id": "dQw4w9WgXcQ",
  "title": "...",
  "analysis_markdown": "# UCIS v3.2 Analysis\n...",
  "created_at": "2026-05-13T..."
}

// Response 429 (quota exceeded)
{ "error": "Monthly quota exceeded (3/3 analyses used)" }

// Response 402 (payment required for Pro)
{ "error": "Upgrade to Pro for unlimited analyses" }
```

#### GET /api/analyses
```json
// Query params: ?skip=0&limit=20&search=query&sort=newest

// Response 200
{
  "analyses": [
    {
      "id": "uuid",
      "video_id": "...",
      "title": "...",
      "channel_title": "...",
      "view_count": 150000,
      "created_at": "2026-05-13T..."
    }
  ],
  "total": 42,
  "has_more": true
}
```

#### GET /api/analyses/:id
```json
// Response 200
{
  "id": "uuid",
  "video_id": "...",
  "title": "...",
  "analysis_markdown": "# UCIS v3.2\n...",
  "created_at": "..."
}
```

#### POST /api/analyses/search
```json
// Request
{ "query": "AI generated content" }

// Response 200
{
  "results": [
    {
      "id": "uuid",
      "title": "...",
      "similarity_score": 0.92,
      "created_at": "..."
    }
  ],
  "query_time_ms": 145
}
```

#### DELETE /api/analyses/:id
```json
// Response 200
{ "success": true }

// Response 403 (not Pro, retention policy)
{ "error": "Free tier analyses auto-delete after 30 days" }
```

#### POST /api/analyses/export
```json
// Request
{ "format": "markdown" | "json" | "csv", "filter": { "from": "2026-01-01", "to": "2026-05-13" } }

// Response 200
// File download (Content-Type: application/zip or text/csv)
```

#### GET /api/usage
```json
// Response 200
{
  "user_id": "uuid",
  "tier": "free",
  "analyses_this_month": 2,
  "analyses_limit": 3,
  "reset_date": "2026-06-13",
  "searches_used": 5,
  "api_requests_used": 0,
  "cost_this_month_usd": 0.00
}
```

#### POST /api/stripe/webhook
```json
// Stripe sends:
{
  "type": "charge.succeeded" | "customer.subscription.updated",
  "data": { "object": { ... } }
}

// Response 200
{ "received": true }
```

---

## TECHNICAL STACK (FROZEN)

- **Language**: TypeScript (strict mode, 100% type aliases)
- **Monorepo**: Turborepo + pnpm workspaces
- **Frontend**: Next.js 15 + React 19 + Tailwind CSS + shadcn/ui
- **Backend**: Next.js API routes (serverless)
- **Database**: Supabase PostgreSQL + pgvector
- **Cache/Rate Limiting**: Upstash Redis
- **Storage**: S3 or Vercel Blob (for export ZIP files)
- **Authentication**: next-auth or Supabase Auth + Google + GitHub OAuth
- **Payments**: Stripe API + webhooks
- **Metadata Fetcher**: Cloudflare Worker (existing)
- **Deployment**: Vercel (monorepo root)
- **Observability**: Sentry (errors), PostHog (analytics), custom usage logs
- **Testing**: Jest + React Testing Library + Supertest (API)

---

## DEPLOYMENT CHECKLIST

### Pre-Launch
- [ ] Supabase project created + pgvector enabled
- [ ] Tables created with RLS policies
- [ ] Indexes created (pgvector, user_id)
- [ ] Stripe account configured + webhook endpoint
- [ ] Google OAuth app created (Google Cloud Console)
- [ ] GitHub OAuth app created (GitHub Settings)
- [ ] Upstash Redis namespace created
- [ ] Cloudflare Worker verified (existing)
- [ ] Environment variables set (.env.local, Vercel dashboard)
- [ ] Sentry project created
- [ ] PostHog project created (optional)

### Launch
- [ ] Run migrations (Supabase)
- [ ] Deploy to Vercel
- [ ] Test OAuth flows (Google, GitHub)
- [ ] Test analysis creation (free tier, Pro tier)
- [ ] Test vector search
- [ ] Test quota enforcement
- [ ] Test Stripe payment flow
- [ ] Monitor error tracking (Sentry)
- [ ] Monitor performance (Vercel Analytics)

---

## SUCCESS METRICS (Phase 1)

1. **Availability**: 99.5% uptime (SLA)
2. **Response Time**: <2s for analysis creation, <500ms for searches
3. **Quality**: 0 unhandled errors (Sentry error budget: <10/day)
4. **Security**: 0 data breaches, RLS policies tested, OWASP top 10 coverage
5. **Cost**: <$50/month (Supabase + Upstash + Worker + Vercel)
6. **User Satisfaction**: Beta testers report >=8/10 usability

---

## RISKS & MITIGATION

| Risk | Impact | Mitigation |
|------|--------|-----------|
| pgvector performance at scale | High latency for searches | Index tuning, pagination, caching |
| Stripe webhook failures | Billing inconsistency | Retry logic, dead-letter queue, manual reconciliation |
| Vector embedding costs | Budget overrun | Cache embeddings, batch processing, monitor API usage |
| Free tier abuse (mass analysis) | Resource exhaustion | Rate limiting (10/hour), IP-based DOS protection, CAPTCHA |
| GDPR compliance (data deletion) | Legal risk | Automatic deletion for free tier (30 days), audit logs, manual deletion for Pro |

---

## ROADMAP

### Phase 1 (May-June 2026): MVP Complete Product
- [x] Supabase setup + schema
- [x] Backend API (CRUD + auth + billing)
- [x] Frontend (web app, analysis, search, export)
- [x] Stripe integration
- [x] Rate limiting
- [x] Error tracking

### Phase 2 (July-August 2026): Polish & Integration
- [ ] Team collaboration (shared analyses)
- [ ] Webhook API for external systems
- [ ] Obsidian/Notion integration
- [ ] Advanced filtering (channel, date range, view count)
- [ ] Bulk analysis (queue multiple videos)

### Phase 3 (Sept-Oct 2026): Second Brain
- [ ] Shared vector store with hex-adhd-prep
- [ ] Cross-system semantic search
- [ ] Auto-sync to user's vault (Obsidian/Notion)
- [ ] Knowledge graph visualization

### Phase 4 (Nov-Dec 2026): Enterprise
- [ ] Team plans ($29/month)
- [ ] Custom retention policies
- [ ] Audit logs
- [ ] SSO (SAML)
- [ ] SLA + priority support

---

## DEFINITIONS

- **UCIS v3.2**: Ultimate Content Intelligence System v3.2 (16-section analysis framework)
- **RLS**: Row-Level Security (PostgreSQL policy-based access control)
- **pgvector**: PostgreSQL extension for vector embeddings + similarity search
- **Cosine Similarity**: Vector similarity metric (0 = no match, 1 = perfect match)
- **Vector Embedding**: 1536-dimensional numeric representation of text (OpenAI text-embedding-3-small)
- **Stripe Webhook**: HTTPS POST from Stripe to your endpoint (async payment events)
- **Upstash Redis**: Serverless Redis (pay-per-request, ideal for rate limiting)
- **Next-auth**: Authentication library for Next.js (OAuth, JWT, sessions)

---

## NEXT STEPS

1. ✅ Create detailed API specification (above)
2. ✅ Create database schema with RLS (above)
3. ⏳ Create chunked implementation task list (with verification gates)
4. ⏳ Set up Supabase project + database
5. ⏳ Build backend API routes
6. ⏳ Build frontend web app
7. ⏳ Integrate Stripe + usage tracking
8. ⏳ Deploy to Vercel

---

**Document Approved By**: Kelly B. (2026-05-13)  
**Status**: Ready for implementation
