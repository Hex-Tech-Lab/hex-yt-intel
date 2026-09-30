# Agent Dispatch Prompt — R3b 2.2: v2 signed stream token (streamCount, jevChunkIndex, jevChunkCount, slice triple) with dual verify

**Target Agent**: OC (`glm-preset/@preset/glm-53-flash-on-cheap`, CLAUDE.md "OC model standard")
**Effort Level**: medium
**Series**: R3b step 2 (ADR 037 Addendum A, private doc `docs/private/ADR_037_JEV_SEMANTIC_CHUNKING_VARIANCE_BOUNDARIES_2026-09-29.md` — read Addendum A in full). Dispatch ONE at a time, in order 2.1 → 2.5; each starts from `origin/main` after the previous one merged.

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
>
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

---

## HARD RULES

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b-22` (branch `feat/r3b-2-2-token-v2`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

Today `web/lib/stream-token.ts#signStreamToken(videoId, analysisId, models)` signs `${videoId}:${analysisId}:${exp}:${modelStr}` and the worker verifies it in `worker/src/routes/analysis.ts` `verifyStreamToken` (~L180). Addendum A3 requires the token to bind the map-reduce cell: `v2:${videoId}:${analysisId}:${exp}:${models}:${streamCount}:${jevChunkIndex}:${jevChunkCount}`, plus a Vercel-signed transcript-slice triple `(startWord, endWord, sha256(text))`. Rollout needs the worker to accept BOTH formats for one deploy window.

## 2. Contract & Implementation Directives

1. Ledger `[IN_PROGRESS]`. `build-graph`; list every caller of `signStreamToken` and `verifyStreamToken`.
2. Add `signStreamTokenV2({ videoId, analysisId, models, streamCount, jevChunkIndex, jevChunkCount })` next to the v1 signer (same `TOKEN_TTL_MS`, same `hmacHex`, `timingSafeEqualHex`). Keep v1 unchanged.
3. Add `signTranscriptSlice(analysisId, exp, { startWord, endWord, sha256 })` using the existing `boundContentMessage` / `BoundSigPurpose` mechanism: add purpose `'transcript-slice'` to `BoundSigPurpose` and to every exhaustive switch/list over it.
4. Worker `verifyStreamToken`: if the request carries `tokenVersion: 2`, verify the v2 message and additionally reject when `jevChunkIndex < 0`, `jevChunkIndex >= jevChunkCount`, `jevChunkCount < 1`, or `streamCount !== jevChunkCount * G + P` (G/P from the request's resolved bundle list via `isProjectiveBundle` — find where the worker already knows the bundle). Otherwise verify v1 exactly as today (implicitly K = 1, streamCount = 5).
5. Do NOT emit v2 anywhere yet (the web side keeps calling v1). This PR only adds the capability + dual verify.
6. Tests: web signer unit tests (v2 message shape, different cell ⇒ different sig); worker tests (`worker/src/__tests__/`): valid v2 accepted; tampered `jevChunkIndex`/`streamCount`/`jevChunkCount` rejected; out-of-range index rejected; inconsistent streamCount rejected; v1 token still accepted; v1 token presented as v2 rejected. Slice-sig: tampered sha256 rejected, wrong purpose rejected.
7. Gates, qa-intel after `git add`, commit `feat(token): v2 stream token binding the Jev map-reduce cell (dual verify)`, ledger `[DONE]`.

Out of scope: emitting v2, job creation, persist, reduce.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Use `docs/agent-prompts/TEMPLATE.md` §3 verbatim (newest list). Re-match SELECT whenever the touched-file set grows. Write "not available in OC" for any skill you cannot invoke — never claim it ran.

---

## 4a. Verification & Quality Gates (local)

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
