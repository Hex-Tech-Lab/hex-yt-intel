# Agent Dispatch — Fix PR #216 (ADR 021 Phase 1) per Cubic findings

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `CLAUDE.md` §2 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file. Post `[IN_PROGRESS]` with
intent + target files as your first action. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]`
with a real summary as your last action.

## 1. Context

hex-yt-intel. PR #216 (`feat/adr021-phase1-dimension-persist`, head `4ee4657e`)
implements ADR 021 Phase 1 — merging `BracketBuffer`-captured streaming
dimension fragments into `PersistService.persist()` so an interrupted
analysis doesn't lose already-generated dimensions. A prior agent
implemented and reported this as DONE with 1113/1113 tests passing, but
Cubic's PR review (below, verbatim, do not re-derive — treat as the ground
truth of what to check) found real correctness gaps the prior agent's tests
did not catch, PLUS the PR currently has 3 FAILING required CI checks
(CodeFactor, Lint, Pipeline Status) and 13 unresolved review threads. This
PR is NOT mergeable as-is.

**Cubic's findings (verbatim, ranked P0/P1/P2/P3):**

- **P0 — CI is red.** CodeFactor, Lint, and Pipeline Status are failing at
  head `4ee4657e`. Fix whatever these report — run them locally first
  (`pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json`,
  the repo's lint command, and re-check CodeFactor's actual rule via
  `gh pr checks 216`) before touching correctness logic, since a red build
  blocks everything else regardless of logic correctness.

- **P1 — `worker/src/routes/analysis.ts`: unverified parser emission
  boundary.** The fix's premise is that `BracketBuffer`'s `onFragment`
  callback fires per-dimension as each nested object completes, DURING
  streaming, independent of whether the outer JSON object ever closes. This
  was never verified against the actual `BracketBuffer` source — if it only
  emits after the outer object closes successfully, a malformed/truncated
  outer payload (the exact incident scenario: force-abort mid-generation)
  produces ZERO callbacks, and the whole Phase 1 fix does nothing for the
  case it was built to fix. **Read `BracketBuffer`'s actual source and its
  existing tests FIRST.** If it confirms per-dimension incremental emission
  independent of outer-object closure, add a regression test that proves it
  (feed it a stream that ends mid-outer-object and assert dimensions before
  the truncation point were still emitted). If it does NOT confirm that,
  this is a design gap, not a one-line fix — flag it explicitly rather than
  patching around it, per the three-tenets "STOP and report" clause below.

- **P1 — `worker/src/services/PersistService.ts`: `mergeDimensions()` can
  discard valid captured data.** When `extractedDims.length` happens to
  equal `capturedDims.length`, the function can return the original
  (unvalidated) extracted array even if some extracted entries were
  actually invalid (e.g. `[null]` sitting alongside one captured dimension)
  — length-equality is being used as a stand-in for "nothing was missing,"
  which is wrong. Fix: only treat a captured dimension as "covered" by an
  extracted one when that specific extracted entry is itself schema-valid
  (not just when the array lengths line up). Add tests for: extracted
  contains `null`/malformed entries, extracted missing a `number` field,
  extracted with invalid `content`.

- **P1/P2 — `PersistService.ts`: extracted dimensions can override captured
  ones without full shape validation.** Currently only `number` and
  `content` presence seem checked before letting an extracted entry win
  over a captured one; a malformed `name` field on the extracted side can
  still poison the merged payload and fail Zod validation for the whole
  chunk. Fix: only let an extracted dimension override a captured one when
  the COMPLETE dimension shape is valid per the existing Zod dimension
  schema (number, name, content, any other required fields) — otherwise
  keep the captured value. Add an end-to-end test asserting the actual
  wire body sent to `/api/analyses/persist`.

- **P1/P2 — `PersistService.ts`: captured-only fallback breaks when
  `chunkIndex` is omitted (full, non-chunked persistence path).** The merge
  builds `{ schemaVersion, dimensions }` and then routes into the full
  `UCISPayloadSchema`, which requires additional top-level fields
  (`persona`, `classification`, etc.) that a captured-only fallback doesn't
  have — so the full-payload path can fail Zod validation and either fall
  back to markdown-only silently or spam Sentry with what's actually
  expected fallback behavior, not a real error. Trace every call site of
  `PersistService.persist()` (both with and without `chunkIndex` set) and
  define the actual intended behavior for this case: construct a valid
  minimal UCIS payload from whatever metadata is actually available, use an
  explicitly-supported partial-persistence contract, or explicitly skip
  structured persistence for this path without emitting it as an unexpected
  schema error. Add tests for the omitted-`chunkIndex` case and check
  Sentry call volume/severity for this path is appropriate once fixed.

- **P2 — ADR doc missing required header fields.** `docs/specs/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`
  is missing the repo's standard spec header (Filename, Location, Version,
  Build, Timestamp, Purpose) — check `docs/specs/` for the established
  template on another ADR file and match it.

- **P2 — ADR doc's Phase 1 implementation note overstates certainty.** It
  currently asserts `BracketBuffer` confirms each dimension independently
  before outer-object completion as settled fact. Once the P1 parser-boundary
  item above is actually verified against source (not assumed), correct this
  note to describe the OBSERVED, VERIFIED emission behavior — including what
  happens on a malformed/truncated outer object — not the originally intended
  design. Do not claim independent recovery works unless a regression test
  in this PR actually proves it.

- **P3 — test file uses `any` heavily; `mergeDimensions()` is called with
  `extracted as any`.** Align `extractJsonPayload()`'s return type with the
  merge function's actual contract (or accept `Record<string, unknown>` and
  narrow explicitly inside `mergeDimensions()`), and replace test `any`
  usage with a typed captured-request-body helper. Don't let this block the
  P1/P0 items — do it after those are solid, time permitting.

- **P3 — `CLAUDE.md`'s ADR 021 ledger row ambiguity.** Clarify that ONLY
  Phase 1 is implemented, Phases 2-4 remain scoping/not-started — don't let
  the row read as if the whole ADR is done.

- **P3 — `.memory/AGENT_LEDGER.md` marked DONE despite unresolved
  correctness gaps.** Update the entry once this pass actually resolves
  the P1 items — don't just re-mark DONE without the gaps being genuinely
  fixed and tested this time.

## 2. Task

Work through the findings above in priority order: P0 (CI red) first — you
cannot usefully evaluate anything else until the build is green — then the
three P1 correctness items (parser boundary verification, merge data-loss,
override shape-validation, full-UCIS-payload contract), then P2, then P3 if
time allows. For EACH correctness item, follow this project's mandatory
"three tenets" (contract, E2E proof, tangent hunt) below — a fix without a
regression test proving the SPECIFIC failure mode Cubic described is not
acceptable; that is exactly the class of gap that let this PR ship broken
the first time (unit tests passed, but they tested the happy path, not the
malformed/edge cases Cubic found).

## 3. Goal / definition of done

- `gh pr checks 216` shows 0 failing required checks.
- All P1 findings have a regression test that FAILS on the pre-fix code and
  PASSES on the fix (verify this directly — temporarily revert the fix
  locally, confirm the new test fails, then reapply — this project's
  "negative control verification" convention, see memory).
- The `BracketBuffer` emission-boundary question is answered with actual
  evidence (source + test), not restated as an assumption in the ADR doc.
- All 13 unresolved Cubic review threads on PR #216 are either fixed (reply
  confirming what changed) or explicitly and specifically rebutted with
  evidence if you believe a finding is a false positive — never silently
  ignored.

## 4. Expected results

- Modified: `worker/src/routes/analysis.ts`, `worker/src/services/PersistService.ts`,
  `worker/src/__tests__/persist-dimension-merge.test.ts` (extended, not just
  the existing happy-path tests), possibly a new integration-style test file
  if the parser-boundary case needs its own aborted-stream test harness.
  `docs/specs/ADR_021_GRANULAR_PARTIAL_RESUME_AND_REAPER_2026-08-02.md`
  (header + corrected implementation note), `CLAUDE.md`, `.memory/AGENT_LEDGER.md`.
- New commits pushed to the EXISTING branch `feat/adr021-phase1-dimension-persist`
  (do not open a new PR — this one already exists, push fixes to it).
- A reply comment posted on PR #216 (via `gh pr comment` or replying to
  Cubic's review threads via `gh api`) summarizing what was fixed against
  each finding.

## 5. Task-specific skills/tools/MCPs

Beyond CORE (qa-intel, contract-auditor, `/simplify`): re-run `qa-intel`'s
`StreamResilienceRule`/`PersistResilienceRule`/`ErrorTaxonomyRule` classes
specifically — this PR is exactly their target incident class (see
`.claude/skills/qa-intel`'s "Rule Origins" table). `code-review-graph` MCP
for `get_impact_radius_tool` on `PersistService.ts`/`analysis.ts` before
editing, per this repo's Step-0 mandate.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Run `code-review-graph` MCP's `build_or_update_graph_tool`
then `get_review_context_tool`/`get_impact_radius_tool` scoped to
`worker/src/services/PersistService.ts`, `worker/src/routes/analysis.ts`,
and wherever `BracketBuffer` is defined, before reading full files.

**[FILL IN]**: Start from branch `feat/adr021-phase1-dimension-persist`
(fetch it, don't recreate it) at head `4ee4657e`. Read the full Cubic
review via `gh pr view 216 --json reviews,comments` and
`gh api repos/Hex-Tech-Lab/hex-yt-intel/pulls/216/comments` for the exact
13 unresolved thread locations before starting — the summary above is
Cubic's synthesis, but the raw inline comments will have exact file:line
anchors you need.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact input→output
   contract for what you're building BEFORE writing it. After writing it,
   check the diff against that stated contract — not "does it compile,"
   but "does this actually fire on the real path it claims to fix."
2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
   passing unit test proving a function's isolated output is correct is
   NOT sufficient evidence the fix works — trace the real caller chain
   with actual proof (a live DB query showing a row landed, a real HTTP
   round-trip, not a mock standing in for the whole chain).
3. **Tangent hunt as you walk the workflow.** While touching each file,
   check adjacent call sites and control-flow branches for the same class
   of gap. Report tangents found even if not fixed this pass.

If you cannot complete a full cycle, or find a design gap mid-task (e.g. if
`BracketBuffer` genuinely cannot emit before outer-object closure and fixing
that is a bigger design change than this PR should absorb), STOP and report
the specific deviation and why, rather than shipping a partial fix under a
"done" label. That is exactly what went wrong the first time this PR was
built — do not repeat it.

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (cite actual command/query output, not
"tests pass") → Tangents found → Deviations flagged (if any) → Skills run
+ findings → Gates (exact output) → Files changed.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
gh pr checks 216
```
