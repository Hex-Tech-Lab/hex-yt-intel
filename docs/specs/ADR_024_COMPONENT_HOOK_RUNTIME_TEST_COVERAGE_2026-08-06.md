# ADR 024 — Component/Hook Runtime Test Coverage (happy-dom + React Testing Library)

**Status**: approved (2026-08-06), not yet implemented — see the dispatch
prompt at `docs/agent-prompts/2026-08-06-oc-happydom-rtl-setup.md`.

## 1. Origin

User question, 2026-08-06: given qa-intel and contract-auditor exist, is
adding React Testing Library + a DOM emulator (jsdom/happy-dom) worth it?
Answered from this session's own track record, not hypothetically — three
real bugs shipped and were caught only via manual code-tracing this
session, not by any existing gate:

1. `useChapters.ts` self-cancellation (whole-store Zustand subscription in
   an effect dependency array causing the effect to cancel its own
   in-flight fetch).
2. `WordCloud.tsx` missed-repaint + ARIA-staleness (a ref mutated inside a
   `useEffect` doesn't trigger a re-render, so canvas paint and the
   accessible label could desync from the actual selection state).
3. `useExecutiveDigest.ts` digest-not-syncing-to-store (a value computed
   in one hook's local state never reaching the shared store another
   component reads from).

All three are **runtime React behavior** bugs (effect timing, ref-vs-state
reactivity, cross-hook data flow) — not syntactic/structural pattern
violations. `qa-intel` and `contract-auditor` are AST/text pattern-matchers:
they encode "this SHAPE of code has caused a bug before" as a rule (see
`ZustandWholeStoreInEffectDepsRule`, written AFTER bug #1 was found and
fixed, not before) — they cannot execute a component and observe what it
actually does on a state change. This is a structural ceiling of static
analysis, not a rule-coverage gap that more qa-intel rules will ever fully
close: a genuinely novel runtime interaction won't match any existing
pattern rule until after it's already caused an incident once.

## 2. Confirmed existing gap

`web/vitest.config.ts`'s `include` glob is:
```
['lib/__tests__/**/*.test.ts', '../worker/src/__tests__/**/*.test.ts']
```
This matches neither `.tsx` files at all, nor anything outside
`lib/__tests__/` — meaning `web/hooks/`, `web/components/`, and
`web/store/` have ZERO test discovery today regardless of what test files
might exist there, and no `.tsx` file could ever be picked up even if the
directory matched. Combined with no jsdom/happy-dom dependency installed at
all, no test in this repo can currently render a React component or hook
and observe real runtime behavior — this is the literal, structural reason
none of the three bugs above could have been caught by "running the test
suite," even in principle, before this ADR.

## 3. Scope decision

**Chosen: happy-dom over jsdom.** Lighter, faster startup, sufficient DOM
surface for this project (no exotic browser API dependencies — no
canvas-heavy WebGL, no complex layout/measurement APIs beyond what
`WordCloud.tsx`'s existing `document.createElement('canvas')` +
`getContext('2d')` measurement calls need, which happy-dom supports).

**Scoped test-file target — NOT a blanket coverage mandate.** Cover the two
categories this session repeatedly found real bugs in:
- Hooks with effects that read/write shared (Zustand) state:
  `useChapters.ts`, `useExecutiveDigest.ts`, `useKnowledgeGraph.ts`.
- Components mixing imperative (canvas/ref) state with reactive
  (React state/props) state: `WordCloud.tsx`.

That's 4 test files, not a framework-wide migration. Expand later, driven
by where the NEXT bug of this class turns up — don't pre-build coverage
for hooks/components that haven't shown this failure pattern.

**qa-intel/contract-auditor are unchanged, not superseded.** They catch a
different class of thing (static shape/pattern issues, security boundary
violations, contract/schema drift) that RTL tests don't touch and
shouldn't try to. This ADR is additive to the existing gate stack, not a
replacement for any part of it.

## 4. Contract

- `web/vitest.config.ts`: `include` glob extended to actually match `.tsx`
  files and the real hook/component/store directories (`hooks/`,
  `components/`, `store/`, alongside the existing `lib/__tests__/` and
  worker paths) — audit the exact current glob before changing it, don't
  assume the shape without reading the live config.
- New dev dependency: `happy-dom` (test environment) + `@testing-library/react`
  + `@testing-library/jest-dom` (assertion matchers) — verify exact current
  versions compatible with this repo's React 19 / Vitest 4 / TypeScript
  6.0.3 stack before pinning.
- `vitest.config.ts`: `test.environment` set to `'happy-dom'`, scoped via
  Vitest's per-file environment override (`// @vitest-environment happy-dom`
  docblock, or a separate config block) if pure-utility tests (the existing
  `lib/__tests__/**` suite, which doesn't need a DOM) should keep running
  without the DOM environment's overhead — verify Vitest's current
  recommended pattern for mixed DOM/non-DOM suites in one project rather
  than assuming.
- 4 new test files (one per component/hook listed in §3), each covering the
  SPECIFIC bug class already found in that file this session (re-derive the
  exact scenario from the file's own code comments — several of the fixes
  above left a comment documenting the RCA, which doubles as the test spec).

## 5. Non-goals

- No blanket "test everything" mandate.
- No replacement of qa-intel/contract-auditor/`/simplify` in the pre-commit
  gate stack — this is an addition, all existing gates stay as-is.
- No E2E/browser-automation framework (Playwright, Cypress) — this ADR is
  scoped to component/hook unit-level runtime testing, a different and
  smaller problem than full E2E.
