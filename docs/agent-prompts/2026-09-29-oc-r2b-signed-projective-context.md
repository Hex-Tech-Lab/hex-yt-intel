# Agent Dispatch Prompt — R2b: server-loaded, signed projective context (audit finding 8 — persist-ACK race)

**Target Agent**: OC (opencode) — model `glm-preset/@preset/glm-53-flash-on-cheap` (CLAUDE.md "OC model standard" v4)
**Effort Level**: high

**Hard rules — MANDATORY (lessons 2026-09-29):**
- The ONLY valid home path is `/home/kellyb_dev` (UNDERSCORE). `/home/kellyb-dev` or any other path is rejected and KILLS your run.
- Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-r2b` (step 1 creates it). Never touch the main checkout except appending to its `.memory/AGENT_LEDGER.md`. Never read `~/.claude` or another agent's files.
- NEVER run `git stash`, `git reset`, `git checkout -- <file>` or `git clean`. To compare with the base, use `git diff` or `git show HEAD:<file>`.
- NEVER delete or weaken an existing test. You may UPDATE an assertion only where this contract deliberately changes behaviour, and you must name each one in the report.
- NO gate-gaming: no empty `finally` blocks, no rewrites just to dodge a rule, no drive-by renames/import moves/extra logging, and NEVER edit `scripts/quality-engine/**` or `.qa-intel/baseline.json`. PRE-EXISTING qa-intel finding in a touched file: list it and STOP; CC decides. Findings in code you wrote: fix them properly. Run qa-intel AFTER `git add` (the scanner only sees tracked files).
- Do NOT run `supabase db push`, `supabase link`, or anything that sources `.env*` files. Write migration FILES only; CI applies them.
- Touch ONLY the files the steps name (plus their tests). Paste `git status --short` and `git diff --stat` before committing.
- Gates (paste real output, all exit 0): web tsc; worker tsc (`-p tsconfig.typecheck.json`); web vitest (full); web lint; `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare`; `pnpm --filter youtube-intelligence-worker run build`.

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

## 1. Context & Problem Statement

Today (post-R1), `web/hooks/useSSEStream.ts` `buildGroundedPriorPayload` builds the projective bundle's `prior_payload` from the BROWSER's in-memory synthesis nucleus, shapes it with `fitPriorPayloadToCap`, and sends it to the worker. The worker validates shape and size (`web/lib/config/prior-payload.ts`, guard in `worker/src/routes/analysis.ts` after the HMAC check) but CANNOT know the content is genuine. It is unsigned: a user can put anything in their own projective prompt. Also, the projective bundle is released when the grounded STREAMS settle in the browser, not when the grounded chunks are PERSISTED. If the tab closes mid-projective, the server cannot reproduce what the browser sent (the persist-ACK race).

The worker has NO database access (ADR 005), so the server-side load happens on Vercel.

## 2. Contract & Implementation Directives

**Contract.**
- New route `POST /api/analyses/[id]/projective-context` (auth + owner check, 404 for foreign rows). It reads the PERSISTED grounded chunks for that analysis (`analysis_chunks`, via the existing persistence port/adapter — find the chunk read method with grep, e.g. `getAnalysisChunks`/`findChunks`). It keeps only NON-projective dimensions (`isProjectiveBundle`), builds the payload with `fitPriorPayloadToCap` (cap = registry `analysis.layer2.priorPayloadMaxBytes`), and returns `{ prior_payload, contextSig, contextExp }`.
- `contextSig` = HMAC-SHA256 over `analysisId + '.' + contextExp + '.' + sha256(canonical JSON of prior_payload)`, using the SAME secret family the stream token already uses (find how `CreateAnalysisUseCase` / the token port signs `sig`; reuse that port, do not add a new secret). `contextExp` = now + 10 min.
- Race closure: if ANY grounded bundle of the job's `streamBundles` has no persisted chunk row with status `completed` yet, return 409 `{error:'grounded_not_persisted', retryAfterMs}` (registry key `analysis.layer2.projectiveContextRetryAfterMs`, default 1500, new migration following `supabase/migrations/20260927120000_transcript_budget_registry_key.sql`). If some grounded bundles FAILED terminally (status `failed`), proceed with what persisted (the degraded case R1b already allows).
- Client (`useSSEStream`): before the projective dispatch, call this route (poll on 409 up to `analysis.layer2.projectiveContextMaxWaitMs`, default 20000, same migration). Send the returned `prior_payload` + `contextSig` + `contextExp` to the worker. REMOVE the browser-nucleus source (`buildGroundedPriorPayload` from nucleus state). On timeout, dispatch the projective bundle WITHOUT prior_payload (it degrades; it must not hang).
- Worker: accept `prior_payload` ONLY with a valid `contextSig` for this `analysisId` and a non-expired `contextExp`. Verify it AFTER the stream-token HMAC check and BEFORE the existing shape/size guard. Invalid or missing sig with a `prior_payload` present → 400 `{error:'invalid_prior_payload', reason:'unsigned_context'}`. No `prior_payload` → proceed as today.
- Keep R1d's guard and `fitPriorPayloadToCap` exactly as they are (defence in depth).
- External review of #363 (2026-09-29), fold in:
  - The `contextSig` message MUST also cover the projective bundle's `dimensions` (canonical sorted list): `analysisId + '.' + contextExp + '.' + dims.join(',') + '.' + sha256(payload)`. The worker decides projective mode from the SIGNED dims when a prior_payload is present, so a caller cannot flip a grounded bundle into projective mode or vice versa.
  - `PriorPayloadSchema` (`web/lib/config/prior-payload.ts`): reject DUPLICATE dimension numbers and any PROJECTIVE dimension number (`PROJECTIVE_DIMENSIONS`) inside prior_payload (grounded evidence only). Add tests.
  - `resolvePriorPayloadMaxBytes`: clamp to a MINIMUM of 1024 (the registry key's declared min) as well as the 65536 ceiling; fractional/below-min/non-numeric input must never return a cap too small for the empty v2 envelope. Add boundary tests (0.5, 1, 1023, 1024).
  - `assertBundlePartition` (`web/lib/config/synthesis.ts`): additionally enforce the epistemic contract. Every bundle must be ALL-projective or ALL-grounded (no mixed bundle), and dim 8 must sit in a grounded bundle. Add tests for partitions that are complete and unique but semantically invalid (e.g. `[1,9]`, `[8,11]`).
  - Any stored `job.prior_payload` fallback in `useSSEStream` must be removed (this task replaces it) or routed through `fitPriorPayloadToCap`; no unshaped payload may reach the worker.
- R1e dependency: the grounded dim-8 chunk's raw payload (in `analysis_chunks.payload`) carries the root array `explicitSpeakerResources` (8.4 input; stripped only at the final stitch). The route MUST read it from the persisted grounded chunk and include it in `prior_payload` exactly as R1e's schema defines it (optional, max 20 × 200 chars). Add a route test that persisted `explicitSpeakerResources` reach the signed payload.

Steps, IN ORDER:
1. `git -C /home/kellyb_dev/projects/hex-yt-intel fetch origin && git -C /home/kellyb_dev/projects/hex-yt-intel worktree add /home/kellyb_dev/projects/hex-yt-intel-r2b -b fix/r2b-signed-context origin/main && cd /home/kellyb_dev/projects/hex-yt-intel-r2b && pnpm install --frozen-lockfile`. origin/main already contains R1e (#366, f417c7c2), so `explicitSpeakerResources` and `fitPriorPayloadToCap(dims, maxBytes, resources)` exist. R2a is a SEPARATE PR (#367); do NOT depend on it.
2. Read in full: `useSSEStream.ts` two-phase dispatch; `worker/src/routes/analysis.ts` `verifyStreamToken` + the R1d guard; the token-signing port/adapter on web; the chunk read method. Name them in the report.
3. Migration (2 registry keys) → route + use case → client change → worker verification.
4. Tests: route (404 foreign; 409 not persisted; degraded proceed; payload excludes projective dims; sig verifies); worker sig verify (valid; tampered payload; wrong analysisId; expired; missing sig with payload → 400). The sig check must live in a module importable by web vitest (the worker has no vitest; follow how `web/lib/config/prior-payload.ts` is shared). Client: projective dispatch uses the route's payload, never nucleus state (a spy on the nucleus read must NOT be hit for prior_payload).
5. NEGATIVE CONTROL: accept any sig in the worker check; the tampered-payload test must FAIL; restore.
6. Gates. Commit `feat(layer2): R2b server-loaded signed projective context (closes persist-ACK race)` ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push. STOP and report.

## 3. Pre-PR Review Skills
- STEP 0: `build-graph`; `get_impact_radius_tool` on `useSSEStream`, `verifyStreamToken`.
- ALWAYS: `qa-intel` (both modes), `code-reviewer`, `review-delta`, `review-duplication`.
- Security: `owasp-top-10` (new signed boundary), `security-review`, `race-condition-guard`.
- Migrations: `supabase-postgres-best-practices`.

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

Scoped checklist:
1. Contract = signed, server-loaded context + 409 race closure, enforced by the step 4 tests.
2. E2E: grounded chunks persisted → route reads DB → signed payload → client → worker verifies sig → prompt. Show that a browser-forged payload is rejected.
3. Tangents: R2a's (PR #367) server-side remediation calls the worker for grounded AND projective dims. Does it need a signed context too? REPORT it; do not change remediation unless it breaks.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
