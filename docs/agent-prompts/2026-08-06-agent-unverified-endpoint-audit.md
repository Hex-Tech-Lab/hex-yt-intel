# Agent Dispatch Prompt — Contract Auditor: UNVERIFIED_ENDPOINT_NO_TEST (16 findings)

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now
if you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action.

**Check the ledger for OC's in-progress ADR 024 work** (happy-dom/RTL
setup) and for a sibling task on `SILENT_ERROR_RETURN_NO_TELEMETRY`
findings (a different agent, dispatched in parallel with this one) before
starting — you're in an isolated worktree so file collision shouldn't
happen, but be aware both are running concurrently on the same
contract-auditor backlog.

## 1. Context

`pnpm tsx web/scripts/contract-auditor.ts` carries 28 warning-level
findings that have sat unaddressed for multiple sessions (flagged by the
user). 16 of the 28 are `UNVERIFIED_ENDPOINT_NO_TEST`: a hardcoded call to
an external API URL with no sibling test file verifying the exact
path+method+body shape against a live call. This project has TWO
confirmed real incidents from exactly this class of gap (see
`.memory/AGENT_LEDGER.md`, 2026-08-03 entry): the Supabase Management
API's `logs.all` endpoint silently 404'd for weeks due to a wrong default
time window, and a QStash schedule endpoint had a similar undetected drift
— both found only because a user manually noticed broken behavior, not by
any automated check. This is why the rule exists and why it's worth
actually working through, not dismissing as noise.

## 2. Task

Run `pnpm tsx web/scripts/contract-auditor.ts` yourself first to get the
CURRENT exact list with file:line — findings may have shifted since this
prompt was written. As of this prompt, the 16 `UNVERIFIED_ENDPOINT_NO_TEST`
findings are in:
- `worker/src/services/LLMCascade.ts` (~line 30, OpenRouter)
- `worker/src/services/CommentClassifier.ts` (~line 16, OpenRouter)
- `worker/src/chat-stream.ts` (~line 68, OpenRouter)
- `web/lib/services/openrouter.ts` (~line 95)
- `web/lib/services/dimension-remediation.ts` (~line 97, OpenRouter balance check)
- `web/lib/intelligence/relations-engine.ts` (~line 84)
- `web/lib/env.ts` (~line 46)
- `web/lib/embeddings.ts` (~line 20)
- `web/lib/admin-logs/fetchers.ts` (5 findings — lines ~107, ~230, ~277, ~389, ~461 — Supabase Management API, QStash — the EXACT file with the two confirmed prior incidents, highest priority in this list)
- `web/lib/adapters/OpenRouterCompletionAdapter.ts` (~line 5)
- `web/app/api/admin/logs/supabase/route.ts` (~line 9)
- `web/app/api/admin/logs/qstash/route.ts` (~line 9)

For EACH finding, in priority order (do `admin-logs/fetchers.ts` and its 2
route files FIRST — proven highest-risk):

1. **Read the actual fetch/request call** — exact URL, method, headers,
   body shape, and what response shape the code expects back.
2. **Verify it against reality.** For internal-to-this-project endpoints
   (Supabase Management API, QStash) — use the Supabase MCP or a live curl
   with the actual configured credentials (check `.env`/`env.ts` for how
   the key is sourced, don't hardcode a credential into a script) to
   confirm the endpoint still returns the shape the code assumes. For
   third-party APIs (OpenRouter) — check their current API docs (WebFetch
   their docs page, or use Context7 if it has current OpenRouter docs) to
   confirm the endpoint/shape hasn't changed, OR make one live test call
   if this project already has a way to do so safely (check for an
   existing pattern of hitting these APIs from a test/dev context before
   inventing one — don't spend real API credits carelessly; note in your
   report if you skip live verification for cost/safety reasons and rely
   on docs-only confirmation instead).
3. **Add a real test.** A test that hits a mock/recorded response
   validating the code correctly PARSES the exact real shape (not a
   trivially-passing mock that just returns whatever the code already
   expects — the whole point is catching drift, so the mock's shape must
   be traceable back to real verified API output, cite where you got it:
   a live curl result, official docs example, or existing usage elsewhere
   in the codebase).
4. **If you find actual drift** (the code's assumed shape doesn't match
   reality) — that's a real bug, fix it, and flag it prominently in your
   report as a CONFIRMED LIVE BUG, not just a coverage gap.

## 3. Goal / definition of done

All 16 findings resolved: either a real test added with cited real-API
verification, or (for findings where live verification genuinely isn't
practical — e.g. a third-party endpoint with no safe way to test without
spending money) an explicit documented justification in the code/test file
for why full verification wasn't done, not a silent skip.

## 4. Expected results

- Test files added/extended for each of the 16 endpoints, each citing its
  verification source.
- Any confirmed real API-shape drift fixed and prominently flagged.
- `pnpm tsx web/scripts/contract-auditor.ts` shows 0 (or fewer, with
  documented justification for any remainder) `UNVERIFIED_ENDPOINT_NO_TEST`
  findings.

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: Supabase MCP for the `admin-logs/fetchers.ts`
findings (Management API / QStash verification — the highest-priority
subset, given the confirmed prior incidents). `owasp-top-10` if any
verification work touches how credentials are read/logged (don't let a
live curl test accidentally leak a real API key into a committed test
fixture or log output).

## 6. Fixtures

Run `code-review-graph`'s `build_or_update_graph_tool` then
`get_review_context_tool` scoped to `web/lib/admin-logs/fetchers.ts`,
`web/app/api/admin/logs/supabase/route.ts`,
`web/app/api/admin/logs/qstash/route.ts` first (highest priority), then
the remaining files, before reading full files. Start from `main` at its
current HEAD (`git log --oneline -1`).

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact expected
   request/response contract for each endpoint BEFORE writing its test,
   sourced from a real verification (live call or current docs), not
   assumed from the existing code (which is exactly what might be wrong).
2. **E2E cycle complete.** A test that only proves the code parses ITS OWN
   assumed shape correctly is NOT sufficient — it must be checked against
   an independently-verified real shape.
3. **Tangent hunt.** While verifying each endpoint, check whether the same
   file has OTHER unverified endpoint calls contract-auditor's pattern
   didn't happen to flag. Report tangents found even if not fixed this pass.

**If you cannot complete a full cycle or find a design gap (e.g. can't
safely live-verify a paid third-party endpoint), STOP and report the
specific deviation and why — don't silently skip it.**

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (actual verification evidence per
endpoint — live curl output, cited docs excerpt, or explicit justification
for skipping) → Tangents found → Deviations flagged → Skills run +
findings → Gates → Files changed. CC independently re-verifies every claim
against real code and real system state before accepting.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' — empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # EXACT CI flags, not the bare default run
pnpm tsx web/scripts/contract-auditor.ts
```

## 10. PR

Open a PR against `main` when done (branch name:
`fix/unverified-endpoint-audit`), do not merge it yourself — CC will
independently re-verify and merge.
