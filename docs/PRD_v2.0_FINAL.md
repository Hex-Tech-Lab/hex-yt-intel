# HEX-YT-INTEL: PRODUCT REQUIREMENTS DOCUMENT v2.0
## From Claude Skill to Commercial SaaS | Council-Validated | Market-Ready

**Date:** May 13, 2026  
**Status:** FINAL (locked, ready for implementation)  
**Council Confidence:** 82/100  
**Pricing:** Free / $9-19 / $29 / $49 (no Enterprise in MVP)  
**Timeline:** 48-hour sprint (May 13-15) → Design polish (May 16-21) → Launch May 22  

---

## EXECUTIVE SUMMARY

**Evolution:** From Claude Skill (manual workflow) to Commercial SaaS (automated, team-enabled, monetized)

**What:** YouTube content synthesis engine with persistent knowledge graph, semantic search, and team collaboration

**Why:** 3 personas (Creators, Makers, Consultants) need synthesis + search + team features. Skill proves concept; SaaS scales it.

**How:** 4-tier freemium pricing with per-user private repos + shareable team analyses

**Market Validation:** Council 82% conviction, $1-1.6K MRR Month 1 achievable, 3 primary personas

---

## THE PIVOT: Skill → SaaS

### Phase 1: Claude Skill (Complete ✅)
- Cloudflare Worker fetches YouTube metadata + transcript
- Skill generates UCIS v3.2 prompt (16 sections)
- User manually pastes into Claude
- Status: Live, tested, public repo

### Phase 2: Commercial SaaS (In Progress 🔨)
- Web app (Next.js) replaces manual workflow
- URL → instant synthesis (no copy/paste)
- Persistent knowledge graph (searchable, shareable)
- Team collaboration (invite members, mark as team)
- Monetization (4 tiers)
- Optional: AI chat with usage windows (post-MVP)

**Why This Matters:**
- Skill = validation (proof of market demand)
- SaaS = repeatable revenue + defensible moat
- Timing: Market hot (competitors at $20-29/mo; we're faster + cheaper)

---

## PERSONAS (Market-Validated)

### Persona 1: Content Creator (PRIMARY, 88/100)
- **Archetype:** 50K YouTube subs, $50-100K/year revenue
- **Pain:** Watches 50 competitor videos/month; disorganized; needs competitive patterns in 5 minutes
- **Distribution:** YouTube, TikTok, Twitter, ProductHunt, Creator Discord
- **WTP:** $9-15/mo (business expense, low friction)
- **Success Metric:** Creates 2+ syntheses Week 1

### Persona 2: Indie Maker (CO-PRIMARY, 81/100)
- **Archetype:** Solo founder, $60K ARR, bootstrapped
- **Pain:** Watches 15 founder talks/month; loses insights; needs searchable repository
- **Distribution:** Twitter, Indie Hackers, Slack, Hacker News
- **WTP:** $9-29/mo (high time-value)
- **Success Metric:** Uses semantic search 3+ times Week 2

### Persona 3: Consultant/Analyst (TIER 2, 75/100)
- **Archetype:** Independent consultant, $200K+ ARR, team-optional
- **Pain:** Synthesizes industry trends for client deliverables; needs to scale with team
- **Distribution:** LinkedIn, cold email, consulting networks
- **WTP:** $49-99/mo (business expense, clear ROI)
- **Success Metric:** Invites 1+ team member
- **Launch Timing:** Month 2+ (after Creators/Makers validation)

---

## FEATURES (LOCKED SCOPE)

### P0: Foundational (Non-Negotiable)
1. YouTube URL input + metadata fetch (Cloudflare Worker integration)
2. Transcript extraction (auto-captions fallback)
3. UCIS v3.2 synthesis (16 sections, Claude Sonnet 4.5)
4. User authentication (Google OAuth + NextAuth.js)
5. Free tier (3 syntheses/month)

### P1: Polish (MVP-Complete, High Priority)
6. Semantic search (pgvector, search user's syntheses)
7. Personal + Team repos (mark as "personal" or "team")
8. Invite team members (email invitations, roles: viewer/editor)
9. PDF export (formatted download)
10. Public sharing (read-only shareable links)
11. Pro+ tier ($9-19, $29, $49/mo with features)

### P2: Deferred to Month 2+
- Advanced API (webhooks, batch uploads)
- Integrations (Obsidian, Notion, Slack, Discord)
- Team analytics dashboard
- SSO (enterprise auth)
- AI chat with usage windows (if $19 tier adopted)

---

## PRICING MODEL (4 TIERS)

### FREE
```
$0/month
━━━━━━━━━━━━━━━━━━
✓ 3 syntheses/month
✓ Personal repo only
✓ Community support
✗ Semantic search
✗ Team collaboration
✗ PDF export
✗ Sharing
```
**Target:** Conversion funnel, aha testing. Goal: 5-8% convert to paid in Week 1.

---

### PRO
```
MONTHLY              ANNUAL (Save ~25%)
  $9/mo        or    $81/year ~~$108~~
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Unlimited syntheses
✓ Personal repo
✓ Semantic search (your syntheses)
✓ PDF export
✓ Public sharing
✓ 1-year retention (vs 30-day free)
✓ API access (100 req/day)
✓ Email support
✗ Team collaboration
```
**Target:** 60% of paying users. ARPU: $9/mo ($6.75/mo annual).

**Decision:** $9/mo as base to maximize adoption. Optional: add $19 tier with AI chat + usage windows (5-hour limit/month) if demand signals validate. Keep MVP at $9.

---

### STARTUP (Small Team)
```
MONTHLY              ANNUAL (Save ~28%)
 $19/mo        or   $163/year ~~$228~~
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Everything in Pro
✓ Team repo (up to 5 members)
✓ Invite & manage team
✓ Team-shareable syntheses
✓ Private personal repo (team can't see)
✓ Priority support (4-hr response)
✓ Shared workspace settings
✗ Integrations
✗ Advanced API
```
**Target:** 25% of paying users (co-founders, research groups, study circles). ARPU: $19/mo ($13.68 annual).

**Positioning:** "Collaborate without sharing personal research."

---

### SME/CATALYST (Professional Team)
```
MONTHLY              ANNUAL (Save ~30%)
 $49/mo        or   $411/year ~~$588~~
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Everything in Startup
✓ Team repo (up to 10 members)
✓ Advanced API (webhooks, batch)
✓ Integrations (Obsidian, Notion, Slack, Discord)
✓ Team analytics dashboard
✓ Priority support (1-hr response)
✓ Custom branding (team logo)
✓ Advanced export (team briefs)
✗ SSO (enterprise-only, Phase 2)
```
**Target:** 12% of paying users (consulting teams, research firms, agencies). ARPU: $49/mo ($34.32 annual).

**Positioning:** "Enterprise-grade team research without enterprise complexity."

---

### NO ENTERPRISE IN MVP
- Skip for now. Add if customers request (Year 2+).
- Reduces scope, focuses on validated personas.

---

## TECHNICAL ARCHITECTURE

### Stack (FROZEN)
| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 + React 19 + TypeScript strict |
| API | Next.js API routes |
| Database | Supabase (PostgreSQL) |
| Vector DB | pgvector (native Supabase) |
| Auth | NextAuth.js v5 + Google OAuth |
| Worker | Cloudflare (existing: yt-intel.hex-tech-lab.workers.dev) |
| LLM | Claude Sonnet 4.5 (synthesis + embeddings) |
| Payments | Stripe (subscriptions) |
| Caching | Upstash Redis (rate limiting, sessions) |
| Observability | Sentry (error tracking, $10/mo) |
| Hosting | Vercel (Next.js) + Supabase (DB) |
| Styling | Tailwind + shadcn/ui |

### Data Model (Team-Enabled)
```sql
users
├── id, email, google_id, tier (free, pro, startup, sme)
├── stripe_customer_id, analyses_used (counter)
└── created_at, updated_at

analyses
├── id, user_id, team_id (nullable, FK → teams)
├── video_id, title, channel_name, transcript
├── synthesis (UCIS 16-section markdown)
├── synthesis_embedding (vector 1536, pgvector)
├── repo_type (enum: personal, team) ← Personal/Team marker
├── shared_token (nullable, for public links)
├── shared_expires_at (optional expiry)
└── created_at, updated_at

teams
├── id, name, owner_id, member_count (max 5 or 10 by tier)
└── created_at, updated_at

team_members
├── id, team_id, user_id, role (owner, editor, viewer)
└── joined_at

usage_logs
├── id, user_id, action, metadata, created_at

stripe_events
├── id, stripe_event_id, event_type, payload, created_at
```

**RLS Policies:**
- User reads own syntheses (personal + team)
- User reads team syntheses (only if member)
- Team members cannot read each other's personal syntheses
- Admin override for support

---

## SUCCESS METRICS (Month 1)

| Metric | Target | If Miss |
|--------|--------|---------|
| ProductHunt rank | Top 5-10 | If #15+: pivot to Reddit organic |
| Day 1-2 signups | 200-300 | Baseline interest |
| Free→Pro conversion | 5-8% | If <3%: aha moment weak, pivot messaging |
| Paid users (Month 1) | 40-60 | Revenue checkpoint |
| MRR (Month 1) | $1K-1.6K | Profitability gate |
| Creator aha rate | 70% | If <50%: reposition for makers |
| Startup tier adoption | 2-3 users | Team feature interest |
| API uptime | 99.5% | If <99%: scale infrastructure |
| Viral coeff (k) | >0.15 | If <0.1: switch to paid acq |

---

## RISKS & MITIGATIONS

| Risk | Probability | Mitigation |
|------|-------------|-----------|
| **Virality collapse (k < 0.1)** | 35% | Monitor Week 2-3; switch to paid acq if needed |
| **Solo founder scaling (Week 3-4)** | 35% | Hire freelance engineer by Week 2 |
| **Positioning wrong (creators don't want synthesis)** | 25% | User interviews Week 1; A/B test landing page |
| **Notion adds synthesis (Month 6)** | 40% | Build Notion integration; focus on team features |
| **pgvector scaling (10K+ analyses)** | 15% | Monitor query latency; plan Pinecone migration |
| **Stripe webhook failures** | 10% | Test in sandbox; implement re-delivery + reconciliation |
| **PH flops (#15+ ranking)** | 20% | Pivot to Reddit + email organic |

---

## OMISSIONS & BLIND SPOTS (Document Here)

### Known Omissions (Intentional)
- [ ] Enterprise tier (Year 2+)
- [ ] SSO/SAML (Year 2+)
- [ ] Integrations (Phase 2, not MVP)
- [ ] AI chat (Optional, if $19 tier adopted; needs usage windows)
- [ ] Knowledge graph (Phase 2)
- [ ] Mobile app (Phase 3)
- [ ] Audio/video processing (Phase 3)

### Blind Spots (Risk Areas)
- [ ] **Team feature adoption:** Startup tier unvalidated. May have 0% adoption. Fallback: remove from MVP, add Month 2.
- [ ] **Pricing sweet spot:** Is $19 Startup too high? $9 Pro too cheap? A/B test ready (contingency: lower Startup to $14.99 if <3% conversion).
- [ ] **Creator vs. Maker GTM:** One landing page for both. Risks message dilution. Contingency: split landing pages Week 2 if conversion <5%.
- [ ] **Cloudflare Worker reliability:** Inherited from Skill phase. If metadata fetching fails, entire MVP stalls. Fallback: YouTube API directly (but adds cost).
- [ ] **Claude API cost scaling:** Assumes $0.03-0.10 per synthesis. If usage exceeds forecast, burn rate increases. Monitoring needed.
- [ ] **Stripe webhook delivery:** Testnet ≠ production. May miss payment events in live. Contingency: daily reconciliation query.
- [ ] **Database backups:** Supabase auto-backup. What if restore needed? Contingency: weekly manual exports to S3.
- [ ] **Rate limiting enforcement:** Upstash Redis may fail silently. Test manually. Fallback: in-memory rate limiter if Redis down.

---

## CONSTRAINTS & SCOPE LOCK

### What's LOCKED IN (Not Changing)
- ✅ 4 tiers (Free, Pro $9, Startup $19, SME/Catalyst $49)
- ✅ 11 P0+P1 features (all in MVP)
- ✅ Freemium model (not paid-only)
- ✅ UCIS v3.2 synthesis (16 sections)
- ✅ pgvector semantic search
- ✅ Team collaboration (personal + team repos)
- ✅ Stripe billing

### What WILL Break the Sprint
- 🚫 Adding 5th tier (Enterprise)
- 🚫 Changing pricing mid-sprint
- 🚫 Adding new personas (Researchers deferred to Month 2)
- 🚫 Integrations (Phase 2)
- 🚫 AI chat (decision needed; see below)

### AI Chat Decision (Optional, Deferred)
**Current:** Not in MVP.  
**Option A:** Add to $19 Startup tier (e.g., "Ask Claude about your syntheses"; usage window: 5-hour limit/month like Claude subscription).  
**Option B:** Add to Month 2 as separate feature.  
**Recommendation:** Option B (MVP first, validate syntheses, then add chat). If customer demand is clear by Week 3, add it Week 4-5.

---

## ROLLOUT PLAN

### Week 1 (May 13-15): Build Sprint
- Day 1: Monorepo + Database + Auth + Metadata API (Chunks 1-5)
- Day 2: Synthesis + Search + Frontend (Chunks 6-8)
- Day 3: Stripe + Observability + Deploy (Chunks 9-12)
- All 11 features working, all gates passing

### Week 2 (May 16-21): Design + Polish
- Frontend design pass (using uiux-design-system + Design.md skill + CDF)
- Marketing materials (landing page, ProductHunt deck, Twitter copy)
- Final QA + edge case testing
- Production credential setup (Stripe live, domain, SSL)

### Week 3 (May 22-24): Launch
- ProductHunt launch (target: Top 5-10)
- Monitor metrics hourly (first 48h)
- Respond to feedback, publish updates
- Post-launch iteration

### Week 4-5 (May 25-June 1): Stabilization
- Monitor uptime, errors, user retention
- Quick bug fixes (critical only)
- Measure success metrics vs. targets
- Plan Month 2 features (Phase 2)

---

## LAUNCH GATES

**LAUNCH if:**
- ✅ All 11 features working
- ✅ All verification gates passing
- ✅ TypeScript strict clean
- ✅ Zero critical bugs
- ✅ 99%+ uptime in staging (24h)
- ✅ Stripe webhook tested (sandbox + live mode)
- ✅ Sentry integration live

**DELAY 48 hours if:**
- ❌ Any P0 feature broken
- ❌ <99% uptime
- ❌ Stripe not working
- ❌ Security issue found

**PIVOT (Month 2) if:**
- Conversion <3% → test maker messaging
- k <0.1 → switch to paid acquisition
- PH #15+ → pivot to Reddit organic
- Startup adoption 0% → remove team features, add Month 2

---

## FILES & REFERENCES

- **CLAUDE.md** — Master control (architecture, decisions, commands)
- **IMPLEMENTATION_PLAN.md** — 12 chunks, time estimates, gates
- **SUPABASE_SETUP.md** — Database setup guide
- **GitHub** — https://github.com/Hex-Tech-Lab/hex-yt-intel (PUBLIC)

---

**PRD v2.0 — FINAL, LOCKED, READY FOR IMPLEMENTATION**
