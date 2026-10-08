# ARTAS v3 Batch 2 — Hostile Audit of PRs 399–408 (Phase 3)

Audit date: 2026-10-08. Worktree: `hex-yt-intel-wt-10x` (branch `phase-c`). READ-ONLY audit — no production files modified.
Method: every candidate was verified against the current tree before classification; refutations cite the disproving line. No finding is asserted without a concrete reachable input or state.

---

## Findings

| PR # | Priority | ARTAS Vector Class | Target File | Vulnerability / Impact | Remediation Prompt |
|---|---|---|---|---|---|
| 403 | P2 | V16 / V19 (partition-consistency race across services) | `web/app/api/analyses/[id]/stream-tokens/route.ts:70-80` | LATENT: the mint route resolves `analysis.streamBundles` from the Settings Registry **at mint time** (fresh read, fallback to `STREAM_BUNDLES` on `assertBundlePartition` failure), while the worker resolves the partition from the signed job (`job.streamBundles`, `worker/src/routes/analysis.ts:166`). If the registry value changes (or is temporarily invalid → silent fallback to default) between plan creation and a later cell-token mint wave, minted v2 tokens bind cells to a *different* partition than the worker enforces. Concrete input: admin sets `analysis.streamBundles` to a different partition after an analysis' plan was created; user retries a failed cell → tokens carry `chunkIndex/startWord/endWord/sliceSha256` computed against the new partition; worker's `resolveCellTranscript` (`worker/src/routes/analysis.ts:1075-1148`) computes the slice over the same transcript with the *job's* boundaries → every cell fails `slice_hash_mismatch` → paid full-transcript fallback per cell (budget-gated but real money, and the K>1 run degrades to K=1 quality). Limited blast radius: requires an admin partition change mid-flight or a transient registry-read failure at exactly mint time; no data corruption, no security bypass (tokens still auth-bound and ownership-checked). | Add a regression test that mints tokens with registry partition A, then re-mints with partition B, asserting either (a) mint rejects with a stable error when the stored plan's partition differs from the resolved one, or (b) the stored `jev_plan` carries the exact partition used at plan time and the mint route validates `assertBundlePartition` equality against it instead of re-resolving the registry. Preferred fix: derive `bundleList` from the stored plan (it is already fetched at `route.ts:83`) rather than a second registry read, so mint and worker always agree. |
| 401 | P3 | V14 (hardening / future-contract fragility) | `web/hooks/useSSEStream.ts:36-40` | LATENT (hardening, not exploitable today): the SSE line handler skips **any** line starting with `event:` and `parsePlanFrame` only consumes `data:` payload lines whose JSON contains a `plan` field — so PR 401's fix is correct for the single named event that exists today (`event: plan`, `worker/src/routes/analysis.ts:1416`). But the adapter's blanket `event:` skip silently drops *any future* named SSE event: if the worker later adds e.g. `event: warning` or `event: progress`, the adapter will never see it and there is no log/metric for dropped event types (the data line is still fed to `adapter.processLine`, which validates fragments and JSON-parse-fails with a console.error — noisy but visible). No current wrong outcome; purely contract fragility. | Add a allowlist comment + dev-time console.warn when an unknown `event:` name is seen, or better: have `parsePlanFrame`/the handler dispatch on a known event-name enum so future named events fail loudly rather than silently. |
| 399/400 | P3 | V09 (single-source-of-truth / literal duplication) | `web/lib/jev/transcript-slice.ts:58` vs `worker/src/routes/analysis.ts:23` | LATENT (dedup nit): the sentinel constant `EMPTY_SLICE_SHA256` (sha256 of the empty string) is duplicated as a raw literal in both web and worker instead of being re-exported from the shared `worker/src/services/TranscriptSlice.ts` module that PR 400 created (which the web side already re-exports through `transcript-slice.ts` → `projective-context.ts` → `stream-token.ts`). If the hash algorithm or sentinel ever changes on one side only, empty-slice (projective bundle) verification fails on the other side → same `slice_hash_mismatch` fallback cost as Finding #1. One-line drift risk, not a live bug. | Replace the worker-side literal at `worker/src/routes/analysis.ts:23` with a re-export/import from the shared TranscriptSlice module (worker already imports from it for slice computation), keeping one definition. |

---

## Refuted

| Candidate | Disproving Evidence |
|---|---|
| PR 401: `event: plan` data line double-fed to fragment adapter corrupts synthesis | `web/hooks/useSSEStream.ts:36-40` — lines starting with `event:` are skipped before `adapter.processLine`; `parsePlanFrame` (`useSSEStream.ts:128-145`) only consumes data lines with a `plan` field, and the plan frame is never routed to the fragment adapter. `worker/src/routes/analysis.ts:1416` emits exactly one named event (`plan`); no other `event:` lines exist. Refuted. |
| PR 402: `leadInSeconds = Math.min(contextLeadSeconds, activeHighlight.start)` can go negative / seek before 0 | `useHighlightTicker` clamp matches the downstream consumer behavior (`PublicHighlightsReel.tsx:140`, `HighlightsScrubber.tsx:300-306` — playback opens at `max(0, start - contextLead)`); `Math.min(lead, start)` with `start ≥ 0` is always ≥ 0. Refuted. |
| PR 407: `checkPersistCell` fail-open lets a bad/unexpected cell persist | `web/app/api/analyses/persist/route.ts:376-385` — `!cellCheck.ok` returns HTTP 400 before any persistence write; `checkPersistCell` (`web/lib/jev/stored-plan.ts:92-110`) requires the cell to be in `plan.cells` with `expected: true` and `totalChunks === plan.streamCount`. The K>1→v1 degrade hatch (`route.ts:389-398`) is best-effort by explicit design and never fails the persist. Refuted. |
| PR 408: `resolvedTotal` miscounts v2 completeness (K vs bundle count confusion) | `route.ts:457` — `resolvedTotal = jevChunkIndex === undefined ? (totalChunks ?? TOTAL_STREAMS) : TOTAL_STREAMS`; for v2 cells it counts **bundles** (TOTAL_STREAMS), matching `reduceCellsToBundleRows` (`web/lib/jev/reduce-cells.ts:53+`) which reduces per-bundle cell rows to the bundle dimension set. Consistent with PR 407's cell-gating. Refuted. |
| PR 404: budget-exhausted state can be bypassed to get a free full-transcript re-run | `worker/src/routes/analysis.ts:1125-1148` — `checkAndRecordFallbackBudget` is awaited *before* the fallback executes; `!budget.decision.allowed` skips the cell (fail-closed). Unenforceable legacy plans (no cost fields) preserve legacy behavior by explicit design comment (T3). Refuted. |
| PR 405: registry NaN/float/string value for `analysis.jev.maxParallelStreams` breaks concurrency or hangs `runWithConcurrency` | `web/lib/config/jev.ts:91-95` — non-numeric → fallback (6); numeric → `Math.max(1, Math.min(32, Math.floor(v)))`. `runWithConcurrency` (`web/lib/utils/run-with-concurrency.ts:16`) independently re-clamps `safeLimit ≥ 1` and `≤ items.length`. Defense in depth holds. Refuted. |
| PR 406: duplicate `jevChunkIndex` across cells silently corrupts bundle reduction | Already fixed *by* PR 406: `web/lib/services/reduce-grounded-chunks.ts:85-100` throws on the first duplicate; finite/non-negative wordCount and 0..1 confidence validation present. Refuted (the PR is the fix, no residual gap found). |
| PR 399: worker verify path could be used to mint/forge v2 tokens | `worker/src/routes/analysis.ts:1075-1082` — `resolveCellTranscript` is verify-only (`tokenVersion !== 2` → unchanged path; v2+projective → unchanged; v2+grounded fields guaranteed by `verifyStreamToken`); minting happens exclusively on the Vercel side (`MintCellTokensUseCase`, HMAC-signed, K=1/truncated/duplicate cells rejected; route `stream-tokens/route.ts:63-64` refuses non-`processing` / completed-billing analyses). DEV_HMAC_SECRET correctly gated by `!isProductionEnv`. Refuted. |

---

## Coverage

| PR | Title / Area | Depth | Result |
|---|---|---|---|
| 399 | v2 stream-token envelope (partition + slice binding, `tokenVersion` allowlist, worker verify-only) | Full diff read + current-tree trace (`verifyStreamToken`, `resolveCellTranscript`, `sha256HexIsomorphic` re-export chain, `buildV2Msg` byte-identical contract `worker/src/routes/analysis.ts:323-326`, DEV_HMAC gating) | 1 × P3 finding (literal duplication, shared with 400); verify-only surface confirmed safe |
| 400 | Shared isomorphic transcript slice module (web + worker) | Full diff read + import-chain trace (`transcript-slice.ts` → `projective-context.ts:24-26` → `stream-token.ts:3,65`; worker `TranscriptSlice.ts`) | Shared with PR 399 P3 finding (EMPTY_SLICE_SHA256 duplicated rather than re-exported) |
| 401 | SSE handler skips named `plan`-event frames (prevents double-feed) | Full diff read + adapter behavior check (`synthesis-stream-adapter.ts:66-110` — plan payload JSON-parses, fails fragment validation, logs, is discarded) | Fix verified correct; 1 × P3 future-contract hardening note (unknown `event:` names silently dropped) |
| 402 | Highlight ticker lead-in clamp (`useHighlightTicker`) | Full diff read + consumer clamp check (`PublicHighlightsReel.tsx:140`, `HighlightsScrubber.tsx:300-306`) | Clean — refuted negative-lead candidate |
| 403 | POST `/api/analyses/[id]/stream-tokens` (per-cell v2 minting) | Full diff read + route/UseCase trace (auth, ownership, `.strict()` schema, MAX_CELLS_PER_WAVE=64, K=1/truncated/duplicate rejection, `validation_status !== 'processing'` refusal at `route.ts:63-64`) | 1 × P2 finding (registry-vs-job partition divergence vs worker) |
| 404 | Worker slice enforcement + K=1 fallback + per-video fallback budget | Full diff read + `resolveCellTranscript`/`checkAndRecordFallbackBudget` trace (`worker/src/routes/analysis.ts:1085-1148`) | Clean — budget gate confirmed fail-closed |
| 405 | `analysis.jev.maxParallelStreams` registry setting | Full diff read + resolver + `runWithConcurrency` double-clamp verification | Clean — NaN/float/string/zero all handled; **note**: resolved value currently consumed only in `CreateAnalysisUseCase` (no downstream concurrency consumer wired yet — Phase 2.6 placeholder, consistent with PR description) |
| 406 | `reduceGroundedChunks` validation fixes | Full diff read + current-tree check (`reduce-grounded-chunks.ts:85-100+`) | Clean — fixes verified present; prior bugs correctly FIXED-LATER by this PR |
| 407 | Persist route `checkPersistCell` integration | Full diff read + `stored-plan.ts:92-110` + route guard `route.ts:376-398` trace | Clean — fail-closed verified; degrade hatch is intentional best-effort |
| 408 | Persist route v2 completeness fix (`resolvedTotal` + `reduceCellsToBundleRows`) | Full diff read + interrupted-cell self-row path (`route.ts:1267-1286`) + completeness loop (`route.ts:739-787`, R3b 2.5c reads at `716`, `1071`) trace | Clean — bundle-count semantics consistent across 407/408 |

---

## The 4 Development Tenets

1. **Think Before Coding**: Surface assumptions explicitly; clarify ambiguities instead of guessing. Check `.memory/AGENT_LEDGER.md` and `.memory/ADRS.md` to prevent collisions and align with architectural decisions. Map blast radius before writing code.
2. **Simplicity First (Hex-Lite & DDD-Lite)**: Build minimum viable logic; zero speculative abstraction layers or unused indirections. Never confuse simplicity with architecture abandonment: strictly preserve existing Ports, Adapters, Domain boundaries, and Separation of Concerns (SoC). Domain models hold business logic; adapters hold infrastructure code; route handlers remain ultra-thin dispatchers.
3. **Surgical Diffs**: Modify ONLY target lines/files. Zero drive-by formatting, zero unsolicited refactors, strict blast-radius isolation.
4. **Goal-Driven Verification**: Define empirical pass criteria; execute negative-control checks, vitest unit suites, strict type checks (`tsc --noEmit`), and `qa-intel:baseline` before closing tasks.

---

## Report Format

- **RCA**: root cause of each finding stated with the concrete input/state that triggers it (see Findings table).
- **Contract**: the contract each finding violates (partition single-source-of-truth between plan-mint and worker enforcement; SSE event-name contract; single-definition constant contract).
- **Fix**: remediation prompts provided per finding (derive `bundleList` from the stored plan; event-name allowlist with loud failure; single re-exported constant).
- **E2E proof**: each remediation prompt specifies a regression test proving the fix (mint-mismatch test; unknown-event warn test; constant re-export type check).
- **Tangents**: none taken — audit confined to PRs 399–408 and their direct integration surfaces.
- **Deviations**: none from the dispatch prompt; read-only discipline held (only this file created).
- **Skills Run**: CORE (qa-intel, contract-auditor, simplify-pass) + SELECT (supabase-postgres-best-practices for persist/chunk queries, next-best-practices for route handlers, react-best-practices for SSE hook) — applied as review lenses.
- **Findings**: 1 × P2, 2 × P3, 8 candidates refuted with cited evidence (see tables above).
- **Gates**: read-only audit — build/lint/test gates not applicable; current-tree verification substituted (every classification grounded in a live file/line read, not diff memory).
- **Files changed**: `docs/reviews/artas-parts/batch-2.md` (this file) only.
