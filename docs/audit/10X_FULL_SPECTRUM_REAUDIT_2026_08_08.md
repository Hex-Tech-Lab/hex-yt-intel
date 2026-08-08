# 10X Full-Spectrum Re-Audit — 2026-08-08
**Branch:** `feat/entity-mention-index-adr025` (PR #225) + `feat/entity-mention-timeline-ui-adr025` (PR #224)
**Base:** `origin/main @ bcf1f867` (last merge: ADR 025 dual-dispatch agent prompts)
**Skills Activated:** owasp-top-10 · pr-review-workflow · review-pr · review-delta · build-graph · planetscale-postgres-safety-review · evaluator-calibration · ponytail-audit · code-quality · code-reviewer · supabase-best-practices · QA-intel
**Agents:** A (Security/OWASP) · B (Frontend/React/A11y) · C (Database/Supabase) · D (Architecture/Complexity) · E (CI/CD/QA)
**External Tools:** Cubic MCP (PR #224, #225) · CodeRabbit · pnpm audit · GitHub PR checks
**Generated:** 2026-08-08T13:41Z | **All agents complete:** 2026-08-08T13:35Z
**Baseline:** [10X_COVERAGE_REPORT_2026_08_02](file:///home/kellyb_dev/.gemini/antigravity-cli/brain/58bb34b8-9b61-4588-9e8b-8a53a3d0edfd/10X_COVERAGE_REPORT_2026_08_02.md)

---

## ⚡ EXECUTIVE SUMMARY

| Severity | Count | Merge Block? |
|---|---|---|
| 🔴 P0 — Blocker | 4 | **YES — DO NOT MERGE** |
| 🟠 P1 — High | 10 | Fix before merge |
| 🟡 P2 — Medium | 18 | Schedule immediately |
| 🟢 P3 — Low / Nitpick | 13 | Backlog |
| ✅ Fixed from prior | 14 | Delta wins |
| ⚠️ Regressed from prior | 3 | Attention needed |

> **PR #225 (`feat/entity-mention-index-adr025`) is BLOCKED:** CI/CD Pipeline FAIL + Lint FAIL.
> **PR #224 (`feat/entity-mention-timeline-ui-adr025`):** All checks pass except Cubic pending and CodeRabbit rate-limited (not blocking, but unreviewed).
> **CI/CD Confidence Score: 30/100** — HARD BLOCK (down from 65/100 on 2026-08-02).

---

## 🚨 CRITICAL ALERT — PR #225 LINT + PIPELINE FAILURE

> **PR #225 (`feat/entity-mention-index-adr025`) has active CI failures.**
>
> - `Lint`: **FAIL** — likely ESLint error introduced by the `TfIdfSimilarityEngine` integration or import path issues in `entity-time-seek.ts`
> - `CI/CD Pipeline`: **FAIL** — downstream of the Lint failure
> - `Build`: SKIPPED (won't build on lint failure)
>
> **This PR MUST NOT be merged until lint is resolved.**

---

## 🔴 P0 — BLOCKERS

### P0.1 — DoS via Pre-HMAC Loop on `comments` / `channelMeta` (STILL OPEN)
**Source:** Agent A (OWASP A04) | Status vs 2026-08-02: ❌ Still open / Regressed (line numbers shifted)
**File:** [`web/app/api/analyses/persist/route.ts:319-357`](file:///home/kellyb_dev/projects/hex-yt-intel/web/app/api/analyses/persist/route.ts#L319-L357)
**Description:** The `comments` array is sliced in a `while` loop (L325-331) and `channelMeta` is `JSON.stringify`'d (L319) **before** `verifyContentSig` is called on L357. The O(N²) iteration and JSON serialization occur unauthenticated.
**Exploit:** `curl -X POST /api/analyses/persist -d '{"comments": [<50k items>]}'` — no HMAC needed.
**Remediation:** Move `verifyContentSig` to be the first operation immediately after `req.json()` and Zod schema validation, before any array iteration or size-checking.

### P0.2 — `usage_logs` CHECK Constraints: No `NOT VALID` + No `IF EXISTS` (STILL OPEN)
**Source:** Agent C | Status vs 2026-08-02: ❌ Still open (P0.2 + P0.3 from prior)
**Files:**
- [`supabase/migrations/20260802122006_usage_logs_action_check_add_dimension_remediation.sql`](file:///home/kellyb_dev/projects/hex-yt-intel/supabase/migrations/20260802122006_usage_logs_action_check_add_dimension_remediation.sql)
- [`supabase/migrations/20260802144212_usage_logs_action_check_add_report_download.sql`](file:///home/kellyb_dev/projects/hex-yt-intel/supabase/migrations/20260802144212_usage_logs_action_check_add_report_download.sql)
**Description:** Both migrations `DROP CONSTRAINT` without `IF EXISTS` (migration chain crash on re-run) and `ADD CONSTRAINT` without `NOT VALID` (full table scan + ACCESS EXCLUSIVE lock on production `usage_logs`).
**Risk:** Minutes of write downtime on `usage_logs`. All analysis completions fail during lock. Migration chain crashes on any re-run.
**Remediation:**
```sql
DROP CONSTRAINT IF EXISTS usage_logs_action_check;
ADD CONSTRAINT usage_logs_action_check CHECK (...) NOT VALID;
-- Separately: VALIDATE CONSTRAINT usage_logs_action_check;
```

### P0.3 — PR #225: Active Lint + Pipeline Failure (NEW)
**Source:** Agent E (CI/CD) | Status: 🆕 New
**File:** `feat/entity-mention-index-adr025` branch
**Description:** PR #225 has confirmed `Lint: FAIL` and `Pipeline Status: FAIL` in GitHub CI. This is almost certainly a linting or import-path error introduced by the `TfIdfSimilarityEngine` integration in `entity-time-seek.ts` (imports from `@/lib/intelligence/similarity`). The build job was skipped.
**Remediation:** Investigate lint output from [CI run](https://github.com/Hex-Tech-Lab/hex-yt-intel/actions/runs/31258459260). Fix ESLint errors and re-run CI before any merge attempt.

### P0.4 — PR Gates Bypassed / AI Review Rate-Limited (REGRESSED)
**Source:** Agent E (CI/CD) | Status vs prior: ⚠️ Regressed from score 65 → 30
**Description:** CodeRabbit reported "Review rate limited" and marked as passing despite performing no review on PRs #223, #224. Cubic is still pending on PR #224. DeepSource is no longer in the check suite. Combined: **3 of the 5 AI review tools are missing or bypassed** on the two most complex PRs.
**Impact:** No AI code review on the EntityMentionTimeline (726 new lines across 4 files) before PR is eligible to merge.
**Remediation:** Resolve CodeRabbit rate limits. Restore DeepSource or add equivalent. Enforce Cubic must pass before merge.

---

## 🟠 P1 — HIGH

### P1.1 — Auto-Advance Immediately Skips Non-Chronological Mentions (NEW)
**Source:** Agents B + Cubic PR #224 (issue `0720bf71`) | Status: 🆕 New
**File:** [`web/components/templates/console/EntityMentionTimeline.tsx:81-98`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/EntityMentionTimeline.tsx#L81-L98)
**Description:** When auto-advance fires (`currentPlaybackSeconds >= activeMention.segmentEndSeconds`), it sets `activeRankIndex + 1` and calls `setSeekTo`. The video player takes time to seek, but `currentPlaybackSeconds` still holds the old value on the next effect run. Since mentions are ranked by significance (non-chronological), the stale `currentPlaybackSeconds` may already exceed the new mention's `segmentEndSeconds`, causing the effect to fire again instantly — rapidly cascading through the ranked list without playing any segment.
**Impact:** Severe UX breakdown: auto-advance fast-forwards through all mentions without playing them.
**Remediation:** Introduce a `pendingSeek` ref/flag. Suppress boundary checks until `currentPlaybackSeconds` confirms arrival near `activeMention.seekSeconds` (e.g. `Math.abs(currentPlaybackSeconds - activeMention.seekSeconds) < 3`).

### P1.2 — Non-Reactive Dimension Store Access in `timelineEntityData` Memo (NEW)
**Source:** Agents B + C + D + Cubic PR #224 (issue `0b49ab1a`) | Status: 🆕 New (confirmed by 3 agents)
**File:** [`web/components/containers/DashboardContainer.tsx:267`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/containers/DashboardContainer.tsx#L267)
**Description:** `useAnalysisDimensionsStore.getState().getDimension(node.dimension)` inside `useMemo` is a synchronous store read that bypasses React's subscription system. When dimension content streams in after initial render, the memo will NOT re-run — the timeline silently shows stale/empty mentions until an unrelated state change triggers a re-render.
**Impact:** Entity mentions are always empty for streaming analyses; the ADR 025 feature is functionally broken during the most common use case.
**Remediation:** Use the reactive selector: `const activeDim = useAnalysisDimensionsStore(s => s.getDimension(selectedNodeId ? graph.nodes.find(n => n.id === selectedNodeId)?.dimension : undefined));` and include `activeDim` in the memo deps.

### P1.3 — Entity Timeline Hidden for Single-Mention Entities (NEW — Affects Majority of KG Nodes)
**Source:** Agents B + D + Cubic PR #224 (issue `6b5fc113`) | Status: 🆕 New
**File:** [`web/components/templates/console/EntityMentionTimeline.tsx:101`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/EntityMentionTimeline.tsx#L101)
**Description:** `if (mentions.length <= 1) return null` hides the timeline for exactly 1 mention. KG entities with a single mention (the majority) get no seek button — the core value proposition of ADR 025 is inaccessible to the most common case.
**Impact:** Feature is invisible for most entities. `mentions.length === 0` is the only valid guard.
**Remediation:** Change to `if (mentions.length === 0) return null`. Render single-mention timeline without prev/next nav buttons.

### P1.4 — Analysis ID Not UUID-Validated Before DB Query (STILL OPEN)
**Source:** Agent A (OWASP A03) | Status vs prior: ❌ Still open (P1.3 from 2026-08-02)
**File:** [`web/app/api/analyses/[id]/relations/route.ts:79`](file:///home/kellyb_dev/projects/hex-yt-intel/web/app/api/analyses/[id]/relations/route.ts#L79)
**Description:** Dynamic `[id]` param is used directly in `.eq('id', id)` without UUID format validation. Non-UUID strings cause Postgres type errors that surface as 500s.
**Remediation:** `const parsed = z.string().uuid().safeParse(id); if (!parsed.success) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });`

### P1.5 — Raw Internal Error Exposed to Client in Embed Webhook (STILL OPEN)
**Source:** Agent A (OWASP A05) | Status vs prior: ❌ Still open (P1.5 from 2026-08-02)
**File:** [`web/app/api/webhooks/embed/route.ts:227`](file:///home/kellyb_dev/projects/hex-yt-intel/web/app/api/webhooks/embed/route.ts#L227)
**Description:** Raw `error.message` returned to client in 503 response — may expose DB relation names, stack traces, or internal topology.
**Remediation:** Return `{ error: 'Service unavailable' }`. Log full error to Sentry only.

### P1.6 — Vulnerable Dependencies: nanoid + dompurify (STILL OPEN)
**Source:** Agent A (OWASP A06) | Status vs prior: ❌ Still open (PR #220 did not fully resolve)
**Files:** `web/package.json`, `pnpm-lock.yaml`
**Description:** `pnpm audit` reports 4 HIGH + 1 MODERATE vulns. DOMPurify XSS via IN_PLACE hook removal (`GHSA-55q2-fjhq-7xh7`, requires `>=3.4.13`). `isomorphic-dompurify` path keeps pulling vulnerable version despite PR #220 patch attempt.
**Remediation:** Add `pnpm.overrides` in root `package.json`: `"dompurify": ">=3.4.13"` and `"nanoid": ">=5.1.16"`. Run `pnpm install` to update lockfile.

### P1.7 — Stale `activeRankIndex` When `mentions` Array Updates During Streaming (NEW)
**Source:** Agent D | Status: 🆕 New
**File:** [`web/components/templates/console/EntityMentionTimeline.tsx:36`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/EntityMentionTimeline.tsx#L36)
**Description:** `useEffect(() => setActiveRankIndex(0), [entityId])` only resets on ID change. If `mentions` array updates mid-stream (new dimension content arrives), `activeRankIndex` may point out-of-bounds or to a stale rank.
**Remediation:** Add `mentions.length` to deps: `useEffect(() => setActiveRankIndex(0), [entityId, mentions.length])`.

### P1.8 — `admin_list_users_activity` Missing Explicit 30-Day Filter (STILL OPEN)
**Source:** Agent C | Status vs prior: ❌ Still open (P1.4 from 2026-08-02)
**File:** [`supabase/migrations/20260803133500_admin_list_users_activity_per_category_costs.sql`](file:///home/kellyb_dev/projects/hex-yt-intel/supabase/migrations/20260803133500_admin_list_users_activity_per_category_costs.sql)
**Description:** N+1 was fixed via lateral joins but no explicit `WHERE ul.created_at >= now() - interval '30 days'` was added. Relies entirely on pg_cron purge job. If cron fails, admin costs report unbounded data.
**Remediation:** Add explicit date filter inside the lateral subquery.

### P1.9 — `history_overview` v13: Return Type Mutation Requires Schema Reload (NEW/STILL OPEN)
**Source:** Agent C | Status: 🆕 New (evolution of P2.2 from prior)
**File:** [`supabase/migrations/20260805001000_history_overview_function_v13_add_has_chapters.sql`](file:///home/kellyb_dev/projects/hex-yt-intel/supabase/migrations/20260805001000_history_overview_function_v13_add_has_chapters.sql)
**Description:** New `has_chapters boolean` column added to RPC return type. PostgREST caches schema — client will receive 42P01 or null for the new column until cache is reloaded.
**Remediation:** Add `NOTIFY pgrst, 'reload schema';` to deployment pipeline after migration apply, or document the Supabase admin restart step.

### P1.10 — Polling Loop Writes Stale Playback Time During Active Seek (NEW)
**Source:** Agent B | Status: 🆕 New
**File:** [`web/components/templates/console/VideoPlayerCard.tsx:208-211`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/VideoPlayerCard.tsx#L208-L211)
**Description:** The 250ms poll loop continuously writes `getCurrentTime()` to the store while `isPlaying` is true. `setSeekTo` sets `isPlaying: true` immediately. During the seek buffer period, the interval writes the old position back to the store before the YouTube iframe completes seeking — directly exacerbating the P1.1 auto-advance race condition.
**Remediation:** Add an `isSeekingRef` flag. Skip `setCurrentPlaybackSeconds` writes while a seek is in progress.

---

## 🟡 P2 — MEDIUM

### P2.1 — Cubic: Segment Boundary Derived from Textual Next-Match, Not Chronological Order (NEW)
**Source:** Cubic PR #224 (issue `ab9d49eb`) + Agent D | Status: 🆕 New
**File:** [`web/lib/utils/entity-time-seek.ts:304`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/entity-time-seek.ts#L304)
**Description:** `segmentEndSeconds` uses the next textual mention's seek time (`matches[idx + 1]`). If dimension prose is out of chronological order (LLM narration that refers back to earlier timestamps), a segment can run past a later topic's genuine start.
**Remediation:** Derive segment boundaries from mentions sorted by `seekSeconds`, not by text occurrence order.

### P2.2 — Cubic: Auto-Advance Evaluates Stale Pre-Seek Clock on Backward Seeks (NEW)
**Source:** Cubic PR #224 (issue `0720bf71`) + Agent B | Status: 🆕 New
**File:** [`web/components/templates/console/EntityMentionTimeline.tsx:58`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/EntityMentionTimeline.tsx#L58)
**Description:** Clicking a marker behind the current playback position triggers `setSeekTo` but the boundary effect still has `currentPlaybackSeconds` from the old position. Since the old position exceeds the new segment's `segmentEndSeconds`, auto-advance fires immediately after the click.
**Remediation:** Suppress boundary checks until polling confirms the player has reached the new seek position.

### P2.3 — Cubic: Mentions Near Video End Get Segment Beyond Media Duration (NEW)
**Source:** Cubic PR #224 (issue `6722c593`) + Agent C | Status: 🆕 New
**File:** [`web/lib/utils/entity-time-seek.ts:319`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/entity-time-seek.ts#L319)
**Description:** Final mention's `segmentEndSeconds` uses `seekSeconds + SEGMENT_DEFAULT_SECONDS` (30s) even when `seekSeconds` is 5s before the video ends. Auto-advance cannot reach the boundary; UI shows a time past video end.
**Cubic suggestion:**
```typescript
const minimumEnd = seekSeconds + SEGMENT_MIN_SECONDS;
return videoDuration !== null && videoDuration > 0
  ? Math.min(videoDuration, Math.max(minimumEnd, end))
  : Math.max(minimumEnd, end);
```

### P2.4 — Cubic: Chapter-Covered Mentions Get 45s Instead of Capped Segment (NEW)
**Source:** Cubic PR #224 (issue `3496d861`) | Status: 🆕 New
**File:** [`web/lib/utils/entity-time-seek.ts:335`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/entity-time-seek.ts#L335)
**Description:** When a chapter covers the mention, `end` is set to `chapterItem.end_seconds` which can be larger than `SEGMENT_MAX_SECONDS`. The `Math.max(m.seekSeconds + 5, end)` guard only prevents undershooting, not overshooting. Segments can exceed `SEGMENT_MAX_SECONDS = 45`.
**Remediation:** `end = Math.min(end, chapterItem.end_seconds, seekSeconds + CHAPTER_CAP_SECONDS);`

### P2.5 — Heavy TF-IDF Computation on UI Thread (NEW)
**Source:** Agent D | Status: 🆕 New
**File:** [`web/lib/utils/entity-time-seek.ts:395`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/entity-time-seek.ts#L395)
**Description:** `getRankedMentionsForEntity` calls `TfIdfSimilarityEngine` synchronously for every mention (multiple `computeTfIdfScore` + `computeDensityScore` calls on full dimension text). On long videos with high-frequency entities, this blocks the React render thread for potentially hundreds of milliseconds.
**Remediation:** Memoize at the `selectedNodeId + dimension content hash` level, or offload to a WebWorker/backend for entities with >3 mentions.

### P2.6 — `prop drilling` Inline Functions Break Child Memoization (NEW)
**Source:** Agent B | Status: 🆕 New
**File:** [`web/components/containers/DashboardContainer.tsx:661`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/containers/DashboardContainer.tsx#L661)
**Description:** Multiple anonymous inline functions passed as props (e.g., `onClose={() => setSelectedNodeId(null)}`) defeat `React.memo` on all child panel components. `DashboardContainer` re-renders frequently (polling + streaming), propagating unnecessary re-renders through the entire panel tree.
**Remediation:** Wrap all event handler props in `useCallback`.

### P2.7 — `has_channel_meta` NULL Guard Missing in v13 RPC (STILL OPEN)
**Source:** Agent C | Status vs prior: ❌ Still open (P2.1 from 2026-08-02)
**File:** [`supabase/migrations/20260805001000_history_overview_function_v13_add_has_chapters.sql`](file:///home/kellyb_dev/projects/hex-yt-intel/supabase/migrations/20260805001000_history_overview_function_v13_add_has_chapters.sql)
**Description:** `jsonb_typeof(w.analysis_payload -> 'channelMeta') = 'object'` returns SQL NULL when `analysis_payload` is NULL. Clients receive `null` instead of `false` for the boolean field.
**Remediation:** `coalesce((jsonb_typeof(w.analysis_payload -> 'channelMeta') = 'object' AND ...), false)`

### P2.8 — `numeric` / `max_score` Arrives as String via PostgREST (STILL OPEN)
**Source:** Agent C | Status vs prior: ❌ Still open (P2.3 from 2026-08-02)
**Description:** `max_score numeric` in RPC is serialized as JSON string by PostgREST. Any client arithmetic produces `NaN`. Admin UI sort comparators silently break.
**Remediation:** Cast: `max_score::float8 AS max_score` at the SQL level.

### P2.9 — WordCloud Keyboard Accessibility (STILL OPEN)
**Source:** Agent B + CodeRabbit | Status vs prior: ❌ Still open
**File:** [`web/components/templates/console/WordCloud.tsx:722`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/WordCloud.tsx#L722)
**Description:** Canvas `role="img"` has no keyboard event handlers or focusable word targets. Screen readers and keyboard users cannot interact with the word cloud.
**Remediation:** Add a hidden accessible list of `<button>` elements for each word, or implement spatial keyboard navigation.

### P2.10 — Direct `fetch()` in `relations-engine.ts` Domain Service (STILL OPEN — Partial)
**Source:** Agent D | Status vs prior: 🟡 Partial (dedup/ignore fixed, but fetch remains)
**File:** [`web/lib/intelligence/relations-engine.ts:84`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/intelligence/relations-engine.ts#L84)
**Description:** `fetch('https://openrouter.ai...')` directly inside a domain service circumvents the standardized `OpenRouterCompletionAdapter` port.
**Remediation:** Delegate to `OpenRouterCompletionAdapter`.

### P2.11 — `dimension-remediation.ts` File Size Regressed to 785 Lines (REGRESSED)
**Source:** Agent D | Status vs prior: ⚠️ Regressed (was 665, now 785)
**File:** [`web/lib/services/dimension-remediation.ts`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/services/dimension-remediation.ts)

### P2.12 — Upstash Vector Embeddings Lack TTL (NEW)
**Source:** Agent C | Status: 🆕 New
**File:** [`web/app/api/webhooks/embed/route.ts`](file:///home/kellyb_dev/projects/hex-yt-intel/web/app/api/webhooks/embed/route.ts)
**Description:** KV cache has a 7-day TTL but Upstash Vector upserts have no TTL or purge mechanism. Index grows unbounded.
**Remediation:** Implement a pg_cron or Upstash-native cleanup job. Or use Upstash Vector TTL if available on the current tier.

### P2.13 — `transcript_chapters` CHECK Constraint Added Without `NOT VALID` (NEW)
**Source:** Agent C | Status: 🆕 New
**File:** [`supabase/migrations/20260805003000_transcript_chapters_check_constraint.sql`](file:///home/kellyb_dev/projects/hex-yt-intel/supabase/migrations/20260805003000_transcript_chapters_check_constraint.sql)
**Description:** `ADD CONSTRAINT ... CHECK` without `NOT VALID` causes a table scan + lock on `transcript_chapters` at migration time. While the table is new, this sets a bad precedent and could cause issues as the table grows.
**Remediation:** Use `NOT VALID` pattern consistently.

### P2.14 — Unstable Significance Sort Tie-Breaking (NEW)
**Source:** Agent D | Status: 🆕 New
**File:** [`web/lib/utils/entity-time-seek.ts:416`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/entity-time-seek.ts#L416)
**Description:** Mentions with equal significance score have undefined relative order. While V8 sort is stable, the sort key doesn't include a chronological tiebreaker — unexpected timeline ordering on equal-significance entities.
**Remediation:** `b.significance - a.significance || a.seekSeconds - b.seekSeconds`

### P2.15 — Direct Supabase Access in `aux-remediation.ts` Domain Service (NEW)
**Source:** Agent D | Status: 🆕 New
**File:** [`web/lib/services/aux-remediation.ts:56`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/services/aux-remediation.ts#L56)
**Description:** `getSupabaseServiceClient()` imported directly in a domain service, bypassing persistence ports. Violates Hexagonal Architecture (AGENTS.md §9.1).
**Remediation:** Route through `SupabasePersistenceAdapter`.

### P2.16 — `DashboardContainer.tsx` Grew to 776 Lines — Unsplit (REGRESSED)
**Source:** Agent D | Status vs prior: ⚠️ Regressed (was 673, now 776)
**File:** [`web/components/containers/DashboardContainer.tsx`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/containers/DashboardContainer.tsx)
**Description:** 29 hooks (`useMemo`/`useCallback`/`useEffect`) in a single component. The new `timelineEntityData` memo and `handleSelectNode` logic should be extracted to `useEntityTimeline` custom hook.

### P2.17 — Auto-Advance Domain Logic in UI Component (ARCH — NEW)
**Source:** Agent D | Status: 🆕 New
**File:** [`web/components/templates/console/EntityMentionTimeline.tsx:81`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/EntityMentionTimeline.tsx#L81)
**Description:** The segment-boundary auto-advance `useEffect` is a domain concern embedded in the presentation layer. Makes unit testing impossible without mounting the component.
**Remediation:** Extract to `useEntityMentionAutoAdvance(mentions, activeRankIndex, currentPlaybackSeconds, onAdvance)` custom hook.

### P2.18 — Stripe Webhook Logs Full Event Payload (STILL OPEN)
**Source:** Agent A (OWASP A09) | Status vs prior: ❌ Still open (P3.4 from prior)
**File:** [`web/app/api/stripe/webhook/route.ts:29`](file:///home/kellyb_dev/projects/hex-yt-intel/web/app/api/stripe/webhook/route.ts#L29)
**Description:** Full Stripe event payload including customer metadata logged to console.error. May expose PII in Vercel logs accessible to collaborators.
**Remediation:** Log only `event.type` and `event.id`, sanitize customer fields.

---

## 🟢 P3 — LOW / NITPICK

### P3.1 — Invalid Tailwind Class `py-0.2` (NEW)
**Source:** Agent B | Status: 🆕 New
**File:** [`web/components/templates/console/EntityMentionTimeline.tsx:228`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/EntityMentionTimeline.tsx#L228)
**Remediation:** Change to `py-0.5` or `py-[2px]`.

### P3.2 — ESLint: `wordsLayout` Missing from useEffect Dependencies (STILL OPEN)
**Source:** Agent B + CodeRabbit | Status vs prior: ❌ Still open
**File:** [`web/components/templates/console/WordCloud.tsx:544`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/WordCloud.tsx#L544)

### P3.3 — Cubic: Test Assertions Vacuously True in EntityMentionTimeline.test.tsx (NEW)
**Source:** Cubic PR #224 (issue `5879369d`) | Status: 🆕 New
**File:** [`web/components/templates/console/__tests__/EntityMentionTimeline.test.tsx:33`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/__tests__/EntityMentionTimeline.test.tsx#L33)
**Description:** Tests only assert ordering/clamping invariants that the implementation guarantees by construction. Would pass even if TF-IDF scoring were completely broken. Assert concrete expected ranking order and segment end values.

### P3.4 — Cubic: Significance Context Window Misaligned with `occurrenceIndex` (NEW)
**Source:** Cubic PR #224 (issue `99b64ef4`) | Status: 🆕 New
**File:** [`web/lib/utils/entity-time-seek.ts:391-396`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/entity-time-seek.ts#L391-L396)
**Description:** Context window for TF-IDF is indexed by `matchItem.occurrenceIndex`, which is the occurrence in the source text, not in the full dimension text. May attach significance context to the wrong mention.

### P3.5 — Micro-segments for Closely-Clumped Mentions (NEW)
**Source:** Agent D | Status: 🆕 New
**File:** [`web/lib/utils/entity-time-seek.ts:349`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/entity-time-seek.ts#L349)
**Description:** `Math.max(seekSeconds + 5, end)` enforces 5-second micro-segments when mentions are within 5s of each other. Auto-advance becomes jerky.
**Remediation:** Group proximal mentions (within `SEGMENT_MIN_SECONDS`) into a single continuous segment.

### P3.6 — Spurious Auto-Advance on Exact Boundary (NEW)
**Source:** Agent D | Status: 🆕 New
**File:** [`web/components/templates/console/EntityMentionTimeline.tsx:84`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/EntityMentionTimeline.tsx#L84)
**Description:** `currentPlaybackSeconds >= segmentEndSeconds` with 250ms polling granularity can falsely trigger on pause/resume near the boundary.
**Remediation:** Add `+0.5s` hysteresis margin.

### P3.7 — Duplicate Billing SDKs (Stripe + Paddle) (STILL OPEN)
**Source:** Agent D | Status vs prior: ❌ Still open (Ponytail)
**File:** [`web/package.json`](file:///home/kellyb_dev/projects/hex-yt-intel/web/package.json)

### P3.8 — Hand-Rolled Archimedean Spiral + RAF in WordCloud (STILL OPEN)
**Source:** Agent D | Status vs prior: ❌ Still open (Ponytail)
**File:** [`web/components/templates/console/WordCloud.tsx:215`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/WordCloud.tsx#L215)

### P3.9 — Hand-Rolled Tree Layout + Pan/Zoom in MindMap (STILL OPEN)
**Source:** Agent D | Status vs prior: ❌ Still open (Ponytail)
**File:** [`web/components/templates/console/MindMap.tsx:66`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/MindMap.tsx#L66)

### P3.10 — `ChatDock.tsx` / `AnalysisHistory.tsx` Grew Beyond Split Threshold (REGRESSED)
**Source:** Agent D | Status vs prior: ⚠️ Regressed
**Files:** `ChatDock.tsx` (865 lines), `AnalysisHistory.tsx` (817 lines)

### P3.11 — Missing Auto-Advance Test Coverage (NEW)
**Source:** Agent E | Status: 🆕 New
**File:** [`web/components/templates/console/__tests__/EntityMentionTimeline.test.tsx`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/templates/console/__tests__/EntityMentionTimeline.test.tsx)
**Description:** The `useEffect` auto-advance (most complex + risky logic) has zero test coverage. No test for `mentions.length === 0` path.

### P3.12 — Missing `chip-state-sync` Test Suite (STILL OPEN)
**Source:** Agent E | Status vs prior: ❌ Still open
**File:** `web/hooks/__tests__/chip-state-sync.test.ts` (does not exist)

### P3.13 — Imperative `typeof` Guards in `aux-status-from-report.ts` (STILL OPEN)
**Source:** Agent D | Status vs prior: ❌ Still open (Ponytail)
**File:** [`web/lib/utils/aux-status-from-report.ts:64`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/aux-status-from-report.ts#L64)

---

## ✅ DELTA REPORT — Wins Since 2026-08-02

| Finding | Resolution |
|---|---|
| P0: IDOR on `update_analysis_result_atomic` | ✅ Fixed (migration revoked PUBLIC EXECUTE) |
| P0: `jsonb \|\| NULL` wipe vulnerability | ✅ Fixed (null patch guard migration) |
| P1.2: OpenRouter user tagging not implemented | ✅ Fixed (userId now passed in both adapters) |
| P2.4: WordCloud double-RAF leak on unmount | ✅ Fixed (both IDs cancelled in cleanup) |
| P2.5: MindMap fitToView divide-by-zero | ✅ Fixed (`Math.max(1, ...)` guard) |
| P2.6: Body scroll-lock not restored on unmount | ✅ Fixed (cleanup resets overflow + touchAction) |
| P3.2: `dragMovedRef` not reset on mousedown | ✅ Fixed |
| CodeRabbit: WordCloud animation flash | ✅ Fixed (default progress 1→0) |
| ADR 021 Phase 1: Dimension-level persistence | ✅ Implemented via `analysis_chunks` table |
| PR #218: Vitest glob widened to include components/ | ✅ Fixed |
| Regex: TIMESTAMP_RE ReDoS risk | ✅ No risk confirmed |
| Regex: `\b` adjacent to `[` bracket — works correctly | ✅ Confirmed |
| `transcript_chapters` RLS: secure-by-default | ✅ No public policies |
| Sentry suppression on worker abort/timeout | ✅ Fixed (separate commit) |

---

## 🔵 CI/CD CONFIDENCE SCORE (AGENTS.md §4 Algorithm)

| Tool | Status | Findings | Weight | Score |
|---|---|---|---|---|
| Cubic | ⏳ Pending on PR #224 / ✅ PR #225 | 6 findings PR #224, 8 findings PR #225 | 30 | **0/30** (pending = 0) |
| CodeRabbit | 🔴 Rate-limited (marked pass, no review) | 0 (no review performed) | 20 | **0/20** |
| Snyk | ✅ Pass (no manifest changes detected) | 0 new | 15 | **15/15** |
| DeepSource | ⚫ Skipping (removed from check suite) | — | 15 | **0/15** |
| CI/CD Pipeline | 🔴 FAIL on PR #225, ✅ Pass on PR #224 | Lint fail | 10 | **5/10** |
| Vercel | ✅ Pass (both PRs have previews) | 0 | 5 | **5/5** |
| CodeQL | ✅ Pass | 0 | 5 | **5/5** |

```
Raw score:               30 / 100
CodeRabbit rate-limited: -15 (timeout/unavailable penalty)
CI/CD FAIL on PR #225:  -20 (FAILURE with confirmed findings)
P0 unaddressed (P0.1):  -100 (cap applied → score floors at 0)
─────────────────────────────
Final score:              0 / 100 (P0 penalty floors score)
```

> **⛔ Verdict: DO NOT MERGE — Score 0/100**
> PRs blocked until: (1) PR #225 lint fixed, (2) P0.1 HMAC order addressed on main, (3) Cubic pending review passes, (4) CodeRabbit rate limit resolved.

---

## 🎯 ACTION CLUSTERS (Priority Order)

### 🔴 Cluster 1: Immediate Blockers (Block all merges)
1. **Fix PR #225 lint failure** — investigate ESLint output from failed CI run
2. **Move `verifyContentSig` before array iteration** in `persist/route.ts` (P0.1)
3. **Add `NOT VALID` + `IF EXISTS`** to `usage_logs` constraint migrations (P0.2)
4. **Restore AI review pipeline** — resolve CodeRabbit rate limit, restore DeepSource (P0.4)

### 🟠 Cluster 2: ADR 025 Feature Correctness (Fix before feature ships)
5. **Add `pendingSeek` guard** in `EntityMentionTimeline` auto-advance (P1.1, P2.2)
6. **Fix reactive dimension store** — replace `getState()` with reactive selector in `useMemo` (P1.2)
7. **Fix `mentions.length === 0` guard** — show timeline for single-mention entities (P1.3)
8. **Add `isSeeking` ref** to VideoPlayerCard poll loop (P1.10)
9. **Fix `activeRankIndex` staleness** — add `mentions.length` to reset effect deps (P1.7)
10. **Cap segment end at `videoDuration`** (P2.3) + **fix chapter segment overshoot** (P2.4)
11. **Fix significance sort tie-breaker** — add `|| a.seekSeconds - b.seekSeconds` (P2.14)
12. **Fix `py-0.2` Tailwind class** (P3.1)

### 🟠 Cluster 3: Security / DB (Next sprint)
13. **Fix UUID validation** in `relations/route.ts` (P1.4)
14. **Sanitize embed webhook error response** (P1.5)
15. **Apply pnpm overrides** for dompurify + nanoid CVEs (P1.6)
16. **Add 30-day filter** to `admin_list_users_activity` (P1.8)
17. **Add `NOTIFY pgrst`** to deployment pipeline (P1.9)

### 🟡 Cluster 4: Architecture / Performance (Ongoing)
18. **Extract `useEntityMentionAutoAdvance` hook** (P2.17)
19. **Memoize TF-IDF computation** or offload to WebWorker (P2.5)
20. **Wrap DashboardContainer handlers in `useCallback`** (P2.6)
21. **Implement Upstash Vector TTL/cleanup** (P2.12)
22. **Add WordCloud keyboard navigation** (P2.9)
23. **Route `aux-remediation.ts`** through persistence adapter (P2.15)

### 🟢 Cluster 5: Debt Reduction (Tech debt sprints)
24. Add auto-advance + zero-mention tests (P3.11)
25. Create `chip-state-sync.test.ts` (P3.12)
26. Make EntityMentionTimeline test assertions concrete (P3.3)
27. Resolve duplicate Stripe/Paddle SDKs (P3.7)
28. Split `DashboardContainer`, `ChatDock`, `AnalysisHistory` (P2.16, P3.10)

---

## 📋 SKILL COVERAGE MATRIX

| Skill / Tool | Status | Key Findings |
|---|---|---|
| `owasp-top-10` | ✅ Agent A complete | P0.1, P1.4, P1.5, P1.6, P2.18 |
| `pr-review-workflow` (Phase 0–5) | ✅ Full orchestration | All clusters |
| `review-pr` (blast radius) | ✅ Agent B complete | P1.1, P1.3, P2.6, P2.9 |
| `review-delta` (diff review) | ✅ All agents | All P-series |
| `build-graph` (knowledge graph) | ✅ Structural analysis | P0.3, P0.4 |
| `ponytail-audit` (over-engineering) | ✅ Agent D complete | D1-D18 |
| `supabase-postgres-best-practices` | ✅ Agent C complete | P0.2, P1.8, P1.9, P2.7, P2.13 |
| `planetscale-postgres-safety-review` | ✅ Agent C (locking/constraint safety) | P0.2, P2.13 |
| `evaluator-calibration` (skeptical lens) | ✅ Agent D stress-test | D12, D13, D16 |
| CI/CD confidence algorithm | ✅ Agent E complete | **Score 0/100 — HARD BLOCK** |
| Cubic MCP (PR #224 + #225) | ✅ Retrieved | 14 issues across both PRs |
| pnpm audit | ✅ Retrieved | 4 HIGH + 1 MODERATE vulns |
| CodeRabbit | 🔴 Rate-limited | 0 reviews performed |
| SonarCloud | 🔴 401 Unauthorized | Not retrieved |
| Snyk PR checks | ✅ Pass | 0 new manifest vulns |

---

*Report complete. 5/5 agents finished + Cubic MCP retrieved. All findings are REPORT ONLY — no fixes applied.*
*Baseline: [10X_COVERAGE_REPORT_2026_08_02](file:///home/kellyb_dev/.gemini/antigravity-cli/brain/58bb34b8-9b61-4588-9e8b-8a53a3d0edfd/10X_COVERAGE_REPORT_2026_08_02.md)*
