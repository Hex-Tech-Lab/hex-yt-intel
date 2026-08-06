# OC Prompt — ADR 024: happy-dom + React Testing Library Setup + 4 Test Files

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — read it now
if you haven't already. Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md`
before touching any file; post `[IN_PROGRESS]` with intent + target files as
your first action; re-check the ledger after every subtask; post
`[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually
happened (not what you intended) as your last action.

## 1. Context

Read `docs/specs/ADR_024_COMPONENT_HOOK_RUNTIME_TEST_COVERAGE_2026-08-06.md`
in full FIRST — it has the complete origin (three real bugs this session
that no existing gate could have caught, since none render a real DOM),
the confirmed current gap, and the exact scope boundary (4 files, not a
framework migration).

One-paragraph summary: this repo's `vitest.config.ts` currently runs with
`environment: 'node'` and an `include` glob (`lib/__tests__/**/*.test.ts`,
`../worker/src/__tests__/**/*.test.ts`) that matches neither `.tsx` files
nor anything in `web/hooks/`/`web/components/`/`web/store/` — meaning no
test in this repo can currently render a React component or hook. Three
real bugs shipped this session that direct-rendering tests would have
caught immediately (see ADR §1 for the specific bugs and files). This task
adds `happy-dom` + React Testing Library, fixes the config gap, and writes
4 targeted regression tests — one per already-fixed bug, so each test
literally proves the specific bug that already happened can't silently
come back.

## 2. Task

**2a. Add dependencies.** `happy-dom`, `@testing-library/react`,
`@testing-library/jest-dom` as devDependencies in `web/package.json`.
Check current installed versions of `react`, `react-dom`, `vitest` in
`web/package.json` first and pick compatible versions (React 19 needs a
React Testing Library major version that supports it — verify, don't
assume the latest tag is automatically compatible). Use `pnpm` (never npm/
npx/yarn — this repo is pnpm-only, npx is broken in this environment's
WSL2 setup).

**2b. Fix `web/vitest.config.ts`.** Current state (read it yourself to
confirm before editing — it may have changed):
```ts
test: {
  globals: true,
  environment: 'node',
  include: ['lib/__tests__/**/*.test.ts', '../worker/src/__tests__/**/*.test.ts'],
  exclude: [...configDefaults.exclude, 'tests/**'],
},
```
Extend `include` to also match `.tsx` test files under `hooks/`,
`components/`, and `store/` (e.g. add `'hooks/**/*.test.{ts,tsx}'`,
`'components/**/*.test.{ts,tsx}'`, `'store/**/*.test.{ts,tsx}'` — verify
the exact glob syntax Vitest expects, and check whether the EXISTING
`lib/__tests__/**/*.test.ts` entries should also gain a `.tsx` variant if
any hook/component tests might reasonably live there instead of the new
directories). Decide `environment`: per the ADR, the existing pure-utility
`lib/__tests__/**` suite doesn't need a DOM and paying happy-dom's setup
cost for every one of those files is wasted overhead — investigate
Vitest's current recommended pattern for mixing DOM and non-DOM test files
in one project (a per-file `// @vitest-environment happy-dom` docblock
override is one known mechanism; confirm it's still current for this
Vitest version rather than assuming) and apply whichever approach doesn't
force the whole suite onto the DOM environment unnecessarily.

**2c. Write 4 new test files**, each covering the EXACT bug class already
found and fixed in that file this session — re-derive the precise scenario
from the file's own code comments (several have an explicit RCA comment
documenting the bug, which doubles as the test spec) rather than inventing
a generic test:

1. `web/hooks/useChapters.ts` — test: mount the hook via
   `renderHook` (React Testing Library), trigger the store's `reset(videoId)`
   action externally, assert the hook actually restarts its fetch (not
   permanently stuck) — this is literally the self-cancellation bug's
   inverse: prove a reset() DOES retrigger a fetch, and prove a component
   unmount/remount before the fetch settles doesn't leave the store
   entry permanently stuck at `'loading'`. Mock `fetch` (the module already
   calls `fetch('/api/videos/.../chapters')` — use Vitest's `vi.stubGlobal('fetch', ...)`
   or an equivalent, don't hit a real network).
2. `web/hooks/useExecutiveDigest.ts` — test: mount the hook, mock a
   successful `/api/analyses/digest` response, assert
   `useAnalysisStore.getState().analysis.executiveDigest` actually gets
   populated (the exact bug: it used to only exist in local hook state,
   never reaching the store).
3. `web/hooks/useKnowledgeGraph.ts` — test: render with a `graph` prop/store
   state that has zero API-fetched nodes and zero payload-embedded nodes,
   assert the client-side TF-IDF fallback synthesis path actually produces
   a non-empty graph from dimension content (this connects to ADR 023 — if
   that ADR's fix has already landed by the time you do this task, write
   the test against the FIXED behavior; if not, write it as a proof of
   current behavior and flag if it fails, don't silently adjust the
   assertion to match a bug).
4. `web/components/templates/console/WordCloud.tsx` — test: render with a
   graph containing 2+ words sharing one KG node id, click one word via
   `fireEvent`/`userEvent`, assert only that word is visually indicated as
   selected (check the canvas draw call arguments or, if the canvas
   context can't be meaningfully asserted on in happy-dom, assert via the
   `aria-label`/live-region text instead, whichever is actually
   observable in a DOM-only test environment — canvas pixel content isn't
   -- pick the real testable surface, don't write an assertion that can't
   actually fail).

Each test file's header comment should state which real incident it's a
regression test for (mirroring the pattern in
`web/lib/__tests__/useChaptersStore.test.ts`, which already documents this
convention — follow it).

## 3. Goal / definition of done

`pnpm --filter @hex-yt-intel/web exec vitest run` picks up and passes all 4
new test files, each one genuinely capable of failing if its corresponding
bug were reintroduced (verify this directly — temporarily revert the
relevant fix locally, confirm the new test fails, then re-apply the fix and
confirm it passes again; this is the same negative-control-verification
pattern this project uses elsewhere, don't skip it).

## 4. Expected results

- `web/package.json`: `happy-dom`, `@testing-library/react`,
  `@testing-library/jest-dom` added as devDependencies.
- `web/vitest.config.ts`: include glob extended to cover `.tsx` and the
  real hook/component/store directories; DOM environment scoped
  sensibly (not blanket-applied if avoidable).
- 4 new test files as specified in §2c.
- The EXISTING test suite (currently 65 files / 1045 tests) still passes
  unchanged — this task adds coverage, it must not break or slow down
  existing tests.

## 5. Task-specific skills/tools/plugins/MCPs

CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets are
[ALWAYS INCLUDE] below. Beyond that: `react-best-practices` applies (you're
writing tests FOR React hooks/effects, understanding their timing matters
for writing tests that actually exercise the real bug, not a simplified
version of it). No Supabase/DB/worker changes in this task.

## 6. Fixtures

Run `code-review-graph`'s `build_or_update_graph_tool` then
`get_review_context_tool`/`get_impact_radius_tool` scoped to
`web/vitest.config.ts`, `web/hooks/useChapters.ts`,
`web/hooks/useExecutiveDigest.ts`, `web/hooks/useKnowledgeGraph.ts`,
`web/components/templates/console/WordCloud.tsx`,
`web/lib/__tests__/useChaptersStore.test.ts` (the existing test-file-header
convention to follow) before reading full files. Start from `main` at its
current HEAD (`git log --oneline -1`).

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** For each of the 4 tests, state
   the exact bug scenario it proves can't silently recur BEFORE writing
   it, then verify the test actually exercises that scenario (not a
   simplified stand-in for it).
2. **E2E cycle complete, input to output, across the ENTIRE chain.** Do
   the negative-control verification described in §3 (revert the fix,
   confirm the new test fails, re-apply, confirm it passes) for ALL 4
   tests, not just the first one you write. A test that would pass even
   with the bug reintroduced is worse than no test — it creates false
   confidence.
3. **Tangent hunt.** While setting up the DOM environment, check whether
   any other existing behavior in the touched hooks/components was
   ALREADY relying on `environment: 'node'`'s absence of DOM globals in a
   way that could break once happy-dom is available (unlikely but check —
   e.g. any code doing `typeof window === 'undefined'` feature-detection
   that assumed test environment = no window). Report tangents found even
   if not fixed this pass.

**If you cannot complete a full cycle or find a design gap, STOP and
report the specific deviation and why.**

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (the negative-control verification
results for each of the 4 tests, not just "tests pass") → Tangents found →
Deviations flagged → Skills run + findings → Gates → Files changed. CC
independently re-verifies every claim against real code and real system
state before accepting.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' — empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # EXACT CI flags, not the bare default run
pnpm tsx web/scripts/contract-auditor.ts
```
