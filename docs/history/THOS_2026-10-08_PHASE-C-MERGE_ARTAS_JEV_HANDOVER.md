# THOS — 2026-10-08 · Phase C merge, ARTAS v3, Haiku 5.5 + JEV reasoning, OC router

**Session:** CC (Claude Code) as sink orchestrator, with OC (opencode) fleets doing the legwork.
**Read this first** if you pick up hex-yt-intel after 2026-10-08.

---

## 1. State at handover

| Item | State |
|---|---|
| `main` | `4c961adb` (#443). Production pipeline run 37775804469 fully green (migration, Vercel, worker, production health check). |
| `main` later same day | `62cc459a` — #445 (this handover + dead `CombinerPass` removal) merged 2026-10-08 15:58 +03. Open PRs at weekly sync: #446 (Phase C shadow-mode wiring behind `analysis.pipeline.epistemic`), #447 (Jev commit guard from hex-expan), #448 (store server-fetched transcript segments at ingestion), #449 (UAT: metadata counts on restore, history status chips). |
| PR #442 Phase C (RC) | **MERGED** `03c50a5f`. Prod migration `20261005020000_phase_c_epistemic_schema` recorded; all prod jobs + health check green; `/health/providers` all true. |
| PR #443 Haiku 5.5 + per-stream reasoning | **MERGED** `4c961adb`. Migration `20261008120000_analysis_reasoning_effort_settings` applied by CI; rows verified (enum, defaults `none` / `low`). |
| PR #444 OC config unification | **CLOSED unmerged** (user decision: local OC config does not belong in the repo). Its THOS + dead `CombinerPass` deletion moved to `chore/docs-and-cleanup`; the two local `opencode.json` files stay unified (200k, `jev-router/jev-auto`) untracked. |
| Branch `audit/artas-v3` (pushed, no PR) | ARTAS v3 registry + QualityEngine rules + historical audit + cascade-signing WIP patch. Head `3ffa5ed8`. Its CI Lint is expected to go **red** on purpose (user directive: baseline NOT refreshed). |
| OpenRouter balance | **$11.55** (shared with production). The account ran dry once today (OC fleet); see §5. |
| hex-expan | Handover option (A) written to `~/projects/hex-expan/docs/agent_ledger.jsonl` (uncommitted, left for its own agent). hex-expan owns PR #88 follow-ups and PR #90 (`Object.hasOwn`). No code was changed there. |

## 2. What shipped today

1. **CI unblock + UI wave (PR #442).**
   - Worker CORS: localhost trust is gated on production, fail closed (ADR 041). Malformed `Origin` values are rejected before URL parsing.
   - Highlights: fixed the abort loop.
   - Timestamps render as `<button>` seek controls (ADR 042).
   - Resizable desktop panels with per-layout `localStorage` and a Reset button (ADR 042).
   - History chips: removed the text mask.
2. **PR #442 review triage.**
   - 326 threads (181 unique issues) triaged by 5 parallel OC groups in separate worktrees. CC verified, merged and replied; all 474 threads resolved.
   - Real fixes landed with regression tests: Sentry redaction, `{}` rejection, claim-ID dedupe, missing-confidence handling, `00:00` seek, accessible resize handle, oEmbed timeout, and others.
3. **Haiku 4.5 → 5.5.**
   - DB: `cascade.analysis` (value + default) and `app_settings.model_config` switched on 2026-10-08. History is in `setting_values_history` for rollback.
   - Code (#443): `MODEL_CAPABILITIES` + `CASCADE_FALLBACKS`. 4.5 stays allowlisted for rollback.
4. **Per-stream reasoning (#443).**
   - Grounded bundles send `reasoning: {enabled:false}`; projective/combiner bundles send `{effort:'low'}`.
   - Registry keys `analysis.reasoning.grounded` / `.projective` (enum, admin-validated), stamped per tier at resolve time and read only for `cascade.analysis`.
   - `z-ai/glm-5.3-flash` is flagged `reasoningMandatory` and bumped to `low` (OpenRouter returns 400 for disabled reasoning on mandatory models).
   - The worker clamps to `none|minimal|low` because the relayed body is unsigned.
5. **JEV router for OC.**
   - `~/.opencode/jev-router.ts` (Bun, `127.0.0.1:3040/v1`, running in tmux session `jev-router`).
   - Routes < 95k tokens → Haiku 5.5 (reasoning low); ≥ 95k → GLM 5.3 Flash (DeepInfra if `DEEPINFRA_API_KEY` is set, otherwise the OpenRouter preset; no DeepInfra key exists today).
   - Default OC model is `jev-router/jev-auto`. `context` is 200000 on every model entry.
   - The two local `opencode.json` files (`~/.opencode`, `~/.config/opencode`) are unified and untracked; the committed `.opencode/opencode.json` and CLAUDE.md's OC standard were NOT updated (#444 closed).
6. **ARTAS v3** (branch `audit/artas-v3`).
   - `.memory/ARTAS_REGISTRY.md` defines 23 vectors in 5 domains. This is the canonical numbering for both repos; hex-expan's earlier ad-hoc IDs are mapped there.
   - QualityEngine rules `scripts/quality-engine/rules/artas-v3.ts` for V20, V10, V19 and V05, with 19 tests. Hits on current code: V20=33, V19=23, V05=1, V10=0.
   - `docs/reviews/2026-10-ARTAS-HISTORICAL-AUDIT.md` covers PRs #389–#441: 0 P1, 8 P2, 8 P3.

## 3. Open decisions / next work (priority order)

1. **Phase C live wiring** behind registry flag `analysis.pipeline.epistemic` (user decision 2026-10-08) — branch `feat/phase-c-live-wiring`.
2. **Cascade-config signing** (security, P2). `cascade` / `maxOutputTokens` / reasoning stamps reach the worker **unsigned** through the browser.
   - The WIP patch is `docs/reviews/2026-10-08-cascade-config-signing-wip.patch` on `audit/artas-v3`. It adds a new `cascade-config` bound-signature purpose.
   - Needs its own PR + ADR and a **staged rollout** (web sends the signature first, worker enforces it after). Enforcing on the worker first would 401 every analysis.
3. **ARTAS P2 rows** (8, see the audit doc). Three are CC-verified:
   - #413: legacy unbound signature branch, still reachable from `persist` / `chat/persist` when `exp` is absent.
   - #426: v1 tokens choose Route B through the unsigned `dimensions`.
   - #390/392: `req.jevPlan` comes from the unsigned body into the fallback budget.

   Also: #436, absent diarization becomes `speakerCount 0`, which reads as negative multi-speaker evidence and gets no confidence cap.
4. **`generateStream`.** `LLMCascadePort.generateStream` is optional and unimplemented in `LLMCascade`. The Phase C engines cannot run on the real cascade. It is unreachable today (nothing constructs the dispatcher), but it must be built before Phase C (ADR 039 Phases B–D) is wired.
5. **`audit/artas-v3` → PR.** Decide how to land it, given its Lint will go red on 57 existing rule hits (intended as the remediation list).
6. **OC cost.** Nearly every OC turn now bills at Haiku 5.5 rates: OC's own prompt + tools are ~40k tokens, under the 95k threshold.
   - Consider raising `JEV_THRESHOLD_TOKENS` or setting `JEV_SMALL_MODEL` to GLM for routine dispatches.
   - `small_model` is a single global value, so hex-expan's auxiliary calls are attributed to vIntel (documented, deferred).
7. **Bake-off metric caveat.** Routing agreement with mock sensors is an upper bound. Treat the earlier "100% routing match" ledger claim as not established.
8. **YouTube `postMessage`.** `host` + `origin` shipped (`c31d8986`) but were never verified in a real browser.
9. **Local worker dev** now needs `ENVIRONMENT=development` in `worker/.dev.vars` (ADR 041).
10. **Unknown interactive `opencode` session**, PID 292675 (pts/9, started 13:34 in `wt-10x`), makes ~7k-token background calls. Not launched by CC. The user should decide whether to close it.

## 4. Worktrees to clean up (all work is pushed/merged)

`~/projects/hex-yt-intel-wt-442-{g1..g5,int}` (merged via #442) and `~/projects/hex-yt-intel-wt-haiku55` (#443 merged). Keep `wt-occfg` until #444 merges and `wt-10x` (on `audit/artas-v3`). Use `git worktree remove <path>`. Do not `git stash` anywhere (shared stack).

## 5. Lessons learned this session (carry forward)

- **OC stash collision.** One OC run's `git stash pop` grabbed another run's entry, because the stash stack is shared across worktrees. Every OC prompt now says **never `git stash`**; negative controls use a patch file in `.scratch/`.
- **OC launch-dir rejections end runs.** Any `cd` (even `cd ../web`) or writing to `/tmp` is auto-rejected and terminates the run. Use `pnpm --dir` / `--filter` and a `.scratch/` inside the worktree.
- **OC mislabels valid findings as INVALID.** CC overrode 5 such verdicts. Always read every INVALID row before posting replies.
- **Spend guard.** Six parallel OC runs drained the OpenRouter account mid-session; production shares the account. The queue now runs ≤ 2 concurrent and kills everything below $5.
- **Haiku 5.5 via the JEV router** stopped twice to re-ask already-answered questions. Two strikes → CC took the task over.
- **Graph pagination.** A `reviewThreads(first:100)` query undercounts; always paginate (85 vs 326 actual today).
- **QualityEngine quirks.** The observability rule only recognises `console.error` / `Sentry.captureException` written directly in the catch. `.slice` / `.substring` / regex `.exec` in tests trigger false positives, so use `String.match`. Worker tests outside `worker/src/__tests__/` must be added to the include list in `web/vitest.config.ts`.
- **Verify directive premises.** Several pasted directives assumed stale state: "already merged", "batches stalled", a nonexistent `claude-3-5-haiku` ID, a `NODE_ENV` gate that is always non-prod on Workers. Check live state first.

## 6. Also merged 2026-10-04 → 10-05 (not covered above)

#436 ADR 039 + Phase C scaffold; #437 Phase C 3-video micro-batch bake-off harness; #438 10X historical PR scan remediation (comments-tier3 idempotency, validate ghost-ack, jev fallback budget, embed phantom rows); #439 Deepgram Nova-2 + MultimodalProbeRunner adapters; #440 Part A grounded extraction engine; #441 Part B projective synthesis engine with Claim ID citations. Closed unmerged: #427, #428, #435 (earlier Phase B / bake-off / taxonomy drafts) and #444.
