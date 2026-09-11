# PR #307 External Review Findings (2026-09-11, pasted by user)

PR: fix(qa-intel): VariableNamingRule false-positives on callback single-letter args
Branch: fix/qa-intel-single-letter-callback-arg-false-positive
Reviewed head: `dc5c201e` (+ `b54f90ed` ledger, `5e27a4dd` IIFE guard+test)
CI at review time: green, 35/35 checks passing.

## Contract traced
`VariableNamingRule.check()` exempts a single-character param name from a naming
finding only when: it's an arrow-function parameter, the arrow has exactly 1
parameter, the arrow's immediate parent is a `CallExpression`, and the arrow itself
is in that call's argument list.

## Findings

1. **Likely false negative — rest parameters exempted.** `arrowFn.getParameters().length === 1`
   also matches `(...q) => q.length` — a rest param, not a single callback value. The
   exemption's rationale doesn't cover this shape; should be excluded. **Most
   important fix — flagged as the real production risk.**
2. **IIFE commit (`5e27a4dd`) comment overstates the fix.** For
   `((q: string) => q.trim())(...)`, the arrow's immediate parent in the TS AST is a
   `ParenthesizedExpression`, not the `CallExpression` — so `Node.isCallExpression(arrowFn.getParent())`
   already failed pre-fix and this case was already correctly reported. The new
   `callExpr.getArguments().includes(arrowFn)` check is harmless defensive code but
   doesn't demonstrate a regression it repaired. The new IIFE test likely passes both
   before and after this commit. Reword the comment as a defensive guard, or add a
   test that actually fails under the prior implementation.
3. **Missing coverage for parenthesized/wrapped callback args**, e.g.
   `consume(((q) => q.trim()))` or `consume(((q) => q.trim()) as Callback)` — the
   arrow's immediate parent becomes a `ParenthesizedExpression`/type node, not the
   `CallExpression`, so these can still false-positive. Undocumented/untested
   boundary — either exempt via transparent-wrapper normalization or document as
   intentionally excluded + test it.
4. **Constructor callbacks (`NewExpression`) not exempted** — `new Promise((r) => resolve(r))`
   still gets flagged. May be intentional (contract says "call expression") but the
   stated rationale is broader ("direct callback argument" idiom generally). Needs an
   explicit decision + test either way.
5. **Weak negative-only test for the callback exemption** — only asserts `'s'`/`'n'`
   are absent from findings; would also pass if the rule silently found nothing at
   all (traversal/parse failure). Add a positive control in the same fixture (e.g.
   `const p = items.length;` should still be reported) to prove the rule actually ran.
6. **Missing multi-parameter boundary test** — the "exactly 1 param" requirement has
   no test proving `items.map((value, q) => value + q)` still flags `q`. Test gap,
   not a demonstrated bug, but protects the exemption's most important boundary.
7. **Ledger documentation drift** — `docs/qa-intel/RULESET_LESSONS_LEDGER.md` claims
   3 real `VariableNamingRule.check()` invocations in the replacement test; the file
   actually has 4 (existing violation, callback exemption, named-function param, IIFE
   param). Unresolved review thread, directly actionable.

## Priority
Real production fix needed: **#1 (rest-parameter exclusion)**. Everything else is
contract clarification, regression coverage, or doc accuracy — important before
merge but not an active false-negative in the common case today (except #1).
