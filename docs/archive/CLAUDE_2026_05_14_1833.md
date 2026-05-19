# CLAUDE.md v2.0 — HEX-YT-INTEL Master Control

**Date:** May 13, 2026  
**Status:** FINAL (locked, production-ready)  
**Sprint:** 48 hours (May 13-15) + design polish (May 16-21) + launch May 22  
**Council Confidence:** 82/100  

---

## QUICK START

```bash
# Clone
cd /home/kellyb_dev/projects/hex-yt-intel

# Set env vars
cp web/.env.local.example web/.env.local
# Edit with Supabase + Stripe + Claude + Google credentials

# Install
pnpm install

# Dev server
pnpm run dev

# Type-check
pnpm run type-check

# Build & deploy
pnpm run build
```

---

## PROJECT OVERVIEW

**What:** YouTube content synthesis SaaS (evolved from Claude Skill)

**Why:** Market validated. 3 personas + council 82% confidence. $1-1.6K MRR Month 1 achievable.

**Scope:** 11 P0+P1 features, 4-tier freemium pricing, team collaboration

**Timeline:** 48-hour sprint (May 13-15) → shipped MVP May 15 → design polish (May 16-21) → launch ProductHunt May 22

---

## PRODUCT SPEC (See PRD.md for Full Details)

### Personas (Validated)
| Persona | Score | TAM | ARPU | Distribution |
|---------|-------|-----|------|--------------|
| **Creator** | 88/100 | 500K | $9/mo | YouTube, TikTok, Twitter |
| **Maker** | 81/100 | 150K | $9/mo | Twitter, Indie Hackers, Slack |
| **Consultant** | 75/100 | 20K | $49/mo | LinkedIn, email (Month 2+) |

### Pricing (LOCKED)
- **Free:** $0, 3 syntheses/month
- **Pro:** $9/mo, unlimited, search, export
- **Startup:** $19/mo, 5-user team, shareable analyses
- **SME/Catalyst:** $49/mo, 10-user team, integrations, API

**Annual:** 20-30% discount (e.g., Pro $81/year vs $108/year)

### Features (11 Total, All MVP)
**P0:** URL input, transcript, synthesis, auth, free tier  
**P1:** Search, team repos, invite, PDF, sharing, billing  
**P2 (Deferred):** Integrations, advanced API, SSO, AI chat

---

## ARCHITECTURE

### Tech Stack (FROZEN)

| Layer | Tech | Why |
|-------|------|-----|
| **Frontend** | Next.js 15 + React 19 + TS strict | App router, server components |
| **API** | Next.js API routes | Co-located, single deploy |
| **DB** | Supabase (PostgreSQL) | pgvector native, RLS, managed |
| **Vector** | pgvector (in Supabase) | No external service, cost-efficient |
| **Auth** | NextAuth.js v5 + Google | Simple, Supabase adapter |
| **Worker** | Cloudflare (existing) | Metadata + transcript (yt-intel.hex-tech-lab.workers.dev) |
| **LLM** | Claude Sonnet 4.5 | Synthesis + embeddings |
| **Payments** | Stripe | Subscriptions, webhooks |
| **Cache** | Upstash Redis | Rate limiting, sessions |
| **Observability** | Sentry | Error tracking ($10/mo) |
| **Hosting** | Vercel + Supabase | Native integration, auto-scale |
| **Styling** | Tailwind + shadcn/ui | Rapid UI, minimal design work |

### Monorepo Structure
```
hex-yt-intel/
├── apps/web/              ← Next.js (frontend + API)
│   ├── app/
│   │   ├── (auth)/
│   │   ├── api/           ← Routes (metadata, analyses, search, stripe, admin)
│   │   ├── components/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── public/
│   ├── package.json
│   └── tsconfig.json
├── packages/types/        ← Shared TS types
├── worker/                ← Cloudflare Worker (existing)
├── supabase/
│   ├── migrations/
│   │   ├── 001_initial_schema.sql (4 tables, RLS, indexes)
│   │   └── 002_search_function.sql (pgvector helper)
│   └── config.toml
├── docs/
│   ├── SUPABASE_SETUP.md
│   ├── PRD.md
│   ├── IMPLEMENTATION_PLAN.md
│   └── CLAUDE.md
├── pnpm-workspace.yaml
├── turbo.json
├── package.json           ← Root (dev, build, test, lint commands)
└── tsconfig.json          ← Root TS config
```

### Data Model (Team-Enabled)

```sql
users
├── id (UUID, PK)
├── email (string, unique)
├── google_id (string, unique)
├── tier (enum: free, pro, startup, sme) ← Pricing tier
├── analyses_used (int, default 0)        ← Free tier counter
├── stripe_customer_id (string, nullable)
└── created_at, updated_at

analyses
├── id (UUID, PK)
├── user_id (FK → users)
├── team_id (FK → teams, nullable)       ← Which team owns it
├── video_id (string)
├── video_title, channel_name, transcript
├── synthesis (text, UCIS 16-section markdown)
├── synthesis_embedding (vector 1536, pgvector ivfflat index)
├── repo_type (enum: personal, team)     ← Personal or team analysis
├── shared_token (string, nullable)      ← Public link
├── shared_expires_at (timestamp, nullable)
└── created_at, updated_at

teams
├── id (UUID, PK)
├── name (string)
├── owner_id (FK → users)
├── member_count (max 5 or 10 by tier)
└── created_at, updated_at

team_members
├── id, team_id, user_id
├── role (enum: owner, editor, viewer)
└── joined_at

usage_logs
├── id, user_id, action, metadata (jsonb)
└── created_at

stripe_events
├── id, stripe_event_id, event_type, payload
└── created_at

Indexes:
├── users(google_id, email)
├── analyses(user_id, created_at)
├── analyses.synthesis_embedding (ivfflat, cosine)
├── usage_logs(user_id, created_at)
└── stripe_events(stripe_event_id)

RLS Policies (9 total):
├── users: SELECT own record only
├── analyses: SELECT own + team + shared (by token)
├── usage_logs: SELECT own only
└── stripe_events: Admin only
```

### API Endpoints (12 Total)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/signin` | None | Google OAuth callback |
| POST | `/api/auth/signout` | User | Sign out |
| GET | `/api/user` | User | Current user profile |
| POST | `/api/metadata` | User | Fetch YouTube metadata |
| POST | `/api/analyses` | User | Create synthesis |
| GET | `/api/analyses` | User | List user's analyses |
| GET | `/api/analyses/{id}` | User | Get analysis detail |
| DELETE | `/api/analyses/{id}` | User | Delete analysis |
| POST | `/api/analyses/{id}/export?format=pdf` | User | Export as PDF |
| POST | `/api/analyses/{id}/share` | User | Generate share link |
| POST | `/api/search` | User | Semantic search |
| POST | `/api/stripe/webhook` | Stripe sig | Webhook handler |

---

## KEY DECISIONS & RATIONALE

### Why Supabase (Not Firebase)?
- pgvector (vector search) native, no external service
- RLS (row-level security) for fine-grained auth
- PostgreSQL maturity + SQL power
- Self-host escape hatch if needed

### Why Next.js API Routes (Not Separate Backend)?
- Co-location reduces latency
- Single deployment (Vercel)
- Simpler auth (NextAuth Supabase adapter)
- Faster iteration (backend + frontend together)

### Why Cloudflare Worker (Not Next.js Endpoint)?
- Already tested, proven reliable
- Geo-distributed (90+ countries)
- Independent scaling
- Lower latency for metadata fetches

### Why Claude Sonnet 4.5 (Not Opus/Haiku)?
- Sonnet sweet spot: quality + speed
- Haiku too weak for UCIS 16-section synthesis
- Opus overkill + cost (4x Sonnet)
- Switching cost: repromppting required

### Why Stripe (Not Paddle/LemonSqueezy)?
- Webhook reliability proven at scale
- Subscription management mature
- Least likely payment failures
- Industry standard (investors expect it)

### Why Upstash Redis (Not Local)?
- Serverless (Vercel compatible)
- No operational overhead
- Rate limiting built-in
- Cost scales with usage

### Why No Enterprise Tier in MVP?
- Reduces scope, focuses on validated personas
- Enterprise sales cycle: 3-6 months
- Can add Year 2+ if demand
- Frees engineering time for creators/makers

---

## MONITORING & OBSERVABILITY

### Sentry Configuration
```
Budget: $10/mo
Events: All errors + warnings
Integration: Next.js error boundary
Alert: >10 errors/day → email
Environments: staging, production
```

### Rate Limiting (Upstash Redis)
```
Free tier: 3 requests/day (synthesis limit + search)
Pro tier: 100 requests/day
Startup tier: 500 requests/month per team
SME tier: 5000 requests/month per team
Enforcement: Middleware + header check
```

### Database Monitoring
```
Query latency: <500ms (p95)
Connection pool: 20 (Supabase default)
Backups: Daily (Supabase auto)
Disk usage: Monitor quarterly
```

### API Health Checks
```
Metadata endpoint: 200 in <3s
Synthesis endpoint: 200 in <30s (depends on Claude)
Search endpoint: 200 in <2s
Stripe webhook: Re-delivery if failed (standard)
```

---

## DEPLOYMENT CHECKLIST

### Before Launch
- [ ] Supabase production project created
- [ ] Stripe live mode keys set in Vercel env vars
- [ ] Claude API key (Sonnet 4.5)
- [ ] Google OAuth credentials (non-sandbox)
- [ ] Cloudflare Worker endpoint verified
- [ ] Sentry project created + DSN in env
- [ ] Upstash Redis created + connection string
- [ ] Email configured (for Stripe receipts)
- [ ] Domain DNS (if custom)
- [ ] SSL auto-generated (Vercel default)

### Post-Launch
- [ ] Monitor Sentry errors hourly (first 48h)
- [ ] Check Stripe webhook delivery rate (100%)
- [ ] Verify database backups running
- [ ] Test rate limiting (block 4th synthesis/day free)
- [ ] Monitor API latency (<30s synthesis)

---

## QUICK COMMANDS

```bash
# Type-check
pnpm run type-check

# Build
pnpm run build

# Dev server (http://localhost:3000)
pnpm run dev

# Format code
pnpm run format

# Lint
pnpm run lint

# Database
supabase db push          # Push migrations
supabase db pull          # Fetch schema
supabase start            # Local dev
supabase stop             # Stop local

# Turbo caching
pnpm run build --filter=web    # Build only web
turbo run build --cache=off    # Force rebuild

# Test
pnpm run test
pnpm run test:watch

# Clean
pnpm run clean            # Remove node_modules, builds
```

---

## ESCALATION PATHS

| Issue | Action |
|-------|--------|
| **Chunk gate fails** | Debug + fix before proceeding (don't skip gates) |
| **TypeScript error** | Run `pnpm run type-check` first; fix before build |
| **Supabase migration fails** | Run `supabase db reset` (local only) or contact support |
| **Stripe webhook not firing** | Check Stripe dashboard → Events; re-deliver manually |
| **Vercel deployment fails** | Check build logs; usually env var missing |
| **Claude API rate limits hit** | Implement exponential backoff; fallback to cached |
| **Database space full** | Contact Supabase support; upgrade plan |
| **Git merge conflicts** | One person per feature; shouldn't happen |
| **Syntax/import errors** | Check `web/tsconfig.json` + error message |
| **Stuck >15 min on issue** | Document error, ask for help (don't guess) |

---

## RISK & MITIGATION SUMMARY

| Risk | Prob | Mitigation |
|------|------|-----------|
| **Virality collapse (k < 0.1)** | 35% | Monitor Week 2-3; switch to paid acq if needed |
| **Solo founder scaling (Week 3-4)** | 35% | Hire freelance engineer by Week 2 |
| **Positioning wrong (creators don't want synthesis)** | 25% | User interviews Week 1; A/B test landing page |
| **Notion adds synthesis (Month 6)** | 40% | Build Notion integration; focus on team features |
| **pgvector scaling (10K+ analyses)** | 15% | Monitor query latency; plan Pinecone migration |
| **Stripe webhook failures** | 10% | Test sandbox; implement re-delivery + reconciliation |
| **PH flops (#15+ ranking)** | 20% | Pivot to Reddit organic + email |

---

## TIMELINE (Locked)

### Week 1 (May 13-15): Build Sprint
- 48 hours of implementation (18 hrs/day)
- All 12 chunks complete
- MVP shipped to staging

### Week 2 (May 16-21): Design + Polish
- Frontend design pass (using uiux-design-system + Design.md + CDF)
- Landing page, ProductHunt deck, marketing copy
- QA + edge case testing
- Production credentials setup

### Week 3 (May 22-24): Launch
- ProductHunt launch (target: Top 5-10)
- Monitor metrics hourly (first 48h)
- Bug fixes + user feedback

### Week 4-5 (May 25-June 1): Stabilization
- Monitor uptime, errors, retention
- Quick bug fixes (critical only)
- Measure Month 1 success metrics

---

## SUCCESS CRITERIA (Month 1)

**Launch Metrics:**
- ✅ ProductHunt Top 5-10
- ✅ 200-300 Day 1-2 signups
- ✅ 5-8% free→Pro conversion
- ✅ 40-60 paid users Month 1
- ✅ $1K-1.6K MRR Month 1
- ✅ 70% creator aha rate
- ✅ 99.5% uptime
- ✅ k > 0.15 (viral coefficient)

**If Any Metric Misses:**
- PH #15+ → pivot to Reddit organic
- Conversion <3% → aha moment weak, reposition
- k <0.1 → switch to paid acquisition
- Startup adoption 0% → remove team features, add Month 2

---

## FILES & REFERENCES

| Document | Location | Purpose |
|----------|----------|---------|
| **PRD.md** | `/PRD.md` | Complete product spec |
| **IMPLEMENTATION_PLAN.md** | `/IMPLEMENTATION_PLAN.md` | 12 chunks, gates, time estimates |
| **CLAUDE.md** | This file | Architecture, decisions, commands |
| **SUPABASE_SETUP.md** | `/docs/SUPABASE_SETUP.md` | Database setup guide |
| **.env.local.example** | `/web/.env.local.example` | Environment variables template |
| **GitHub** | https://github.com/Hex-Tech-Lab/hex-yt-intel | PUBLIC repository |

---

## NEXT STEPS

**Immediate (Now):**
1. ✅ Chunk 1 complete (monorepo setup)
2. → Set up Supabase project credentials in .env.local
3. → Start Chunk 2 (Next.js setup)

**By End of Day 1 (May 14, ~08:45 UTC):**
- Chunks 1-6 complete
- Core value (synthesis) working
- All gates passing

**By End of Day 2 (May 15, ~02:45 UTC):**
- Chunks 7-10 complete
- All 11 features working
- Ready for design polish

**By End of Day 3 (May 15, ~14:45 UTC):**
- Chunks 11-12 complete
- Deployed to Vercel
- Live at hex-yt-intel.vercel.app

**Week 2 (May 16-21):**
- Design polish
- ProductHunt preparation
- Marketing materials

**Week 3 (May 22):**
- Launch on ProductHunt
- Monitor metrics
- Iterate based on feedback

---

**CLAUDE.md v2.0 — FINAL, LOCKED, PRODUCTION-READY**

*Master control file. Reference this for architecture, decisions, commands, escalation paths.*

*Next: Clock in for Chunk 2. CCW provides steering prompt. CC executes. Report when gate passes.*
