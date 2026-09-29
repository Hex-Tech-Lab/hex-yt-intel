# Agent Dispatch Prompt — THOS / LLM handover: CC session 2026-09-29 (96h audit → R0–R2 done, R3/R4 in flight)

**Target Agent**: CC (Claude Code), next session, as orchestrator/auditor
**Effort Level**: high

**Read this first.** Repo `~/projects/hex-yt-intel`. Written 2026-09-29T20:00Z by CC (Claude Code, Opus 5.5) at session clear.
**`origin/main` is the source of truth**: currently `3d56b059` (#367). The **local `main` checkout is STALE and DIRTY**. It is 8+ commits behind origin, carries 4 local-only commits (now cherry-picked into PR #369), and holds a quarantined dirty tree of about 25 files from other agents (backed up to `.memory/wip/2026-09-29-dirty-tree.patch`). **Do not commit from it and do not trust greps in it.** Use worktrees off `origin/main`.
Audit report (HTML): https://claude.ai/artifact/Le3vAmQY4T5PZhWFFcpFNU

---

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

---

## 1. Context & Problem Statement

### 1.1 MISSION CONTEXT (active workstreams)

- **The 96-hour audit** (user-requested, start of session) found 10 issues (2 P0, 5 P1, 3 P2) in the Layer-2 / "5-layer Jev" work of the previous 4 days. The Master Orchestrator (the user, pasting "CCT DIRECTIVE" blocks) turned it into sequential phases: **R0** stopgaps → **R1** contracts/DB/security → **R2** backend routing + persist-ACK → **R3** Layer 0 Jev engine → **R4** UI hydration. Two additions along the way: **R1e** (8.4 hybrid), **R1f** (quota paradox). **R5** (downstream consumers / chat filtering) was deferred.
- **Roles:** CC = orchestrator/auditor/verifier (owns merge sign-off; writes code itself after an OC two-strike). **OC** (opencode, GLM-5.3-flash) = executor, watched live. External reviewers (pasted by the user) plus CodeRabbit/Cubic in CI.
- **R0–R2 are DONE and in production. R4 is running in OC. R3 is split: R3a turned out to be a no-op; R3b needs user decisions (ADR 037).**

### 1.2 CONFIRMED DECISIONS / STANDARDS (this session)

- **Epistemic split (UCIS v5.4):** grounded (Bundle A) = dims 1–7, **8.1, 8.2**, 10. Projective (Bundle B) = **8.3, 8.4**, 9, 11. Bundle map (Settings Registry `analysis.streamBundles`, single source of truth): `[1,10] [2,4,6] [5,7] [3,8]` grounded, `[9,11]` projective. `TOTAL_STREAMS` stays 5.
- **8.4 is hybrid:**
  - speaker-named resources first, from grounded `explicitSpeakerResources`, which is intermediate and stripped at stitch;
  - then 2–3 external recommendations after a standalone line `> [EXTERNAL_PROJECTION]`;
  - the UCIS 8.4 text is the user's exact wording plus the delimiter line.
- **R2b design, approved (ADR 005 stands, the worker has NO DB):** Vercel reads the PERSISTED grounded chunks, HMAC-signs `prior_payload` (purpose `projective-context`, bound to analysisId + exp + projective dims + sha256(payload)), and the worker verifies. `/projective-context` returns 409 until every grounded chunk is persisted. The user explicitly rejected "the worker reads the DB with a service key".
- **R2a retry is synchronous:** `/retry` runs `remediateAnalysis` in-request (maxDuration 300 s), so the UI awaits the response and there is no polling (user-approved).
- **ADR 012 upheld:** no transcript re-fetch to heal old rows. Of 15 `completed`+`partial` legacy rows, only the 3 with 11/11 dims were relabelled `validation_report.status='done'` (ids 37dede0b, adcf3290, 47cf53d3). Billing was untouched, and the other 12 are left as artifacts. **The status value convention is `done`, not `complete`.**
- **OC model standard v4 (user):** default `glm-preset/@preset/glm-53-flash-on-cheap`, the user's server-side preset (Modal → BaseTen → InferenceNet → OpenInference, minimal reasoning, cache 3 h). No client body `provider` override. The three config files are a byte-identical UNION including other sessions' providers (`glm-mbio` etc.). Plus `limit {context 110000, output 16000}`, `X-Title: OC-hex-vIntel`. **Always launch `opencode run "…" </dev/null`** (without it, runs hang silently). Launch from `~/projects` so sibling worktrees are in scope. **Tell the user whenever the OC model/config changes.**
- **Two-strike cutoff (user):** watch every OC run live (log + worktree `git status`/diff every ~4–5 min); kill on drift; relaunch once with a precise correction; **on strike 2, CC takes the task over.** Saved in memory `oc-two-strike-cutoff`.
- **Merge rules:** CC merges small fixes on green CI. Big behaviour changes need an explicit user go-ahead. **CodeRabbit rate-limit rule (user): if it says more than a few minutes, don't wait.** Cubic is over its monthly limit until 2026-09-30. Log each waiver in the ledger.
- **Reports as HTML** (memory `reports-as-html`); pnpm only; ledger protocol on every task.

### 1.3 WHAT WAS DONE (chronological, verified)

| PR | Merge | What |
|---|---|---|
| #361 | e7576eeb | **R0**: disabled "Retry Missing" (it returned `cache_hit`, a dead button) |
| #362 | ef86a077 | **Hotfix**: `dedupedFetch` aborted the shared request after headers, killing the body, so the panel showed "No highlights yet" and Check Status was dead. Fix: abort only pre-settle. Also: the qa-intel StreamResilienceRule now skips test files |
| #363 | 11fcc920 | **R1**: bundle-map single source (registry), 8.3 projective split, `analyses` column-grant lockdown (authenticated UPDATE only `shared_token`, `shared_expires_at`), `prior_payload` Zod + 64 KB ceiling (client value is unsigned) |
| #364 | c87299ec | **Revoke `authenticated` DELETE on `analyses`**: deleting your own completed rows reset `reserve_analysis_quota` (a P1 quota bypass) |
| #365 | 8d99f893 | **R1f**: quota-safe free cleanup (cron **and** the trigger `trigger_delete_old_analyses` now use `created_at < least(now()-30d, date_trunc('month'))`); SECURITY DEFINER audit clean; `service_role` DELETE assertion |
| #366 | f417c7c2 | **R1e**: 8.4 → projective + `> [EXTERNAL_PROJECTION]`; stitch 8.1→8.4, replaces legacy 8.4, never above 8.1 |
| #368 | 035a232b | **R2b**: `/api/analyses/[id]/projective-context` + signed context + worker verification; review hardening (dup/projective dims rejected, 1024 floor, no mixed bundles, stored fallback removed); migration `20260929180000` (2 wait keys) |
| #367 | 3d56b059 | **R2a**: `POST /api/analyses/[id]/retry` → `RetryMissingDimensionsUseCase` (owner-first, cron-matching eligibility `failed`+`partial`, requested ∩ missing, explicit `[]` = nothing, kill switch → 503, auth before body, malformed JSON → 400, one budget snapshot); **the cron now takes the same per-row lock `retry:analysis:<id>`** |

- **Every migration is verified live:** `20260929120000` … `20260929180000`, all recorded at their exact versions. Grants were verified with `has_column_privilege` / `has_table_privilege`, using negative + positive controls in rolled-back transactions against prod.
- **Every prod pipeline succeeded** (#361–#368 and #367); deploys verified.
- **OC scorecard today:**
  - Clean on the first try: **R1c only**.
  - **Taken over by CC** after strikes: R1a, R1b, R1d, R1e, R2a, R2b (hangs, a hallucinated macOS/Dart project, the `/home/kellyb-dev` hyphen typo killing runs, qa-intel suppression hunting, deleted tests, 20-min read-only stalls).
  - **Recurring OC defects to watch:** deleting or weakening tests, gate-gaming (empty `finally`, `slice` → `replace`), drive-by churn, `git stash` in a worktree, sourcing `.env.local`, `supabase link`.

### 1.4 CURRENT WORK (in flight at handover)

1. **R4 (OC) — RUNNING** in `/home/kellyb_dev/projects/hex-yt-intel-r4` (branch `fix/r4-ui-hydration`), log `/tmp/claude-1001/-home-kellyb-dev-projects-hex-yt-intel/498d50ae-8aef-4fef-9586-7bc1348c2b32/scratchpad/oc-r4.log`. Prompt: `docs/agent-prompts/2026-09-29-oc-r4-ui-hydration-retry.md`. Nothing committed yet; it was iterating on one failing test. Touched: `useInputStore.ts`, `DashboardContainer.tsx`, `AnalysisHistory.tsx`, plus 2 new tests. **Verify:**
   - T1: `?v=` applied at store hydration (`onRehydrateStorage`/`merge`); the mount effect is deleted; the replaceState mirror is kept.
   - T2: the Retry button is wired to `/retry`, awaits the response, then `refetchHistoryOverview()`, with toasts per status, keyboard Enter/Space not bubbling to the row, and the R0 test updated **deliberately**.
   - T3: no partial warning while `analyzing`; `incomplete` handled like `partial`; WIP card label reads "Partially complete".
   - **The scratch file `web/lib/__tests__/zz-dbg.test.ts` must NOT be committed** (it seems deleted already; re-check).
   - It's one strike so far only if it drifts; on the 2nd bad run, CC takes it over.
2. **PR #369** (`chore/oc-standard-and-adr037`, worktree `/home/kellyb_dev/projects/hex-yt-intel-docs`): the 4 stranded OC-standard commits, the ADR 037 ledger row, **and this THOS**. CI was green except 1 pending. **Merge it**: until it's in, no other agent's worktree has the OC rules.
3. **R3b: BLOCKED on user decisions** (ADR 037, Proposed). File: `docs/private/ADR_037_JEV_SEMANTIC_CHUNKING_VARIANCE_BOUNDARIES_2026-09-29.md` (gitignored; the row lives in the CLAUDE.md ledger). **ADR 035 is taken (Tiered Compute Depth), hence 037.** Conflicts recorded:
   - today's 5 streams are *dimension bundles*, each reading the whole transcript, so a variable Jev-chunk count means map-reduce;
   - `processing_jobs` does not exist;
   - `prior_payload` is the wrong carrier;
   - the R2b gate and the persist/finalize/reaper paths all change.

   Needs the user to choose **(A)** map-reduce, **(B)** budget-aware chunk selection instead of truncation, or **(C)** chapters/highlights first, and to confirm the CDI heuristic. CC recommends a pure engine plus (B) or (C) first. **Do not dispatch R3b until the user answers.**
4. **R3a: a NO-OP on `origin/main`.** `PipelineRouterService`/`pipelineMode` were never committed; they exist only in the quarantined dirty tree of the main checkout. **Open question to the user:** may CC discard that quarantined tree (backup exists)?

### 1.5 KEY FILE MAP

- **Bundle map / split:** `web/lib/config/synthesis.ts` (`STREAM_BUNDLES`, `assertBundlePartition` incl. no-mixed-bundle, `PROJECTIVE_DIMENSIONS=[9,11]`, `PROJECTIVE_SUBDIMENSIONS=['8.3','8.4']`, `isProjectiveBundle`). Registry resolution lives in `web/lib/usecases/CreateAnalysisUseCase.ts` → `job.streamBundles`.
- **Prompt:** `worker/src/services/PromptBuilder.ts` (EPISTEMIC MODE after the cached `sharedPrefix`; grounded dim 8 → 8.1/8.2 + `explicitSpeakerResources`; projective → `crossDomainBridges` + `discoveryPathways`). UCIS text: `web/lib/prompts/ucis-v5.4.ts` (8.4 + delimiter).
- **Stitch:** `web/lib/services/stitch-analysis-chunks.ts` (8.3/8.4 insertion, cap `analysis.layer2.crossDomainBridgesMaxChars`, strips `explicitSpeakerResources`).
- **prior_payload:** `web/lib/config/prior-payload.ts` (schema, `resolvePriorPayloadMaxBytes` floor 1024 / ceiling 65536, `fitPriorPayloadToCap(dims, cap, resources)`). Signed context: `web/lib/config/projective-context.ts` (shared web + worker), `web/lib/usecases/ProjectiveContextUseCase.ts`, route `web/app/api/analyses/[id]/projective-context/route.ts`, signer `web/lib/stream-token.ts#signProjectiveContext` (via `CryptographicTokenPort`), worker gate in `worker/src/routes/analysis.ts` (after `verifyStreamToken`, before the R1d guard). Client: `web/hooks/useSSEStream.ts` (`fetchProjectiveContext`, polls on 409).
- **Retry:** `web/lib/usecases/RetryMissingDimensionsUseCase.ts` (`decideRetryTargets`, pure), route `web/app/api/analyses/[id]/retry/route.ts`. Shared lock constants and the cron in `web/lib/services/dimension-remediation.ts` (`REMEDIATION_ROW_LOCK_*`). Route-contract tests: `web/lib/__tests__/retry-missing-route.test.ts` (**`app/api/**` tests are allowlisted per route in `web/vitest.config.ts`; put new route tests in `web/lib/__tests__/`**).
- **DB tests:** `supabase/tests/analyses_grants.sql`, `supabase/tests/quota_cleanup_invariant.sql`.
- **Highlights dedupe:** `web/lib/utils/dedupe-fetch.ts`.
- **Prompts dispatched:** `docs/agent-prompts/2026-09-29-oc-*.md` (r0, r1a–r1e, r2a, r2b, r4, hotfix).
- **Ledger:** `.memory/AGENT_LEDGER.md` (CC entries all through today, incl. waivers).

### 1.6 STANDING RULES (don't re-learn)

- **Verify, don't trust:** read the actual diff; run gates yourself; negative-control every fix (revert → test must fail → restore). A test that passes without the fix proves nothing (it happened: the 1024-cap test, and a vacuous `indexOf('Grounded content.')`).
- **qa-intel:**
  - Run `--ci --compare` **after `git add`**, because the scanner only sees tracked files. CI failed twice on untracked-then-committed new files.
  - A touched file re-surfaces ALL its pre-existing findings. Fix new-code findings properly; baseline pre-existing ones visibly, **only after confirming they exist on main**.
  - Never dedupe `.qa-intel/baseline.json` when resolving conflicts: main has intentional duplicates. The correct resolution is main's file unchanged + the branch's appended entries.
- **Supabase MCP OAuth broke mid-session.** Fallback, per CLAUDE.md: the Management API `POST https://api.supabase.com/v1/projects/adnmbikaqnxivalqoild/database/query` with `SUPABASE_ACCESS_TOKEN` from the ROOT `.env.local` (never print it). Reads, plus writes only in rolled-back transactions (`raise exception` at the end to force the abort), except user-approved data fixes.
- **Chunk indexes are 1-based** (`chunk_index = bundle index + 1`); `analysis_chunks` also stores `dimensions_covered`.
- **The worker test `worker/src/__tests__/prompt-cache-request-shape.test.ts` DOES run** in the full web vitest suite (only a single-file run fails on the `@/` alias). Earlier "unverified" notes in #363 were wrong.
- **`web/test-results.json` is tracked and rewritten by every vitest run:** `git restore` it before rebasing or committing. `web/next-env.d.ts`, `web/AGENTS.md` and `web/CLAUDE.md` are build strays; never commit them.
- **Mixed-version deploy window:** the Worker deploys before Vercel. Check for analyses created in that window after contract changes.

### 1.7 LAST 4 USER MESSAGES (verbatim)

**(1, the handover request)**
> Create a THOS from LLM handover because I need to clear the session, it's getting huge. But ensure that it has everything for immediate continuity and it doesn't miss anything critically. use the template

**(2)**
> The catch on `done` vs `complete` for the legacy rows is exactly why you hold the keys. Forcing a non-enum state into the DB would have triggered a cascade of validation errors. Acknowledged and approved on the R4 synchronous retry endpoint—eliminating the polling loop is a much cleaner state machine.
> You have correctly identified a "Phantom Architecture" gap. The design for the Jev Sliding-Window Chunker, Fluff Ratio, and CDI existed only in our orchestration discussions and was never committed to the repository's ADR log. The collision on ADR 029 is a documentation artifact from a previous pivot. We will formalize this now.
> ### INITIATE PHASE R3a (Dead Code Purge) — Dispatch OC immediately to execute R3a. Rip out the unused `PipelineRouterService` and its hardcoded constants. We are clearing the blast radius for the real engine.
> ### PHASE R3b: The Jev Semantic Boundary Engine (Design Spec) — author this as **ADR 035: Jev Semantic Chunking & Variance Boundaries** before dispatching OC to build it.
> **1. The Problem with Naive Chunking** — Splitting a 60-minute transcript into arbitrary 5-minute chunks creates "semantic shearing"—cutting sentences, thoughts, or step-by-step systems in half, severely degrading Bundle A's extraction accuracy.
> **2. CDI (Conceptual Density Index) & Fluff Ratio** — Instead of time, we measure information density using a sliding NLP window (e.g., N=100 words). CDI = Target Keywords (Nouns, Entities, Acronyms) / Total Words in Window. Fluff Ratio: Sections with high filler words, sponsor reads, or intros (where CDI < 0.05).
> **3. The Variance Boundary Math** — ΔCDI = |CDI(W_t) − CDI(W_{t−1})|. When ΔCDI spikes above a configurable threshold τ (e.g., a transition from a sponsor read to a dense technical tutorial), it signals a semantic shift. The system marks these high-variance points as Boundary Candidates. The final chunk boundaries are snapped to the nearest Boundary Candidate that keeps the chunk size between `MIN_CHUNK_TOKENS` and `MAX_CHUNK_TOKENS`.
> **4. Variable Stream Count & State Mechanics** — Because chunks are determined dynamically by semantic boundaries, the total number of chunks (and thus, streams) is variable (e.g., between 1 and 8). The Contract Update: The exact `stream_count` determined by the Jev engine must be injected into the signed `prior_payload` and the database `processing_jobs` table. The Reaper & Finalizer: The finalize step must now check `received_chunks.length === job.stream_count` rather than a hardcoded `5` before triggering Bundle B.
> ### CCT DIRECTIVE: EXECUTE R3 — 1. R3a: Dispatch OC to delete the dead code. 2. ADR 035: Author and commit the ADR based on the design spec above. 3. R3b: Dispatch OC to build the Jev Semantic Boundary Engine, injecting the required coefficients (Window Size, CDI Threshold, Min/Max Chunk Tokens) into the Settings Registry. Execute R3a and draft the ADR. Let me know when R4 reports back from OC.

**(3)**
> # CCT DIRECTIVE: ADR 012 UPHELD & PHASE R3/R4 INITIATION — You just saved us from a self-inflicted data corruption event… DECISIONS ON THE 15 LEGACY ROWS: 1. Relabel the 3 Complete Rows: Yes. Run a surgical SQL update to correct their `validation_report.status` to `complete`. Do not alter their billing status. 2. Uphold ADR 012 (No Re-fetches): … Leave the 1 broken row, the 9 superseded copies, and the 2 old-format rows alone as historical artifacts. Do not trigger the cron for them. CURRENT DIRECTIVE (INITIATE R3 & R4) — TASK 1: Phase R3 (Layer 0 Jev Engine): Dispatch OC … Delete the dead `PipelineRouterService`. Move the 14 hardcoded Layer 0 tunables … into `setting_definitions`. Implement the actual sliding-window chunker and variance boundary engine. Ensure the variable stream count is properly integrated into the signed job contract (persist, finalize, and reaper). TASK 2: Phase R4 (UI State Hydration): Dispatch OC … Fix the `?v=` hydration race condition … Wire the history "Retry" button to utilize the newly merged server-side endpoint and appropriately poll for completion status. CCT Gate: Execute the label fix for the 3 rows. Confirm #367 has merged. Dispatch OC for Phase R3 and R4, and rigorously test the chunk boundary math before authorizing the R3 PR.

**(4)**
> [#366 external review pasted: P1 named resources depend on R2b; P2 8.4 cap can truncate the marker/recommendations; P2 marker not runtime-validated; missing-context test case] + "tell me which feedback you got from me? which PRs?" + # CCT DIRECTIVE: MERGE R2 & RETROACTIVE HEALING PROTOCOL — Merge #368 first, then #367. Retroactive healing: downgrade `status='completed'` rows with dimensions < 11 to `partial` and reset `billing_status` so the cron heals them. (**Not applied**: the rows have no transcripts, per ADR 012, and the column names were wrong. See §2.)

---

## 2. Contract & Implementation Directives

**Contract for the next session:** resume exactly where this one stopped. Nothing gets merged without your own verification (diff read, gates run, negative control). No R3b build without the user's ADR 037 decisions. No commits from the stale local `main` checkout.

1. **Read `.memory/AGENT_LEDGER.md` (tail) and this THOS.** Work only from worktrees off `origin/main`.
2. **R4:**
   - check the OC log above and `git -C /home/kellyb_dev/projects/hex-yt-intel-r4 status`;
   - if finished, review the diff line by line (the T1/T2/T3 contracts in §1.4), run the gates yourself, and run the negative control;
   - make sure `zz-dbg.test.ts` and the build strays are absent;
   - push and open the PR; merge only after user review (it's UI behaviour).
3. **PR #369:** confirm CI and merge (it carries this THOS and the OC rules).
4. **R3b:** wait for the user's ADR 037 decisions: A/B/C, the CDI heuristic, and bake-off thresholds. Then write a TEMPLATE-based OC prompt for the **pure engine only** first, test the six invariants in ADR 037 (determinism, coverage, bounds, no sentence split, degenerate inputs, monotonic τ), and property-test the boundary math.
5. **Ask the user:** (a) may CC discard the quarantined dirty tree in the main checkout (backup `.memory/wip/`)? (b) After that, fast-forward local `main` to `origin/main`.
6. **Follow-ups logged, not started:**
   - **(i)** 8.4 when neither resources nor transcript are available: don't claim "none named".
   - **(ii)** 8.4 shares the 8.3 cap and can truncate the marker: reserve budget for it.
   - **(iii)** R5: chat (ADR 008) must cut 8.4 at `> [EXTERNAL_PROJECTION]` or label what follows; also review entity seek (ADR 022).
   - **(iv)** `dedupedFetch`: per-caller body cancel on abort after settle; status-chip regression test.
   - **(v)** Pre-existing bug: `web/app/api/analyses/highlights/route.ts` publicToken branch filters `.eq('share_token', …)`, but the column is `shared_token`, so public highlights always return 401.
   - **(vi)** Remediation of highlights/digest/KG/comments ("R2.5"): the 5-min sweep should check every component, highlights first, including completed rows.
   - **(vii)** Split the `useSSEStream.ts` monolith (ADR 032).
   - **(viii)** Cubic resumes 2026-09-30; CodeRabbit is often rate-limited.
7. **Stale worktrees to clean up when safe:** `hex-yt-intel-r1` (merged), `hex-yt-intel-r1e` (merged), `/tmp/opencode/wt-l2` (old Layer-2 WIP). Also AGY/kilo worktrees that are not ours.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

> **ENFORCEMENT**: Match touched files against the tree below. Execute ALL matching skills before CI/PR. Document findings under `### Skills Run + Findings`.

- **ALWAYS (All PRs)**:
  - `/simplify`: Prune AST dead code, strip unused imports/bindings.
  - `review-delta`: Verify clean git diff (no logs, no transient scratch files).
  - `review-duplication`: Scan AST clones to block CodeFactor regressions.
  - `code-reviewer`: Adversarial check against invariants & contract gaps.

- **IF `web/components/**` | `web/hooks/**` | `web/app/**` (FE / UI)**:
  - `/react-best-practices`: Hook deps, stale closures, SSR hydration, layout stability.
  - `fe-state-auditor`: Enforce browser singletons (GoTrueClient), audit Zustand store lifecycle.
  - `accessibility-a11y`: WCAG compliance, keyboard focus traps, ARIA parity.
  - `bundle-analyzer`: Dynamic import boundaries (`next/dynamic`), CSS injection overhead.

- **IF `worker/**` | `web/app/api/**` | `*ports*` | `*adapters*` (BE / API)**:
  - `contract-auditor`: Strict Zod `safeParse`, retain typed `.data`, flag raw pass-throughs.
  - `api-route-guard`: Response status contracts (200 on empty vs 4xx/5xx) to stop retry storms.
  - `worker-port-adapter-audit`: Hexagonal isolation (zero direct infra dependencies in domain).
  - `idempotency-check`: Webhook/queue deduplication keys, replay attack tolerance.

- **IF `*billing*` | `*Paddle*` | `middleware/**` | `auth/**` (Security / Billing)**:
  - `/owasp-top-10`: Parameter injection, broken access control, CORS, input sanitization.
  - `sentry-privacy-auditor`: Redact PII, tokens, and raw payloads in Sentry `extra`.
  - `webhook-signature-verifier`: Constant-time signatures (`timingSafeEqual`), replay skew guards.
  - `secret-scanner`: Zero hardcoded credentials, JWT-like string literals, or dummy secrets.

- **IF `*stitch*` | `*synthesis*` | `*relations-engine*` | `*prompts*` (KG / Pipeline)**:
  - `build-graph`: Topological sorting, DAG integrity, prune dangling edges.
  - `entity-canonicalizer`: Case-insensitive POLE+O mapping & legacy type retention.
  - `transcript-pipeline-audit`: Strict numeric timestamps, nearest-match epsilon selection.
  - `prompt-boundary-guard`: LLM JSON parse tolerance, streaming safety, token budget limits.

- **IF `scripts/**` | `.memory/**` | `*.config.*` | `.*ignore` (Monorepo / CI)**:
  - `qa-intel`: Run `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare`.
  - `monorepo-path-linter`: Root glob anchoring (`/*.js`) & monorepo ignore scoping.
  - `ledger-protocol-auditor`: Enforce valid `[IN_PROGRESS]` -> `[DONE]` state transitions.

> **Note (CC, 2026-09-29):** this `.memory/TEMPLATE.md` skill list is the older copy. `docs/agent-prompts/TEMPLATE.md` (the verified version, 2026-09-05) records that 14 of these names do NOT exist as installed skills (`fe-state-auditor`, `accessibility-a11y`, `bundle-analyzer`, `api-route-guard`, `worker-port-adapter-audit`, `idempotency-check`, `sentry-privacy-auditor`, `webhook-signature-verifier`, `secret-scanner`, `entity-canonicalizer`, `transcript-pipeline-audit`, `prompt-boundary-guard`, `monorepo-path-linter`, `ledger-protocol-auditor`). Use that file's decision tree when dispatching OC.

---

## 4. Verification & Quality Gates

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

