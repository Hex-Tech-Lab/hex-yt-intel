# Agent Dispatch Prompt — Contract Auditor: SILENT_ERROR_RETURN_NO_TELEMETRY (12 findings)

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now
if you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action.

**Check the ledger for OC's in-progress ADR 024 work** (happy-dom/RTL
setup, touching `web/vitest.config.ts`, `web/package.json`,
`pnpm-lock.yaml`, new `web/hooks/__tests__/` and
`web/components/templates/console/__tests__/` directories) before
starting — you're in an isolated worktree so this shouldn't collide, but
confirm you're not duplicating work if OC's task overlaps any file you
touch.

## 1. Context

`pnpm tsx web/scripts/contract-auditor.ts` has run clean at "0 critical"
for multiple sessions, but has carried 28 warning-level findings the whole
time without anyone actually working through them — flagged by the user as
having "sat for days." 12 of the 28 are `SILENT_ERROR_RETURN_NO_TELEMETRY`:
catch blocks that swallow an error and return without logging or Sentry
capture. This project has a documented history of exactly this failure
class causing real production incidents that went undetected until a user
noticed (see `CLAUDE.md`'s qa-intel `ErrorTaxonomyRule`/`WorkflowRule`
lineage — this project takes silent-failure classes seriously, it's not a
style nitpick here).

## 2. Task

Run `pnpm tsx web/scripts/contract-auditor.ts` yourself first to get the
CURRENT exact list with file:line — don't work from a stale list, findings
may have shifted since this prompt was written. As of this prompt, the 12
`SILENT_ERROR_RETURN_NO_TELEMETRY` findings are in:
- `web/lib/skills/wiki-builder/wiki-builder.ts` (2 findings, lines ~77, ~151)
- `web/lib/auth/provider-factory.ts` (1 finding, ~line 34)
- `web/lib/api-client.ts` (3 findings, ~lines 54, 65, 82)
- `web/app/api/webhooks/upstash-snapshot-poll/route.ts` (6 findings, ~lines 29, 35, 60, 66, 70, 73)

For EACH finding: read the actual catch block, determine what error
telemetry is missing, and add it — matching this project's established
pattern (check `web/lib/services/error-handler.ts` and how other routes in
this codebase log errors: `console.error` with structured context +
`Sentry.captureException` where Sentry is already imported in that file,
following the SAME convention already used elsewhere in that same file or
a sibling file, not inventing a new logging style). Do NOT just wrap
every catch in a generic `console.error(err)` — look at what information
would actually help debug that specific failure (which operation failed,
what input/context, matching the level of detail this project's other
error-handling code already provides).

**Distinguish real gaps from false positives.** Some of these 12 may
already have telemetry the rule's pattern-matcher didn't recognize (e.g. a
non-standard logging call, or telemetry added one level up the call stack
instead of in the immediate catch). Verify each one against the ACTUAL
code before assuming the rule is right — state VALID or FALSE POSITIVE
with evidence for each of the 12, matching this session's standing
verification discipline.

## 3. Goal / definition of done

All 12 findings resolved as VALID-and-fixed or FALSE-POSITIVE-with-evidence.
`pnpm tsx web/scripts/contract-auditor.ts` shows 0 `SILENT_ERROR_RETURN_NO_TELEMETRY`
findings (or fewer, with the remainder explicitly justified as false
positives in your report — don't silently leave any unaddressed).

## 4. Expected results

- Real telemetry (console.error with useful context + Sentry.captureException
  where Sentry is already used in that file) added to each confirmed-real
  silent-catch site.
- No behavior change to the actual error-handling flow (still returns/fails
  the same way to callers) — this is purely adding observability, not
  changing control flow, unless a genuine bug is found alongside (report
  separately, don't silently fix scope-creep issues without flagging them).

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: no special MCPs needed — this is a
straightforward code-pattern task across the listed files.

## 6. Fixtures

Run `code-review-graph`'s `build_or_update_graph_tool` then
`get_review_context_tool` scoped to the 4 files listed in §2 before
reading full files. Start from `main` at its current HEAD
(`git log --oneline -1`).

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State what telemetry each fix
   adds and why it's the right level of detail before writing it.
2. **E2E cycle complete.** Re-run `contract-auditor.ts` after each file's
   fixes to confirm the specific findings for that file are actually gone,
   not just assumed fixed.
3. **Tangent hunt.** While in each file, check nearby catch blocks for the
   same gap even if contract-auditor didn't flag them (its pattern-matcher
   may have missed a structurally-identical case). Report tangents found
   even if not fixed this pass.

**If you cannot complete a full cycle or find a design gap, STOP and
report the specific deviation and why.**

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (actual contract-auditor output showing
the findings gone) → Tangents found → Deviations flagged → Skills run +
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
`fix/silent-error-telemetry`), do not merge it yourself — CC will
independently re-verify and merge.
