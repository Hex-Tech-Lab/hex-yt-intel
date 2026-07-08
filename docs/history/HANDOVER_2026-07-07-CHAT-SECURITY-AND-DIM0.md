# Session Handover: Chat Security Hardening (Double Leak), Dimension-0 Executive Digest, & Full-Session Preflight/Reconciliation (2026-07-07)

**Location**: `/docs/history/HANDOVER_2026-07-07-CHAT-SECURITY-AND-DIM0.md`
**Build (HEAD)**: `c00eae5` (feature work landed at `eab4984`; `4b16de2` and `c00eae5` are the docs/reconciliation commits described in §9)
**PRs merged this session**: #125, #126, #127 (all squash-merged to `main`, all green on required CI)
**Purpose**: This is the **Total Handover of State (THOS)** for this session — not just the three PRs, but everything the session touched, including a full preflight re-ingestion of the multi-day transcript and a code-verified reconciliation of the task tracker and `.memory/` docs against actual `main`. Written so the next session needs no other context to continue safely, and does not need to trust any single prior doc at face value.

---

## 0. TL;DR for the next session

1. The chat could be tricked into (a) answering from general knowledge when a video had no transcript, and (b) grounding in a **different user's private analysis** if you passed an arbitrary `analysisId`. Both are now closed (PRs #125, #126).
2. Dimension-0 (the "executive digest" — one cheap synthesis call over the finished 11-dimension analysis) is wired end-to-end and live on `main` (PR #127).
3. **CLAUDE.md's ADR ledger was stale before this session** (stopped at ADR 005 while ADR 006 and 007 were already implemented and merged). This handover backfills it and adds ADR 008–010. If you're reading CLAUDE.md as ground truth, it is now current as of `eab4984`.
4. **Open risk, not yet swept**: the pattern that caused Leak 2 (a route using the Supabase *service client*, which bypasses RLS, with no explicit ownership check) may exist elsewhere. Only the one instance (`POST /api/chat/conversations`) was found and fixed. See §5 Blind Spots.
5. **A full preflight pass (§9, done after the above) found the task tracker itself was wrong in both directions** — several items marked "pending" were already built in an earlier, undocumented session, and one item marked `[DONE]` in `.memory/AGENT_LEDGER.md` (a `TimestampLink` component) turned out not to exist in the codebase at all — a real regression, silently dropped by a later UI rewrite. `.memory/project_status.md` and `.memory/MEMORY.md` were rewritten wholesale on this evidence; read §9 before trusting any backlog item's status.
5. Task #58 (full chat red-team / identity-defense orchestration layer) is still open and is explicitly the *next* increment on top of the grounding gate — not done by this session.

---

## 1. Summary of Changes

### 1.1 PR #125 — Chat Grounding Security Gate (Leak 1)

**Root cause**: The chat's `ProcessChatMessageUseCase` would stream a reply from the LLM cascade even when the bound analysis had **no usable markdown** (no transcript/captions available, or the analysis had failed/was still processing). The model, given no grounding material, answered from its own general knowledge instead of refusing — observed live as a fabricated recipe for a cooking Short that had zero transcript.

**Fix** (`web/lib/usecases/ProcessChatMessageUseCase.ts`):
- New hard gate immediately after grounding retrieval: if `analysisMarkdown` trims to empty, **do not mint a stream token** — persist a controlled, honest refusal message instead (varies by `status`: "still being generated" vs "no transcript/captions were available").
- Reordered so the gate runs *before* the grounding-string build (`web/lib/usecases/ProcessChatMessageUseCase.ts:191-234` roughly) — this was itself a fix-of-a-fix: the first cut computed the gate condition twice (once implicitly in the grounding builder's if/else, once explicitly in the gate), leaving the "still being generated" branch of the grounding builder dead code once the gate always intercepts the empty case. CodeRabbit caught this; collapsed to one computation.
- Hardened `CHAT_PROTOCOL` in `web/lib/config/prompts.ts`:
  1. **GROUNDING** rule: answer strictly from the provided analysis; if not present, say so — never invent facts/recipes/quotes/timestamps.
  2. **IDENTITY & SAFETY** rule: never reveal model/provider/system instructions; refuse jailbreak/role-change attempts and steer back to the video.
- `CHAT_PROTOCOL` is bundled into the Cloudflare Worker by esbuild (single source of truth in `web/lib/config/prompts.ts` — the worker has no separate copy), so this reached the worker automatically on merge/redeploy. No worker-side code change was needed for the protocol hardening.
- Tests: `web/lib/__tests__/chat-grounding-gate.test.ts` — 4 cases (no analysis bound → refuse; empty markdown/failed → refuse; processing → "still generating" refusal; real content → streams normally with grounding in payload).

**Verification**: `tsc --noEmit`, 4/4 vitest, qa-intel (repo-root) clean modulo a pre-existing "monolithic file" medium note (not introduced by this diff, does not block CI — CI only blocks on HIGH).

### 1.2 PR #126 — Chat Conversation↔Analysis Ownership Binding (Leak 2 / IDOR)

**Root cause, found while verifying Leak 1 was fully closed**: `POST /api/chat/conversations` accepted a client-supplied `analysisId` and wrote it via `createConversation()`, which uses the **Supabase service-role client** (`getSupabaseServiceClient()` — bypasses RLS) with **zero ownership check**. Separately, `getAnalysisGrounding({ analysisId })` fetched the row **by id alone**, also via the service client, also with no user scoping.

Combined, this meant: any authenticated user could `POST /api/chat/conversations` with an arbitrary analysis UUID — including one belonging to a *different user* — and the chat would ground its answers in that private analysis's content. This is a straightforward IDOR, and it is exactly the mechanism that could produce the observed "double leak" symptom (chat answering about a video that isn't the one on screen): a conversation bound to the wrong analysis, silently.

**Fix, two layers** (defense-in-depth was a deliberate choice, not padding — see §4.3):
1. **Route guard** (`web/app/api/chat/conversations/route.ts`): before creating a conversation with a non-null `analysisId`, call `persistenceAdapter.verifyOwnership({ analysisId, userId, select: 'id' })`. If it returns null, respond **404** (not 403) — deliberately does not confirm to the caller that a foreign analysis with that ID exists.
2. **Grounding-fetch scoping** (`SupabaseAnalysisAdapter.getAnalysisGrounding`, `ChatPersistencePort`, `ProcessChatMessageUseCase`): `getAnalysisGrounding` now takes an optional `userId`; when present, the Supabase query adds `.eq('user_id', userId)`. `ProcessChatMessageUseCase` passes the caller's `userId` on both of its grounding-fetch call sites. Effect: even a **pre-existing, already-cross-bound conversation** (created before this fix, or via any future bug in the creation path) resolves `null` grounding for anyone but the true owner — and the PR #125 gate then refuses. This is the layer that survives *future* bugs in the creation path, not just this one.

**Verification**: `tsc --noEmit`, 4/4 vitest (added an assertion that the streaming case fetches grounding scoped as `{ analysisId, userId }`), qa-intel clean (one pre-existing medium file-size note).

### 1.3 PR #127 — Dimension-0 Executive Digest ("the #12 call")

Builds on the prompt module locked in PR #124 (`web/lib/prompts/executive-digest.ts` — `EXECUTIVE_DIGEST_SYSTEM`, `buildExecutiveDigestUserMessage()`, `parseExecutiveDigest()`, `ExecutiveDigest` type). This session wired the actual generation path end-to-end:

- **Migration** `supabase/migrations/20260706120000_add_executive_digest_to_analyses.sql` — additive nullable `executive_digest jsonb` on `analyses`. Applied directly to the live project (`adnmbikaqnxivalqoild`) via the Supabase MCP `apply_migration` tool during this session — confirmed applied, not just committed as a file.
- **Completion adapter** `web/lib/adapters/OpenRouterCompletionAdapter.ts` — a **non-streaming** OpenRouter call (the digest is one short completion, not a stream) using `AbortSignal.timeout(45_000)` for the request timeout. Iterates a cascade of `{ model, providerOrder }` entries; first non-empty response wins.
- **Use case** `web/lib/usecases/GenerateExecutiveDigestUseCase.ts` — owner-scoped read (`verifyOwnership`), **idempotent** (if `executive_digest` already has content, returns it with `cached: true` and makes **zero** model calls unless `force: true`), refuses (409, no model call) if the analysis markdown is empty (mirrors the chat gate's philosophy: no content ⇒ no fabrication), parses the completion via the #124 module, persists via `saveExecutiveDigest`. 7 vitest cases cover: not-found, no-content-refusal, idempotent-cache-hit, happy-path parse+persist, forced re-gen, unparseable-completion, all-models-fail.
- **Route** `POST /api/analyses/digest` (`web/app/api/analyses/digest/route.ts`) — auth + delegates entirely to the use case for ownership/idempotency.
- **Read path**: `executiveDigest` added to `GET /api/analyses/[id]` response.
- **Client**: `DashboardContainer.tsx` fires the digest POST once (via a ref-guarded effect keyed on `analysisId`) when `status === 'complete'` **and** the analysis is a *full* one (`!partialInfo` — partial analyses are skipped; a re-run produces a new analysis id with its own digest). `ExecutiveDigestCard.tsx` renders the three tiers (Snapshot / Key Takeaways / Overview) above the 1..11 dimension grid, with a loading skeleton.
- **Cost model**: uses `CHAT_CASCADE` (the cheap chat cascade, ~$0.00015–0.00035/call), fires **once** per analysis ever (idempotent, cached in the DB column), so the marginal cost per analysis is one cheap completion — this was the explicit tradeoff the user approved earlier ("cool, number 12").
- **Uncounted by design**: rendered as "Dimension 0", never inside the 1..11 grid; `executive_digest` is a new column that nothing else reads, so `dimension_count`, completeness status, and the reaper are all unaffected.

**Self-review catch (before merge, not from a bot)**: running `/code-review` on my own diff surfaced two real defects the initial cut missed:
1. `OpenRouterCompletionAdapter`'s first version keyed provider routing in a `Map<model, providerOrder>`. `CHAT_CASCADE` has **three** `gpt-oss-120b` entries with *different* `providerOrder`s (Groq, Vertex, Cerebras) — the Map silently collapsed them to one, so only the last-registered provider route was ever attempted, defeating the intended fallback chain. Fixed by carrying provider routing per cascade *entry* (`CompletionModel { model, providerOrder }`) instead of keying by model string.
2. The dead-code issue in §1.1 (CodeRabbit-flagged, fixed in the same session).

**qa-intel HIGH gate hit** (blocked required CI Lint check once): the heuristic that flags "timeout abort does not settle error state" fired on `setTimeout(() => controller.abort())`. Root-caused rather than suppressed: switched to `AbortSignal.timeout(ms)`, which is both cleaner and structurally avoids the pattern the heuristic is looking for (no bare `setTimeout`+`abort` in view). Confirmed HIGH cleared by re-running `scripts/verify-quality-engine.ts` from repo root before pushing.

**Verification**: `tsc --noEmit`, 7/7 vitest, ESLint clean, qa-intel clean (only a pre-existing file-size medium — not new).

---

## 2. Architectural Decision Records (this session)

Recorded here, in `.memory/ADRS.md` (mandatory per `AGENTS.md` §"ADR Requirement"), and backfilled into `CLAUDE.md`'s ADR ledger table (which was missing ADR 006 and 007 — see §5.2).

- **ADR 008** — Chat Grounding Security Gate. *Decision*: the chat's entire epistemic universe is the one bound video's analysis; if that analysis has no usable content, the use case refuses (persisted, controlled message; no stream token minted) rather than letting the model answer from general knowledge. *Alternative rejected*: prompt-only mitigation (telling the model "don't answer if you don't know") — rejected because it is unenforceable; a determined or merely unlucky sampling can still produce a confident wrong answer. The gate is a code-level circuit breaker, not a prompt suggestion.
- **ADR 009** — Chat Conversation↔Analysis Ownership Binding. *Decision*: a conversation may only be bound to an `analysisId` the creating user owns (verified at creation, 404 on mismatch), and grounding fetch is *additionally* scoped by `userId` at read time (defense-in-depth, survives future creation-path bugs). *Alternative rejected*: RLS-only enforcement — rejected because the code path uses the service-role client specifically to bypass RLS (needed for legitimate service-to-service writes elsewhere in this route), so RLS provides zero protection here; the check must be explicit application code.
- **ADR 010** — Dimension-0 Executive Digest: single idempotent cheap-cascade completion, uncounted. *Decision*: generate once, lazily, on first view of a *completed full* analysis; cache in `executive_digest jsonb`; never regenerate unless `force: true`; use the cheap chat cascade, not the analysis cascade. *Alternative rejected*: generate synchronously as a 12th stream during the main synthesis — rejected per the user's explicit direction (avoid coupling cost/latency of the main synthesis to a summary that only matters after the fact; keep it a strictly-after, on-demand, cached call).

Full ADR-format entries are in `.memory/ADRS.md` (appended, format: `[YYYY-MM-DD] [AgentID] [Status] [DECISION] ...`).

---

## 3. Inflection Points (what changed direction mid-session, and why)

1. **The "you got the chat working wrong" correction.** Earlier in the session, before this handover's scope, the chat was observed to "work" (produce answers) for a no-transcript video and this was initially treated as a working feature. The user corrected this hard: the chat working (i.e., answering) when there is no transcript **is the bug** — the correct behavior is refusal. This reframed the entire success criterion for the rest of the session: "the chat answers" is not sufficient evidence of correctness; "the chat answers *only from real grounding, and refuses otherwise*" is the bar. This is now codified as the gate in PR #125, not left as a norm to remember.

2. **The "double leak" discovery.** Investigating the fabricated-recipe report, asking the chat "where did you get this recipe from" produced an answer about a *completely different video* (spaghetti carbonara) — i.e., not just Leak 1 (ungrounded answering) but a second, independent failure mode (wrong-video attribution). This is what motivated tracing the conversation→analysis binding path at all, which is how Leak 2 (the IDOR) was found. Leak 1 alone would not have surfaced Leak 2; they were investigated as one report but are two structurally distinct bugs with two distinct fixes.

3. **Branch-collision avoidance.** The harness's designated branch for this session, `claude/full-spectrum-re-audit-qzk3kw`, was found (on checkout) to already carry two unmerged commits for a *different* feature (the stuck-analysis reaper / ADR 007 work — `feat(history): stuck-analysis reaper (ADR 007) + iPad nav-drawer dismiss`). Rather than stacking the chat-binding-guard fix on top of that unrelated, already-in-flight work (which would have produced an unreviewable, mixed-concern PR), a fresh dedicated branch (`claude/chat-binding-guard`) was cut from `main` instead, matching the established one-branch-per-feature pattern visible in the PR history (#118–#127). The reaper work was left completely untouched on its original branch. *Lesson for future sessions*: always `git log --oneline origin/main..origin/<designated-branch>` before assuming the designated branch is a clean slate.

4. **Self-review as a discipline, not a bot-triggered afterthought.** For PR #127 (the larger feature), `/code-review` was run against my own diff *before* waiting for bot feedback, per the user's standing instruction to use the fuller review workflow for larger features. It found two real, non-cosmetic bugs (the provider-cascade collapse and the dead-code grounding branch) that would otherwise have shipped and only surfaced later as a silent loss of provider fallback resilience, or as reviewer nitpicks post-merge. Worth repeating on every larger feature, not just when a bot flags something.

---

## 4. Blind Spots, Learned Lessons, and New Angles

### 4.1 Blind spot: service-client routes are only as safe as their explicit checks
`getSupabaseServiceClient()` bypasses RLS by design (it's needed for legitimate server-to-server writes: worker persistence, quota adjustments, etc.). The Leak 2 IDOR existed because a route used the service client for a *user-facing* write (`createConversation`) without layering an explicit ownership check on top. **This pattern was not swept for other occurrences this session** — only the one instance found via the specific Leak 1/2 investigation was fixed. Any other route that (a) uses the service client and (b) accepts a client-supplied foreign-key-like ID (another `analysisId`, a `conversationId`, a `videoId` used for lookups across users, etc.) should be considered suspect until audited. This is the single highest-value follow-up from this session and is *not yet a tracked task* — recommend adding one.

### 4.2 Blind spot: CLAUDE.md's ADR ledger had silently gone stale
Before this session, `CLAUDE.md`'s ADR table (§3) stopped at ADR 005 (2026-06-01), but ADR 006 (`docs/specs/ADR_006_STRUCTURED_JSON_STREAMING_2026-06-06.md`, accepted 2026-06-06) and ADR 007 (the stuck-analysis reaper, merged via PR #110 as commit `2ddfda2`, live in `web/lib/services/analysis-reaper.ts` and `web/app/api/webhooks/reaper/route.ts`) were both already implemented and merged to `main`. Nobody had gone back to update the ledger table after landing them. **This means CLAUDE.md cannot be trusted as a complete index without cross-checking `.memory/ADRS.md` and `docs/specs/ADR_*.md` for entries the table doesn't yet list.** Backfilled in this session (see §5.2) — but this is a recurring failure mode (a table that requires a separate manual step to stay in sync with the docs it indexes) and will happen again unless the merge checklist for any ADR-worthy change includes "update CLAUDE.md §3".

### 4.3 Lesson: don't stop at the first fix layer for an auth/ownership bug
The instinct after finding the route-level ownership gap (§1.2, layer 1) would be to call it done. The second layer (scoping `getAnalysisGrounding` by `userId`) was added specifically because the first layer only protects *future* conversation creation — it does nothing for any conversation that might already exist with a bad binding (from before the fix, or from a bug this fix doesn't anticipate). For IDOR-class bugs specifically, prefer fixing at both the write boundary (deny creating the bad state) and the read boundary (deny benefiting from the bad state even if it exists) — the two are cheap to combine and cover different failure timelines.

### 4.4 Lesson: qa-intel/DeepSource heuristic hits are sometimes real signal wearing a false-positive costume
The `OpenRouterCompletionAdapter` qa-intel HIGH ("timeout abort does not settle error state") was *technically* a false positive — the existing code did handle the abort correctly via the catch block. But the fix (switch to `AbortSignal.timeout`) was still strictly better: fewer moving parts, no manual `clearTimeout`/`setTimeout` bookkeeping, and it happens to also be unambiguous to every static analyzer that will ever look at this function again. When a heuristic false-positive has a clean structural fix available (not a suppression comment, not an `// eslint-disable`), take the fix — it's not "giving in to the linter," it's removing an entire class of future false positives for free.

### 4.5 New angle: cost tracking is now a real, non-hypothetical line item
With Dim-0 live, every full analysis now costs one additional cheap completion (~$0.00015–0.00035, cascade-dependent) the first time it's viewed. This is small per-unit but is the first "metered LLM cost that isn't the main synthesis" in the system, and it's a preview of the shape future features (chat turns already meter this way) will take as the product moves toward the pre-sales/pilot billing model mentioned in the standing product context. Worth a line in whatever cost-per-analysis tracking exists (none was found/verified this session — not investigated, flagging as unknown rather than absent).

### 4.6 New angle: `docs/architecture-index.md` is significantly stale
Spot-checked while orienting for this handover: it's versioned 1.0.0, dated 2026-05-19, and describes an architecture (all-Vercel-serverless, no Cloudflare Worker streaming, old rate-limit file path `web/lib/rate-limit.ts` which is superseded, old model chain) that predates the current Hybrid Edge Architecture (ADR 005) entirely. **Not touched this session** — a full rewrite is out of scope for a security/feature session and risks introducing new inaccuracies without a dedicated architecture-verification pass. Flagging so it isn't mistaken for current.

---

## 5. System Docs Updated This Session

| Doc | What changed |
|---|---|
| `.memory/ADRS.md` | Appended ADR 008, 009, 010 (this session's decisions), in the established `[DECISION]` line format. |
| `CLAUDE.md` | ADR ledger table (§3): backfilled missing ADR 006 (Structured JSON Streaming) and ADR 007 (Stuck-Analysis Reaper) rows; added new ADR 008, 009, 010 rows. Version bumped in the title. |
| `.memory/AGENT_LEDGER.md` | Appended this session's `[DONE]` entries per the mandatory ledger protocol (CLAUDE.md §2 / AGENTS.md). |
| `.memory/lessons.md` | Appended lessons 9–12 (service-client ownership sweep gap, two-layer IDOR fix pattern, heuristic-hit-with-clean-fix pattern, branch-collision check). |
| `docs/history/INDEX_HANDOVER_VERSIONS.md` | Added this handover to the "Current State (LATEST)" section. |
| `docs/history/HANDOVER_2026-07-07-CHAT-SECURITY-AND-DIM0.md` | This file — new. |

**Not updated (deliberately, with reasons in §4.6)**: `docs/architecture-index.md` (stale but out of scope), `docs/PRD.md`/`docs/ROADMAP_MVP_2_0_TO_3_5.md` (not reviewed for accuracy this session — no claim made about their current correctness either way).

---

## 6. Verification Run Results (aggregate across #125, #126, #127)

- **Typecheck**: `tsc --noEmit` — 0 errors on every commit that reached `main`.
- **Tests**: vitest — 4 (chat gate) + 7 (digest use case) = 11 new/changed test cases, all passing; full suite not re-run in aggregate this session (only targeted files per PR, per the established workflow) — **if a full-suite regression check hasn't been run since `192bc14` (#124), that's worth doing once, not because anything specific is suspected, but because it hasn't been done in a while.**
- **Lint**: ESLint clean on all changed files (targeted).
- **qa-intel** (repo root, full ruleset): 0 HIGH on `main` HEAD (`eab4984`); remaining findings are pre-existing MEDIUM "monolithic file" notes on `DashboardContainer.tsx`, `SupabaseAnalysisAdapter.ts` (both grew slightly this session but were already over the 500-line threshold before it — not newly introduced debt, just slightly deepened).
- **CI**: all three PRs merged with every required check green (Lint, Type Check, Build, Security Check, CodeQL, Worker TypeCheck, Pipeline Status). Advisory/non-required checks (DeepSource JS analyzer, Codacy, CodeFactor, cubic) showed style/complexity nits on all three PRs — triaged individually per-PR, real ones fixed (see §1.1–1.3), cosmetic ones explicitly skipped with reasons recorded in PR comments rather than silently ignored.

---

## 7. Git Action

- **Target**: `origin/main`
- **Merged** (squash): `86d87fe` (#125), `ecf6a3d` (#126), `eab4984` (#127)
- **Local `main`**: synced to `eab4984` (`git fetch origin main && git reset --hard origin/main`)
- **Backstop crons**: all three (`e9929d7c`, `48b5d5f5`, `c9b1421f`) created and cleaned up (`CronDelete`) after each respective merge — none left dangling.
- **Untouched branch**: `claude/full-spectrum-re-audit-qzk3kw` still carries its original 2 unmerged reaper-related commits, exactly as found — not force-pushed, not rebased, not merged by this session.

---

## 8. Open Follow-Ups (tracked + untracked)

**Tracked (task list, current status as of the §9 reconciliation pass)**:
- #58 — Full chat red-team / identity-defense orchestration layer (explicitly the larger follow-on to #125/#126; user said "for the time being we need the minimum" — this is that minimum; #58 is the rest).
- #64 — Service-client ownership-check sweep (created during §9; see §9.6/9.7 and §4.1 — was untracked at the time §4.1 was originally written, is now tracked).
- #52, #53 — Mobile bottom nav, KG node-scaling refinement (unrelated pre-existing backlog, untouched this session; #53 is a distinct, still-open complaint about the same KG component that #29 — now closed — used to also cover).
- #34, #36–39, #43–44, #46, #55–56 — pre-existing backlog, untouched. (#23 was in this list originally but is now closed — see §9.3 — do not treat it as still open.)

**No longer untracked** (was listed as such before the §9 pass; now has a task): the service-client ownership-check sweep is #64.

**Still genuinely untracked**:
- Full-suite vitest regression run (§6) — recommend running once as a health check, not urgent.
- `docs/architecture-index.md` staleness (§4.6 / §9.6) — recommend a dedicated architecture-doc-refresh session rather than an incidental fix.

---

## 9. Preflight & Reconciliation Pass (same session, after §1–§8 landed)

After the chat-security and Dim-0 work merged, a separate instruction was given: do a preflight over the **entire multi-day session** (not just this handover's slice of it), stop treating any doc as source of truth, verify claims against real code, and reconcile the task tracker. This section is the record of that pass — it is not a restatement of §1–§8, it is new work on top of it.

### 9.1 Method
- Read the full raw session transcript (`/root/.claude/projects/-home-user-hex-yt-intel/3bd1a140-fefd-5748-9b1d-01de68e90929.jsonl`, ~5,000 lines / 16MB) rather than relying on my own earlier compacted summary of it.
- Cross-referenced against `git log --oneline main` directly (337 commits on `main` at the time of the check) to confirm which claimed "waves"/PRs actually landed, with real SHAs and dates — not narrative recollection.
- For every task-tracker item in a "pending" state, spot-checked the actual file(s) it referred to with `Grep`/`Read` before accepting or changing its status. Nothing was marked complete or left pending on the basis of a doc's claim alone.

### 9.2 What the git-log cross-check confirmed (no discrepancy)
- PR #106 (`c18848e`, merged 2026-07-04) is a large squashed cluster covering the Wave A–G security/audit work, the qa-intel engine rebuild, RLS/perf migration, CodeQL crypto fix, and Node/pnpm upgrades described in tasks #1–18. Confirmed real via `git log --ancestry-path` between `b054632` (#98) and `c18848e` (#106) — dozens of granular commits from 2026-06-25 through 2026-07-04 substantiate it. Task list #1–18 is accurate.
- PRs #107–#127 (worker bundling fix, qa-intel secrets rule, history overview increments, mobile fixes, chat security, Dim-0) all have real merge commits on `main` with matching dates (2026-07-04 through 2026-07-07). Task list entries referencing these are accurate.

### 9.3 What the code-level spot-check found WRONG in the tracker (corrected)
Four tasks were marked "pending" as if the underlying feature didn't exist, when in fact it already did — apparently built in an earlier session (matching `docs/history/SESSION_EXIT_2026_07_01.md`, dated 2026-07-01) whose completion was never reflected back into the tracker:
- **#23** (export "text-dump") — `web/app/api/analyses/[id]/export/route.ts` already renders a fully formatted PDF via PDFKit: title page, tier-gated Table of Contents, per-heading-level font/color hierarchy. Not a text-dump. MD export is a raw `.md` Blob download client-side, which is correct/expected for that format. **Marked complete.**
- **#30** (word cloud rebuild) — `WordCloud.tsx` already implements a real Archimedean-spiral collision-free layout with boundary clamping, and size-by-weight font scaling (`fontSize = 9 + weight*0.8`, clamped 10–15px). Matches `SESSION_EXIT_2026_07_01.md` §1.4 exactly. **Marked complete.**
- **#29** (KG nodes rendering without labels) — `KnowledgeGraphCanvas.tsx` already conditionally renders labels (always for active/neighbor/high-weight nodes, others past a zoom threshold) — a deliberate anti-clutter design from the same 2026-07-01 Obsidian-style rework, not an unaddressed bug. **Marked complete** — but noted that task #53 (KG node circles too large, weight→size scaling too flat) is a **distinct, still-open** complaint about the same component; don't conflate the two.
- **#31** (mind map connector anchoring) — `MindMap.tsx` computes real per-node coordinates and renders cubic-bezier connector paths between them; not a stub. **Marked complete**, with the caveat that this was verified by reading the code, not by rendering it in a browser — if a user still reports visibly broken/floating connectors, that's new information, not a reason to distrust this note.

### 9.4 A confirmed regression, not just staleness — the important one
`.memory/AGENT_LEDGER.md` contains a `[DONE]` entry from **2026-06-19** claiming: *"Created TimestampLink component for clickable HH:MM:SS in dimension content. Wired into DimensionDrawer and StreamingGrid."*

`grep -rl "TimestampLink" web` returns **nothing**. The component does not exist anywhere in the current codebase. `StreamingGrid` itself appears to have been superseded by the accordion-based dimension UI described in a later ledger entry ("Wave 1.8.4 — UI Accordion-to-Panel Overhaul"). The most likely explanation: the timestamp-seek feature was built, then silently dropped when the dimension UI was rewritten to the accordion pattern, and nobody went back to update the ledger to reflect the loss.

**This is the concrete, verified proof of the instruction not to trust docs as SSOT.** Task #39 ("Video time-seek UI (jump video from dim/chat markers)") remains open in the tracker — correctly — but is now annotated to say this needs a **fresh build**, not a restore, since whatever existed before is simply gone. The general lesson (a ledger `[DONE]` line is not permanent proof the code still exists — later refactors can drop earlier work without anyone updating the record) is now written into `.memory/MEMORY.md` and `.memory/project_status.md` as standing guidance for future sessions.

### 9.5 What was spot-checked and confirmed genuinely still pending (no change needed, but verified rather than assumed)
- **#43** — `web/scripts/pr-review-workflow.sh` read directly: still a theatrical stub (hardcoded `PR_ID=21`, bare `sleep 600` / `sleep 900` calls, no real review logic).
- **#44** — `SupabasePersistenceAdapter.ts` confirmed still writing both `analysis_markdown` and `analysis_payload` on every persist (dual-write, not yet normalized).
- **#52** — grepped broadly for any bottom-tab-bar pattern across `web/components`; only a drawer-style mobile nav (`setMobileNav`/`MobileNav` in `DashboardLayout.tsx`) exists. Confirmed absent, not a naming mismatch.
- **#55** — `AnalysisHistory.tsx` has an in-code comment marking exactly where the amber "thin/insufficient-data" tier needs to hook in; confirmed not implemented yet.
- **#58** — confirmed `CHAT_PROTOCOL` has only the minimum identity/jailbreak-refusal line shipped in PR #125; no broader orchestration/logging/escalation layer exists yet.
- **#36–39** (transcript-store epic) — confirmed no ephemeral-store, TTL-purge, or persisted-seek-marker code exists anywhere (a loose grep hit on `WorkerIngestionAdapter.ts` was a false positive — just a normal `fetch-transcript` call, unrelated to the epic).

### 9.6 System docs rewritten on this evidence (separate from the §5 table, which only covered the chat-security/Dim-0 doc updates)
| Doc | What changed | Commit |
|---|---|---|
| `.memory/project_status.md` | Full rewrite. Previously described a 2026-05-12-era state (PR #62, Cloudflare-subdomain consolidation, "PLATINUM READINESS") with zero relevance to the current system. Replaced with a theme-grouped, code-cited current-state snapshot: what's live, what's confirmed still open, the `TimestampLink` regression, known-stale docs explicitly flagged (not fixed) rather than silently ignored. | `c00eae5` |
| `.memory/MEMORY.md` | Trimmed from a stale narrative down to a lightweight index (matching its own stated purpose) pointing at `project_status.md`, this handover, `CLAUDE.md`, `ADRS.md`, `AGENT_LEDGER.md`, and `lessons.md`, plus a short list of standing rules re-verified as still true. | `c00eae5` |
| This handover doc | Updated header/TL;DR and added this §9. | (this edit) |

**Not rewritten, deliberately flagged instead**: `docs/architecture-index.md` (stale since 2026-05-19, describes a pre-Hybrid-Edge-Architecture system — needs its own dedicated session, not an incidental patch during a reconciliation pass); `docs/PRD.md` and `docs/ROADMAP_MVP_2_0_TO_3_5.md` (not reviewed for accuracy — no claim made either way, don't assume current or stale).

### 9.7 Task tracker state after this pass
49 completed / 15 pending (was 47/17 before this pass — net +2 completed from real fixes found, +2 reclassified from "already done but uncredited" to completed, with #39 re-annotated rather than closed, plus #64 newly created). The 15 pending items are listed by theme in `.memory/project_status.md` §4 — that table, not this prose, is the one to keep current going forward.
