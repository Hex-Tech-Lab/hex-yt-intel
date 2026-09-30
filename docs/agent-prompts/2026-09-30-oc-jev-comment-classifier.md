# Agent Dispatch Prompt — Jev (TypeSafe System One) comment classifier adapter behind CommentClassificationPort

**Target Agent**: OC (`glm-preset/@preset/glm-53-flash-on-cheap`, CLAUDE.md "OC model standard")
**Effort Level**: medium
**Series**: standalone (Jev comment classification). Pilot evidence (CC, 2026-09-30): see §1.

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

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-jev` (branch `feat/jev-comment-classifier`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

User directive (2026-09-30): **Jev (`~typesafe/jev-latest`, TypeSafe System One) is the model for classification and decisions — never a chat LLM.** `worker/src/services/CommentClassifier.ts` today calls the OpenRouter chat cascade (`CASCADE_FALLBACKS.chat`, System 2) and — verified — has NO production caller (only its test). Port: `worker/src/ports/CommentClassificationPort.ts` (`classifyBatch(comments) → ClassifiedComment[]`).

**Pilot (CC, 2026-09-30, video `39hqY3nH5ug`, 111 sampled comments):** 111/111 ok, 0 errors, **$0.0000278/comment** ($0.0031 total), latency p50 0.46 s / p95 0.78 s, 13.6 s wall at 8 parallel. Response shape (verified, real):
```json
{"model":"typesafe/jev-1.13-20260917","answers":{"sentiment":{"type":"choice","choice":"positive","probabilities":{"neutral":0,"mixed":0.3,"negative":0,"positive":0.7},"confidence":0.6},"comment_type":{"type":"choice","choice":"experience","probabilities":{...},"confidence":0.89},"pain_point":{"type":"noul","noul":0.91},"question_asked":{"type":"noul","noul":0.03},"intensity":{"type":"score","score":1.75,"legend":{"0":"Mild","1":"Moderate","2":"Strong"},"probabilities":{...},"confidence":0.62}},"usage":{"input_tokens":671,"output_tokens":169,"cost":0.000028182},"id":"gen-dec-…","provider":"TypeSafe"}
```
Endpoint `POST https://openrouter.ai/api/alpha/decisions`, body `{model, state, questions}` (existing working caller to copy: `scripts/bakeoff-l2-evaluator.ts` `jevDecide` ~L200). Pilot quality issues to FIX in the question set: (1) meme/hyperbole comments read literally ("After 20 years in a wheelchair I got up to watch this" → pain_point 0.91) — the pain-point instructions must say "literal, not a joke, meme or exaggeration"; (2) 11/111 had sentiment confidence < 0.5 → low-confidence answers must be marked, not trusted; (3) comment text arrives HTML-escaped (`&quot;`) → decode entities before sending.

## 2. Contract & Implementation Directives

1. Ledger `[IN_PROGRESS]`. `build-graph`; list every importer of `CommentClassificationPort` / `CommentClassifier`.
2. Port (`CommentClassificationPort.ts`): add `'experience'` to `CommentType`; extend `ClassifiedComment` with `painPoint: number` (0–1), `questionAsked: number` (0–1), `intensity: number` (0–2), `sentimentConfidence: number`, `lowConfidence: boolean`, and make `topic` optional (Jev returns typed choices, no free text). Update every implementer/consumer the compiler flags.
3. New adapter `worker/src/services/JevCommentClassifier.ts` implementing the port: one Decisions call per comment, bounded concurrency, `state: { comment }` (HTML-entity-decoded, trimmed, capped at 2000 chars), questions exactly as in the pilot plus the fixed pain-point wording; headers `HTTP-Referer: https://getvintel.com`, `X-Title: hex-yt-intel/jev-comments`; per-call timeout; a failed call yields NO entry for that comment (never a fabricated default) and is counted; Sentry `captureMessage` once per batch if any failed; `lowConfidence = sentimentConfidence < minConfidence`; `modelUsed` = response `model`; sum `usage.cost` and return it via an optional `getLastBatchCostUsd()`.
4. Registry keys (new migration file, NOT applied): `comments.jev.minConfidence` (0.5, 0–1), `comments.jev.concurrency` (8, 1–32), `comments.jev.requestTimeoutMs` (15000, 1000–60000). Constructor takes a resolved config object; fallbacks mirror the seeds.
5. Keep `CommentClassifier.ts` untouched but mark it `@deprecated` in its doc comment (user policy: Jev for classification). Do not delete it.
6. Tests `worker/src/__tests__/jev-comment-classifier.test.ts` with a stubbed fetch returning the verified shape above: mapping of every field; entity decoding (`&quot;` → `"`); low-confidence flag at the threshold boundary (confidence == minConfidence is NOT low); failed call → comment omitted + failure counted; concurrency never exceeds the configured value (count in-flight in the stub); cost summed. Negative control for the entity-decode and the omit-on-failure tests.
7. Gates, qa-intel after `git add`, commit `feat(comments): Jev (System One) comment classifier adapter`, ledger `[DONE]`.

Out of scope: wiring classification into the Tier 3 flow / storage (next step, CC decides with the user), the backfill run, any UI.

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
