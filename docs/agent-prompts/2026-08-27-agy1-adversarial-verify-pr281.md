# Agent Dispatch Prompt — adversarial-verify-pr281-with-evidence

**Target Agent**: AGY-1 (Claude Code / Pro)
**Effort Level**: medium

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

## 1. Context & Objective

OC implemented fixes on branch `fix/highlights-scrubber-resilience-and-supabase-singleton` (PR #281, commit `0def4e93`). 

Perform an adversarial verification pass to confirm that the claimed contracts hold under edge cases and provide concrete execution evidence before the branch is merged to `main`.

---

## 2. Verification Directives & Evidence Collection

Execute the following checks and capture actual command outputs:

### 1. Inverted Interval & Fallback Proof (`web/lib/validators/highlights.ts`)
- Execute a node script evaluating `HighlightSegmentSchema.safeParse`:
  - Input: `{ start: 60, end: 10, title: "" }`
  - Assert output: `start === 60`, `end === 90`, `title === "Key Insight"`.
  - Input: `{ start_time: "15.5", end_time: "45.5" }`
  - Assert output: `start === 15.5`, `end === 45.5`.

### 2. Route Contract & Sanitized Fallback Proof (`web/app/api/analyses/highlights/route.ts`)
- Trace the route handler execution path:
  - Verify that when `rows` is empty (`[]`), the route returns HTTP 200 with `{ analysisId, highlights: [], ...settings }`.
  - Verify that when malformed rows fail `safeParse`, the route drops the invalid rows and returns `validHighlights`, logging via Sentry without returning raw unvalidated payloads.

### 3. Supabase Browser Client Singleton Identity Proof (`web/utils/supabase/client.ts`)
- Run an evaluation confirming:
  - In browser simulation (`typeof window !== "undefined"`), repeated calls to `getSupabaseBrowserClient()` return the identical object reference (`clientA === clientB`).
  - `client.ts` contains zero hardcoded JWT string patterns.

### 4. Scrubber Bounded Polling Verification (`web/components/dashboard/HighlightsScrubber.tsx`)
- Review `HighlightsScrubber.test.tsx`:
  - Confirm the mock verifies 3 polling attempts with exponential backoff on empty 200 responses.
  - Confirm HTTP 4xx/5xx responses fail closed immediately without retry cascades.

### 5. Template & Governance Parity
- Verify that `.memory/TEMPLATE.md` and `docs/agent-prompts/TEMPLATE.md` are byte-identical and contain the full Pre-PR Review Skills Decision Tree.

---

## 3. Mandatory Review Skills Execution

- `/simplify` (verify zero unpruned bindings or dead imports on the branch)
- `review-delta` (confirm 0 unintended diffs against `main`)
- `review-duplication` (confirm 0 clones in `route.ts` and `HighlightsScrubber.tsx`)

---

## 4. Quality Gates

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run web/lib/__tests__/highlights-validator.test.ts web/components/dashboard/__tests__/HighlightsScrubber.test.tsx
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
```

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Verification Evidence (with actual command outputs) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Final Verdict (APPROVE / REJECT for merge).
