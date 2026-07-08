# Complete Workflow Inventory (Pre-MoR Stabilization)

**Purpose**: Ensure 100% of system workflows are accounted for, verified end-to-end, and tested for edge cases before MoR payment integration.

**Status**: 🔍 BEING VERIFIED

---

## Core User Workflows

### 1. **Analysis Creation & Streaming** (CRITICAL PATH)
**User journey**: Paste video URL → ingestion → stream analysis → completion → view results

**Paths**:
- Full analysis (has transcript)
- Partial analysis (no transcript, metadata-only)
- Interrupted analysis (connection drop mid-stream)
- Re-run analysis (force refresh)
- Concurrent analyses (multiple videos queued)

**Entry points**: 
- POST `/api/analyses` (create stub)
- Worker ingestion → POST `/api/analyses/persist` (chunks stream in)
- POST `/api/webhooks/validate` (finalize on stream end)
- POST `/api/webhooks/reaper` (QStash-driven cleanup of orphaned rows)

**Data consistency**:
- No hung streams (connection drop recovery)
- No orphaned `processing` rows (reaper sweeps)
- Dim-0 (executive digest) fires once on completion
- Quota charged atomically (outbox pattern)

**Edge cases**:
- URL already analyzed (auto-restore analysis + chat)
- Transcript-less video (metadata-only path)
- Stream timeout (interrupt + persist partial)
- Worker connection drop (httpConnSignal handler)
- Invalid video (404 from YouTube)

---

### 2. **Chat (Grounded Analysis)** (CRITICAL PATH)
**User journey**: Analysis → open chat → ask question → LLM response → history preserved

**Paths**:
- Grounded chat (analysis has markdown) → streams response with grounding
- Ungrounded chat (no transcript) → refuses with "no content" message
- Grounded but refused (IDOR attempt) → 404, no cross-user leakage
- Chat session persistence (reload page → history still there)
- Global chat (no single video, search across all user's analyses)

**Entry points**:
- POST/GET `/api/chat` (route to video or global scope)
- POST `/api/chat/conversations` (create thread)
- GET/POST `/api/chat/conversations/[id]` (update thread)
- GET `/api/chat/conversations/[id]/messages` (fetch history)
- POST `/api/chat/persist` (worker persists message after stream)

**Security**:
- Ownership check: conversation bound only to owned analysis (#126)
- Grounding gate: no stream if no usable markdown (#125)
- No jailbreak/identity probes (CHAT_PROTOCOL refusal)

**Edge cases**:
- Chat with no analysis bound → ungrounded mode
- Conversation orphaned (analysis deleted) → graceful error
- Cross-user IDOR attempt → 404
- Stale chat session (analysis re-run with new ID) → auto-switch thread

---

### 3. **Knowledge Graph Visualization**
**User journey**: Analysis completes → KG auto-renders → interact (zoom, pan, filter by weight)

**Paths**:
- Full KG (all entities + relations rendered)
- Partial KG (missing nodes/edges)
- Zoom-dependent labels (anti-clutter design)
- Node weight → size scaling

**Entry points**:
- GET `/api/analyses/[id]/graph` (KG data from analysis_payload)
- GET `/api/atlas/global-graph` (merged KG across all user's analyses)
- POST `/api/webhooks/embed` (vector embeddings for search integration)

**Data consistency**:
- Entity types correctly mapped (e.g., concept vs person)
- Node/edge counts match payload
- Relations bidirectional
- Weights normalized

**Edge cases**:
- Empty KG (no entities extracted)
- Single-node KG (only one concept)
- Very large KG (10k+ nodes) → performance
- Zoom extremes (fully zoomed in/out)
- Label collision (overlapping text)

---

### 4. **Word Cloud Visualization**
**User journey**: Analysis completes → word cloud renders with spiral layout → interact

**Paths**:
- Full word cloud (all terms rendered)
- Empty/collapsed state (container width < 50px)
- Density optimization (Archimedean spiral, boundary clamping)

**Entry points**:
- Component `WordCloud.tsx` (client-side from analysis_payload)

**Data consistency**:
- Font size proportional to weight
- No overlapping words
- All terms visible (collision-free layout)

**Edge cases**:
- Single word (only one concept/term)
- Very common word (100% weight dominates)
- Accordion collapsed → no width

---

### 5. **Mind Map Visualization**
**User journey**: Analysis completes → mind map renders with bezier connectors → interact

**Paths**:
- Full mind map (hierarchy rendered)
- Bezier connector paths (cubic-bezier curves)
- Per-node coordinates (layout algorithm)

**Entry points**:
- Component `MindMap.tsx` (client-side from analysis_payload)

**Data consistency**:
- Node positions computed correctly
- Connectors don't overlap unless necessary
- Hierarchy levels clear

**Edge cases**:
- Single-node hierarchy
- Deep nesting (5+ levels)
- Wide branching (20+ children per node)

---

### 6. **Export Workflow**
**User journey**: Analysis → click export → PDF/MD download

**Paths**:
- PDF export (full report, tier-gated)
  - Pro/Enterprise: all 11 dimensions + TOC
  - Free: executive summary only
- Markdown export (raw analysis_markdown)
- Failed export (partial analysis, no content)

**Entry points**:
- POST `/api/analyses/[id]/export` (render PDF via PDFKit)

**Data consistency**:
- PDF TOC accurate (matches dimensions)
- Font hierarchy applied (title > heading > body)
- Tier gates enforced (402 if free user requests full)

**Edge cases**:
- No markdown (partial analysis) → 500 gracefully
- Very long dimension content → pagination
- Special characters in title → filename sanitization

---

### 7. **Share/Public Workflow**
**User journey**: Owner → generate share link → share publicly → recipient → view analysis

**Paths**:
- Share token generation (30-day expiry)
- Public access to shared analysis
- Share link revocation (delete token)

**Entry points**:
- POST `/api/analyses/[id]/share` (generate token)
- GET `/app/share/[token]` (public view)

**Security**:
- Token expiry enforced
- No leakage of non-shared analyses
- Public view read-only (no modification)

**Edge cases**:
- Token expiry boundary (just before/after 30d)
- Shared analysis gets deleted → public link 404
- Multiple share links from same analysis

---

### 8. **History & Replay Workflow**
**User journey**: Dashboard → click history → see past analyses → select one → reload analysis

**Paths**:
- List all analyses for user (paginated)
- Filter by video (same video, multiple runs)
- Status indicators (complete, partial, failed, processing)
- Dimension completeness strip (green/orange/dashed)
- View count increment (race-safe RPC)

**Entry points**:
- GET `/api/analyses/route.ts` (list user's analyses)
- GET `/api/analyses/overview` (history overview with dimension strip)
- GET `/app/analyses/saved` (history page UI)
- Click on history item → GET `/api/analyses/[id]` → reload dashboard with that analysis

**Data consistency**:
- View counts accurate (atomic increment)
- Dimension status correct (matches completion)
- Dimension strip rendering matches actual dims

**Edge cases**:
- User with no analyses yet
- Very large history (1000+ analyses)
- Partial analysis in list (no markdown, show amber tier)
- Re-run same video (new analysis ID, separate entry)

---

### 9. **Search Workflow**
**User journey**: Dashboard/search page → query → semantic search across analyses → click result → view

**Paths**:
- Query embedding generation (OpenRouter)
- Vector similarity search (Upstash)
- Result ranking & enrichment (fetch full analysis)
- Result filtering (by video, by date, etc.)

**Entry points**:
- POST `/api/search` (semantic search + enrich results)

**Data consistency**:
- Search results own by requesting user only
- Result metadata accurate (title, videoId, excerpt)
- Similarity scores correct

**Edge cases**:
- No results (zero matches)
- Embedding generation fails (timeout)
- Result analysis was deleted (graceful null skip)
- Very common query (10k+ matches, paginate)

---

### 10. **Mobile Workflow**
**User journey**: All above workflows, but on mobile (iOS/Android browser)

**Paths**:
- Responsive layout (drawer nav instead of sidebar)
- Touch interaction (tap to open, swipe to close)
- Viewport constraints (no horizontal scroll)
- Chat input on mobile (keyboard handling)
- KG/Word Cloud zoom on mobile (pinch/double-tap)

**Entry points**:
- Responsive media queries trigger drawer nav
- DashboardLayout → MobileNav component

**Data consistency**:
- Same data as desktop (no mobile-specific caching)
- Responsiveness doesn't break data flow

**Edge cases**:
- Very small viewport (320px width)
- Portrait vs landscape (orientation change)
- Keyboard open (input shifts layout)
- Touch on KG (pinch zoom logic)

---

### 11. **Authentication & Session Workflow**
**User journey**: Landing page → sign in → OAuth flow → session persisted → dashboard

**Paths**:
- Google OAuth (new user / existing user)
- Session cookie storage
- Session persistence on page reload
- Sign out

**Entry points**:
- GET/POST `/api/auth/signin` (initiate OAuth)
- GET `/app/auth/callback` (OAuth return + session creation)
- GET `/app/auth/error` (auth error page)
- POST `/auth/signout` (destroy session, Supabase + Next Auth)

**Security**:
- No leakage of other users' sessions
- Session expiry enforced
- CSRF protection (NextAuth built-in)

**Edge cases**:
- Callback URL mismatch (Vercel preview vs prod)
- Session expiry mid-stream (chat/analysis interrupted)
- User deleted account (session still valid briefly)

---

### 12. **Quota & Rate-Limiting Workflow**
**User journey**: User continuously analyzed videos → quota check → hit limit → error message → upgrade or wait

**Paths**:
- Per-user quota enforcement (Upstash Redis Lua)
- Per-IP rate-limiting (abuse prevention)
- Quota deduction on analysis start
- Quota refund on analysis failure
- Tier-based limits (free: 5/month, pro: 100/month, etc.)

**Entry points**:
- `guardTraffic()` called by POST `/api/analyses` and other routes
- GET `/api/rate-limit-status` (client can check quota before submitting)
- POST `/api/analyses` rejects with 429 if quota exceeded

**Data consistency**:
- Quota counts accurate (no double-deduction)
- Refund logic works (atomic with outbox)
- Rate limit headers returned

**Edge cases**:
- User at exactly limit boundary
- Quota refund for interrupted analysis
- Concurrent requests hit limit race condition
- Free user → pro upgrade mid-month (quota reset/add)

---

### 13. **Billing & Subscription Workflow**
**User journey**: Free user → upgrade button → Stripe checkout → Paddle payment → subscription active

**Paths**:
- Free → Pro upgrade
- Pro → Enterprise upgrade
- Subscription cancellation
- Paddle payment processing (Egypt individual)
- Webhook from Paddle → update user tier

**Entry points**:
- GET `/app/billing` (billing page, upgrade button)
- POST `/api/billing/checkout` (initiate checkout)
- POST `/api/billing/webhook` (Paddle webhook)
- POST `/api/stripe/webhook` (legacy Stripe, if exists)

**Security**:
- User can only upgrade own subscription
- Webhook signature verification (Paddle HMAC)
- No cross-user subscription mixing

**Data consistency**:
- Tier updated correctly on webhook
- Usage/quota resets or adds correctly
- No race conditions in upgrade flow

**Edge cases**:
- Webhook retries (idempotent handling)
- Webhook received out-of-order
- User upgrades mid-month (proration calc)
- Subscription already exists (duplicate upgrade attempt)
- Paddle payment timeout (user sees "pending")

---

### 14. **Admin/Analytics Workflow**
**User journey**: Admin → `/admin/dashboards` → view stats → monitor system health

**Paths**:
- System stats (total users, total analyses, active streams)
- Per-user stats (usage, quota, tier)
- Error rates (failed analyses, stream interrupts)
- Performance metrics (TTFT, latency, costs)

**Entry points**:
- GET `/app/admin/dashboards` (admin page)
- GET `/api/admin/stats` (fetch stats)

**Security**:
- Only admins can access (role check)

**Edge cases**:
- No data yet (new system)
- Large dataset (aggregation performance)
- Real-time updates (WebSocket vs polling)

---

### 15. **Webhook & Worker Integration Workflows**

#### 15a. **Analysis Stream Ingestion** (Worker → Server)
**Path**: Worker receives stream → chunks dimensions → POST `/api/analyses/persist` (chunks) → POST `/api/webhooks/validate` (finalize)

**Security**: HMAC signature verification (stream-token)

**Edge cases**:
- Out-of-order chunks received
- Chunk loss (never arrives)
- Duplicate chunks (idempotent handling)

#### 15b. **Stuck Analysis Reaper** (QStash → Server)
**Path**: QStash cron → POST `/api/webhooks/reaper` → finalize orphaned `processing` rows

**Entry points**: POST `/api/webhooks/reaper`

**Edge cases**:
- No stuck analyses (empty sweep)
- Analysis finishes right before reaper runs (idempotent)

#### 15c. **Vector Embedding** (Worker → Server)
**Path**: Analysis finishes → embed content → POST `/api/webhooks/embed` → Upstash vector index

**Entry points**: POST `/api/webhooks/embed`

**Edge cases**:
- Embedding generation fails (timeout)
- Vector index unavailable (graceful fallback)

#### 15d. **Dream Sequence** (???)
**Path**: Unknown (need to investigate POST `/api/webhooks/dream-sequence`)

---

### 16. **Dimension-0 (Executive Digest) Workflow**
**User journey**: Analysis completes and user views dashboard → POST `/api/analyses/digest` → Dim-0 generated (once, cached, idempotent)

**Paths**:
- First view of analysis → generate digest
- Subsequent views → return cached digest
- Force regenerate (admin/debug)
- No content → refuse (409, no model call)

**Entry points**:
- POST `/api/analyses/digest` (triggered by DashboardContainer effect)
- Digest included in GET `/api/analyses/[id]` response

**Data consistency**:
- Digest stored in `executive_digest jsonb`
- Idempotent (no duplicate generations)
- Digest structure valid (Snapshot + Takeaways + Overview)

**Edge cases**:
- Partial analysis (no content) → refuse
- Digest parsing fails → error (no persist)
- All models fail (cascade exhausted) → 502

---

### 17. **Dimension UI Interactions** (Dashboard Drawer, Accordion Panels)
**User journey**: Click dimension in grid → drawer opens → read full content → click another dim → drawer updates

**Paths**:
- Dimension drawer (sidebar, 480px → 390px width)
- Accordion-based dimension grid (collapse/expand)
- Detail view in SelectedDimensionReadout
- Spacing/layout (padding, margins)

**Entry points**:
- Click on dimension card → setSelectedDimension()
- Drawer opens/closes without modal overlay

**Data consistency**:
- Dimension content matches payload
- Layout doesn't overlap (drawer + main panel)

**Edge cases**:
- Very long dimension content (scroll in drawer)
- Mobile drawer width (responsive)
- Double-click trap (inert attribute removed)

---

### 18. **Error Handling & Graceful Degradation Workflows**
**Paths**:
- Network error (connection drop)
- LLM timeout (streaming interrupted)
- Quota exceeded (429 response)
- Invalid video (404 from YouTube)
- Analysis failed (validation error)
- Chat message failed (LLM cascade exhausted)

**Entry points**:
- All routes with error handling
- Worker error handling (try/catch + persist)
- Client error handling (UI messages)

**Data consistency**:
- No partial commits on error
- User informed (error message shown)
- No silent failures (logged to Sentry)

**Edge cases**:
- Error occurs mid-transaction
- Retry logic (exponential backoff)
- Circuit breaker (stop retrying after N failures)

---

## Verification Checklist Template

For each workflow:
- [ ] Happy path (everything works)
- [ ] Happy path on mobile (responsive)
- [ ] Edge case 1 (list specific)
- [ ] Edge case 2
- [ ] Edge case 3
- [ ] Data consistency (no orphaned rows, dual-write normalized)
- [ ] Security (ownership checks, auth gates)
- [ ] Error messages (user informed)
- [ ] Performance baseline (TTFT, latency measured)

---

## Questions to Answer Before Stabilization Pass

1. **What is "dream-sequence" webhook?** (POST `/api/webhooks/dream-sequence`)
2. **What is "PDF" route?** (GET `/api/pdf` — separate from export?)
3. **How does global-graph differ from per-analysis graph?** (POST `/api/atlas/global-graph`)
4. **Is there an "analysis relations" workflow** separate from KG? (GET `/api/analyses/[id]/relations`)
5. **Are there any background jobs beyond reaper + embed + validation?** (QStash tasks?)
6. **How is the "Dimension Reordering" workflow (#34) supposed to work?** (Not seen in routes)
7. **How is the "Transcript Ephemeral Store" (#36-39) supposed to work?** (Not yet built)
8. **How does "time-seek UI" (#39) integrate with chat/dimension markers?** (TimestampLink was dropped)

---

**Next Step**: Clarify the unknowns above, then we can design the full stabilization + verification plan with coupled minor tasks per workflow.
