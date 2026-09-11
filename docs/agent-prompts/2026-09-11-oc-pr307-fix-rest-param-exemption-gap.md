# Agent Dispatch Prompt — fix-pr307-rest-param-exemption-and-doc-drift

**Target Agent**: OC (DeepSeek/GLM, low effort)
**Effort Level**: low (well-scoped, findings already root-caused by an external reviewer)

---

## 0. Ledger protocol — [ALWAYS INCLUDE]

Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md` before touching any file. Post an
`[IN_PROGRESS]` line with your intent + target files as your FIRST action. Re-check the
ledger after every subtask. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of
what actually happened (not what you intended) as your LAST action.

---

## 1. Context

You are in a git worktree on branch `fix/qa-intel-single-letter-callback-arg-false-positive-oc`
(tracks `origin/fix/qa-intel-single-letter-callback-arg-false-positive`, PR #307:
"fix(qa-intel): VariableNamingRule false-positives on callback single-letter args").
An external reviewer gave a detailed review of this PR's head (`dc5c201e`+`5e27a4dd`).
The full review is saved at `docs/agent-prompts/2026-09-11-pr307-external-review-findings.md`
— READ IT FIRST, in full.

This PR modifies `scripts/quality-engine/rules/quality.ts`'s `VariableNamingRule` to
stop flagging single-letter params in inline callbacks (e.g. `useStore((s) => s.x)`).

## 2. Task — fix the one real production gap; also clean up the doc drift

### Fix A (the real bug) — rest parameters are wrongly exempted
The exemption condition checks `arrowFn.getParameters().length === 1`, which also
matches a REST parameter: `consume((...q) => q.length)`. `q` there represents a
variable-length collection, not the single callback value the exemption is meant for —
it should still be flagged (or at minimum, the exemption's rationale doesn't apply to
it). Add an explicit rest-parameter exclusion (check the parameter node for
`isRestParameter()`/`dotDotDotToken` per the ts-morph/TS AST API this codebase already
uses elsewhere in `quality.ts`) so a rest param never qualifies for the single-letter
exemption. Add a regression test: `consume((...q) => q.length)` — `q` IS flagged.

### Fix B — add the two missing boundary tests the reviewer called out
1. Multi-parameter test: `items.map((value, q) => value + q)` — `q` (the 2nd, non-
   callback-shape param) should STILL be flagged, proving the "exactly 1 parameter"
   requirement is actually enforced, not just documented.
2. Positive-control test in the SAME fixture as the existing callback-exemption test:
   add something like `const p = items.length;` alongside the exempted callback and
   assert `'p'` IS reported — this proves the rule engine actually traversed and ran
   (not that it silently found nothing at all, which the current negative-only
   assertion can't distinguish).

### Fix C — fix the stale/misleading things the reviewer flagged (quick, do these too)
1. Reword the comment near the `5e27a4dd` IIFE guard
   (`callExpr.getArguments().includes(arrowFn)`) — it currently implies this commit
   fixed a real regression for `((q: string) => q.trim())(...)`, but per the reviewer,
   that case's arrow parent is a `ParenthesizedExpression` in the TS AST, not a
   `CallExpression`, so `Node.isCallExpression(arrowFn.getParent())` already excluded
   it before this commit — the new `includes()` check is harmless defensive code, not
   a bug fix. Either reword the comment to say "defensive guard: ensure the arrow is an
   argument, not the callee" (accurate), OR if you can actually construct a real AST
   shape where the old check passed incorrectly, add a test proving it and keep the
   stronger claim — verify this for real, don't just take the reviewer's word or mine.
2. `docs/qa-intel/RULESET_LESSONS_LEDGER.md` claims 3 real `VariableNamingRule.check()`
   invocations in the replacement test; count them yourself in the actual current test
   file — the reviewer says there are 4 now (existing violation, callback exemption,
   named-function param, IIFE param). Fix the ledger entry to match the real count.

### Explicitly OUT OF SCOPE for this dispatch (leave for a follow-up, note in your
[DONE] report instead of fixing): parenthesized/wrapped callback args (finding #3) and
constructor/`NewExpression` callbacks (finding #4) — both need a product decision on
intended scope, not just a code fix. Do not guess; flag them.

## 3. Skills / gates — [ALWAYS INCLUDE]
`pnpm --filter @hex-yt-intel/web tsc --noEmit` if applicable to changed files (this rule
lives in `scripts/quality-engine` — check that package's own typecheck/build command
instead if different), full test run for the quality-engine test suite, qa-intel
self-check via `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` (redirect
to a file, check `$?` directly — never through a pipe).

## 4. Report format
On `[DONE]`: exact fix for the rest-parameter exclusion + the API used; the 3 new tests
and what each proves; what you changed in the IIFE comment (or the new test if you kept
the stronger claim) and why; the corrected ledger count; real gate results (no piped
exit codes); commit SHA; confirm pushed to
`fix/qa-intel-single-letter-callback-arg-false-positive-oc`. Do NOT open a new PR or
merge anything — CC will audit and decide how this rolls into PR #307.
