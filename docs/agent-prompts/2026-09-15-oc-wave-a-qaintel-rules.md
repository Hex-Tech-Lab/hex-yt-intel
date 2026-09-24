> **⚠️ NOT DISPATCHED — re-scope before use (PR #324 review, 2026-09-24).** This bundles investigation, rule design, multi-file implementation and full-codebase validation into one Flash-tier prompt while its header says `medium` effort, which contradicts the Model-tuning rule. Split it into (1) investigate and classify patterns, (2) implement only the approved rule clusters, (3) validate and report, and route (2) to a non-Flash model.

# Agent Dispatch Prompt — Wave A: mine Codacy pattern-frequency list into new/improved qa-intel rules

**Target Agent**: OC (opencode, GLM 5.3 Flash, low effort)
**Effort Level**: NOT DISPATCHED — see banner above. Original single low-effort dispatch (investigation + rule design + implementation + negative-control tests across several clusters) was rejected; split into investigate / implement-only-approved-clusters / validate-and-report prompts and route implementation to a non-Flash model.

---

## 0. Ledger protocol — [ALWAYS INCLUDE]

> Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md` before touching any
> file; post `[IN_PROGRESS]` with intent + target files first; post
> `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary last.

---

## 1. Context & Problem Statement

The user has a real Codacy pattern-FREQUENCY export (distinct from the
severity-dashboard 55-finding list being handled in a separate parallel
dispatch, `docs/agent-prompts/2026-09-15-oc-wave-a-security-bulk-triage.md`
— do not duplicate that work, this dispatch is about turning RECURRING
PATTERNS into qa-intel rules so they're caught before merge, not about
fixing the current 55 instances). Goal: proactively enhance qa-intel
(`scripts/quality-engine/`) so matching code gets caught BEFORE it ships.

**Prioritization**: do NOT sort by raw count. Triage by actual risk×frequency:
low-impact-but-frequent ("fleeting"/cosmetic) items stay LOW priority
despite volume; security-shaped items (SSRF, path traversal, weak RNG,
insecure deps) are HIGH priority regardless of count. Show your reasoning
per cluster, not a hand-waved "high/medium/low" label.

**The real pasted list** (exact counts, this repo, 2026-09-15):

```
Disallow un-serializable expressions in Qwik $ scopes (useQwikValidLexicalScope) — 159
Enforce useExhaustiveDependencies — 23
Avoid Expression Not Assigned — 22
Enforce use of button type — 17
Avoid pass in except block — 15
Disallow implicit any on let/var declarations — 14
Avoid Using Non-Literal User Input for File System Paths — 14
Avoid Server-Side Request Forgery (SSRF) by Validating User-Controlled URLs — 14
Avoid Use of Cryptographically Weak Random Number Generators — 12
Avoid using array index as key — 12
Detect Python Source Code Errors with Pyflakes — 11
Detect Insecure Dependencies (High Severity) — 9
Enforce Iterable Callback Return Consistency — 7
EnforceUseKeyWithClickEvents — 6
Detect Insecure Dependencies (Medium Severity) — 6
Disallow interactive handlers on static elements (noStaticElementInteractions) — 6
Avoid Unreachable Code — 5
Enforce Exhaustive Dependency Lists in React Hooks — 5
Use semantic elements instead of role attributes — 4
Disallow assignments in expressions (noAssignInExpressions) — 4
Avoid Using Unsafe Dynamic Method Calls — 4
Avoid Using Non-Literal Values in RegExp Constructor — 3
Avoid Unused Variables — 2
Avoid Path Traversal via path.join or path.resolve with User Input — 2
Disallow Redeclaration (noRedeclare) — 2
Enforce SVG has accessible title or label — 2
Disallow control characters in regular expressions — 2
Enforce Pinning of Third-Party GitHub Actions to Full Commit SHA — 2
Detect Insecure Dependencies (Critical Severity) — 2
Others — 15
```

## 2. Contract & Implementation Directives

Work in this worktree (already checked out on `main`, clean):
`.claude/worktrees/oc-wave-a-qaintel-rules`, branch
`chore/wave-a-qaintel-rules`.

### Step 1 — investigate the Qwik anomaly FIRST (159 occurrences, do not skip)
This repo is Next.js/React, not Qwik. 159 hits on a rule for a framework
this codebase doesn't use is almost certainly either (a) Codacy misdetecting
the stack for some files/directory, or (b) a vendored/generated/dependency
directory being scanned that shouldn't be (e.g. `node_modules`,
`.next/`, a build artifact dir). Find the actual flagged files (check
Codacy's dashboard/API if accessible, or grep for Qwik-specific syntax
patterns like `$(` component boundaries or `useSignal`/`component$` — if
none exist in this codebase, that confirms misdetection). If it's a
scope/config issue: this needs a Codacy config exclude, NOT a new qa-intel
rule — report this finding clearly, don't force a rule for a non-issue.

### Step 2 — cluster and design rules for the REAL, applicable items

**Security cluster (HIGH priority regardless of count)**: SSRF (14),
non-literal-FS-paths (14), weak RNG (12), insecure deps (9+6+2=17
combined), path traversal (2), non-literal RegExp (3), control-chars-in-regex
(2). Check `scripts/quality-engine/rules/` for what's already covered (this
project's rule-authoring conventions: `IRule`/`Rule` interfaces,
`allowSelfAnalysis` opt-in pattern from PR #309, test-file exemption
patterns from PR #310-313) before designing new rules — do not duplicate
existing coverage. NOTE: this same session has real, verified-in-code
examples from the parallel security-triage dispatch of BOTH true positives
and false positives for SSRF/RNG/path-traversal patterns in THIS codebase
— check `.memory/AGENT_LEDGER.md` for that dispatch's findings once it
posts (may not be done yet; if not, proceed independently and note it as a
cross-check TODO) so your new rule's heuristic doesn't just re-flag the
same false-positive shapes CC already investigated.

**React-hooks cluster (consolidate, don't duplicate)**:
`useExhaustiveDependencies` (23) + `Enforce Exhaustive Dependency Lists in
React Hooks` (5) + `array index as key` (12) + `EnforceUseKeyWithClickEvents`
(6) — these are likely reported by different Codacy tool backends for the
SAME underlying React hooks-deps / list-key issue classes. Design ONE
qa-intel rule cluster covering hook-dependency-array completeness and
list-key correctness, not 4 separate rules.

**Accessibility cluster**: button type (17), semantic-elements-vs-role (4),
SVG title/label (2), static-element-interactions (6) — map to this repo's
existing `web-design-guidelines` skill/conventions if a11y rules aren't
already in qa-intel; check first.

**Code-quality/correctness cluster (LOWER priority, still worth 1-2 rules
if cheap)**: Expression-Not-Assigned (22), implicit-any-on-let/var (14),
Iterable-Callback-Return-Consistency (7), Unreachable-Code (5),
Assignments-in-Expressions (4), Unsafe-Dynamic-Method-Calls (4),
Unused-Variables (2), Redeclaration (2).

**Explicitly NOT this codebase's problem (do not build rules for)**:
`Avoid pass in except block` (15) and `Detect Python Source Code Errors
with Pyflakes` (11) — Python-specific, likely from `testsprite_tests/*.py`
or `scripts/research/*.py` if this repo has any — verify these are
low-stakes test/script files, not core app logic, before deciding whether
they're even worth a rule (qa-intel is a TS/JS engine per its own file
layout — check if it has ANY Python-rule capability before assuming this
needs new infrastructure; if not, this may be entirely out of scope for
qa-intel and better handled by a Python linter directly, flag this to CC
rather than building Python support into a TS-focused engine).
`Enforce Pinning of Third-Party GitHub Actions to Full Commit SHA` (2) —
this is a `.github/workflows/*.yml` concern, not application code; check if
qa-intel scans YAML at all before deciding whether it fits this engine or
needs a separate lightweight check.

### Step 3 — implement, for each cluster you decide is a real qa-intel gap
Follow this repo's established rule-authoring pattern exactly (read 2-3
existing rules in `scripts/quality-engine/rules/*.ts` first for the real
current shape, don't guess from memory). Each new/extended rule needs:
1. A regression test with a NEGATIVE CONTROL proving the rule actually
   fires on a real violating fixture.
2. The rule run against the FULL codebase (`--mode full`) to gauge current
   real violation count in THIS repo — report this count, don't just ship
   blind. If a new rule would immediately flood the codebase with hundreds
   of pre-existing violations, flag that explicitly (does it need a
   grandfather/baseline exemption, like `allowSelfAnalysis`, rather than
   blocking all current PRs on unrelated pre-existing debt?).
3. Verify it does NOT false-positive on this repo's own legitimate code
   (the false-positive-class problem is exactly why this session exists —
   see PR #307's `VariableNamingRule` fix and PR #309's self-check bug for
   precedent on how seriously this project takes false-positive avoidance).

## Negative-control tests — MANDATORY for every new/extended rule

Prove the OLD ruleset does NOT catch the violation (if extending), prove
the NEW rule DOES catch a real fixture violation, and prove it does NOT
flag this repo's own legitimate code that matches the pattern shape but is
actually safe.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

- **ALWAYS**: `qa-intel` (both modes — you're building INTO this engine, so
  running it on itself matters even more than usual), `code-reviewer`,
  `simplify`, `review-delta`, `review-duplication`, `contract-auditor`.
- `owasp-top-10` — mandatory for the security-cluster rule design.
- `web-design-guidelines` — for the accessibility cluster.
- Use `build-graph`/`query_graph_tool` (Step 0) to check what's already
  covered before designing anything new.

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm dlx tsx scripts/verify-quality-engine.ts --mode full --ci
pnpm exec tsx web/scripts/contract-auditor.ts
```

## 4b. External CI

Push to `chore/wave-a-qaintel-rules`, open a PR. This changes the
CI-blocking ruleset itself — per this repo's established precedent (PR
#309), this deserves review rather than a direct push to main.

---

## 5. The Three Tenets — [ALWAYS INCLUDE]

> 1. Contract definition + enforcement.
> 2. E2E cycle complete, input to output, across the ENTIRE chain.
> 3. Tangent hunt as you walk the workflow.

## 6. Report Format — [ALWAYS INCLUDE]

> RCA → Contract → Fix → E2E proof → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Additionally: report the Qwik-anomaly finding clearly and separately at the
TOP of your report (it may change how the user reads the rest of the list —
if 159 of the "top" count is noise, the real priority order shifts).

Do NOT merge or close the PR yourself — CC verifies and merges.
