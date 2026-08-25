# Agent Dispatch Prompt — Shared Playback-Engine Hook (3 combined /simplify findings)

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file; post `[IN_PROGRESS]` with
intent + target files as your first action; re-check the ledger after every
subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
actually happened as your last action.

## 1. Context

`hex-yt-intel`'s highlights-reel feature (PR #258, merged tonight) has two
components -- `web/components/dashboard/HighlightsScrubber.tsx` (authenticated
dashboard, uses `useVideoStore`) and `web/app/share/[token]/PublicHighlightsReel.tsx`
(anonymous public share view, uses `YouTubePlayerAdapter` directly, no store)
-- that independently implement the SAME segment-advance state machine: a
media-time-clamping poll, a seek-settlement guard, and a speed-scaled
advance-to-next-segment. Only the time-source primitive differs (store poll
vs local `setInterval` against `YouTubePlayerAdapter.getCurrentTime()`).

A mandatory `/simplify` 4-agent review pass on that PR found 3 related
findings, deferred to this follow-up task rather than rushed before merge
(logged in `docs/TECH_DEBT_LEDGER.md`, "2026-08-20 — Highlights-reel
redesign: /simplify findings deferred past merge"):

1. **Duplicated media-time-clamping state machine** across both files.
2. **Three uncoordinated timers for one concept**: `useHighlightTicker.ts`
   (`web/lib/hooks/useHighlightTicker.ts`) owns its own 150ms `setInterval`
   for word-reveal, running alongside each scrubber's own 250ms
   advance-poller -- all three independently derive "how far into this
   segment are we."
3. **`HighlightsScrubber`'s videoMetadata guard lives in the caller, not the
   component.** `web/components/containers/DashboardContainer.tsx` was
   patched with `status === 'complete' && analysisId && videoMetadata` at
   the one current call site to prevent an orphaned scrubber with no player
   context -- a future call site would need to independently rediscover
   this same guard.

These three are being combined into ONE task because they all touch the
same 1-2 files and are naturally one refactor: extracting the shared engine
is where the timer consolidation and the readiness guard both belong.

## 2. Task

Extract a shared playback-engine hook, e.g.
`web/lib/hooks/useSegmentPlayback.ts`, that both `HighlightsScrubber.tsx`
and `PublicHighlightsReel.tsx` call, parameterized over a small primitive
interface so each caller supplies its own time-source/seek adapter:

```ts
interface SegmentPlaybackPrimitives {
  getCurrentTime: () => number | null;
  seekTo: (seconds: number) => void;
  play?: () => void;
  setPlaybackRate: (rate: number) => void;
}
```

`VideoPlayerPort` (`web/lib/ports/VideoPlayerPort.ts`) already exists and is
close to this shape -- check whether the hook should accept a `VideoPlayerPort`
directly or a narrower interface; don't force a fit that doesn't work, note
your reasoning in the report.

The hook should own:
- The media-time-clamping poll (250ms cadence, matching
  `VideoPlayerCard.POLL_INTERVAL_MS`) and its seek-settlement guard (mirrors
  `EntityMentionTimeline.tsx`'s `issueSeek`/`pendingSeekSeconds` pattern,
  already replicated in both scrubber files -- read both current
  implementations in full before writing the shared version, they are your
  spec).
- Segment index state, `playFrom`/`start`/`stop`/`jumpTo` actions.
- Speed state (`SPEED_OPTIONS`, `handleSpeedChange`) -- currently duplicated
  verbatim in both files.
- The elapsed-in-segment time value, exposed so `useHighlightTicker` can
  consume it INSTEAD of running its own separate 150ms timer (finding #2).
  `useHighlightTicker.ts`'s word-reveal math (`revealedWordCount` based on
  elapsed/duration ratio) should be rewritten to take an externally-supplied
  elapsed-seconds value as a parameter instead of owning `setInterval` +
  `Date.now()` internally. Check its existing test coverage
  (none currently -- add a focused test for the new external-time-driven
  version, following this project's existing test patterns e.g.
  `web/lib/prompts/highlights-extraction.test.ts`).
- A built-in readiness/no-op guard (finding #3): the hook itself should
  refuse to start/advance playback when its own `getCurrentTime` primitive
  isn't actually ready (e.g. returns null), so `HighlightsScrubber`'s render
  condition in `DashboardContainer.tsx` no longer needs to independently
  guess "is the player ready" via `videoMetadata` presence -- though you may
  keep a component-level guard too if genuinely needed for a different
  reason (e.g. not rendering the whole card when there's nothing to show);
  distinguish "hook is safe to call" from "component should render at all"
  and don't conflate them.

Both `HighlightsScrubber.tsx` and `PublicHighlightsReel.tsx` should end up
calling this one hook, each passing their own primitives (store-backed for
the authed variant, `YouTubePlayerAdapter`-backed for the public variant),
with their component bodies shrinking to mostly presentational wiring +
`HighlightsTrack` rendering.

## 3. Goal / definition of done

- One shared hook, both components use it, no duplicated state-machine
  logic remains between them.
- `useHighlightTicker` no longer runs its own independent timer.
- Playback behavior is IDENTICAL to before from a user's perspective --
  this is a refactor, not a behavior change. Verify via the existing test
  suites plus a live manual check.
- `DashboardContainer.tsx`'s `HighlightsScrubber` render-guard is
  simplified/removed if the hook now makes it redundant, or kept with a
  clear reason if not.

## 4. Expected results

- New: `web/lib/hooks/useSegmentPlayback.ts` (+ a test file for it).
- Modified: `web/components/dashboard/HighlightsScrubber.tsx`,
  `web/app/share/[token]/PublicHighlightsReel.tsx`,
  `web/lib/hooks/useHighlightTicker.ts` (+ its test, if you add one),
  possibly `web/components/containers/DashboardContainer.tsx` (guard
  simplification), possibly `web/lib/ports/VideoPlayerPort.ts` if the
  primitive interface needs a small addition.
- `docs/TECH_DEBT_LEDGER.md`'s corresponding entry updated to mark these 3
  items resolved (with commit reference) once verified, not left stale.

## 5. Task-specific skills/tools/MCPs

- `react-best-practices` -- this is exactly the kind of hooks/closures/
  dependency-array refactor that skill covers; apply it to the new hook
  directly, don't just bolt it on afterward.
- No database/migration involved.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Before touching any code, run `code-review-graph`'s
`build_or_update_graph_tool`, then `get_review_context_tool`/
`get_impact_radius_tool` scoped to the 5 files listed in section 4, before
reading whole files.

**Branch**: start fresh from `main` (all 3 tonight's PRs are merged). Create
your own branch, e.g. `refactor/shared-segment-playback-hook`.

**Existing pattern to follow**: `EntityMentionTimeline.tsx`'s seek-settlement
guard is the proven reference implementation for that specific mechanism --
read it, and its own inline comments describing prior bugs in that exact
pattern (stale-seek races), before writing the shared version so you don't
reintroduce a bug that pattern already fixed once.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the hook's exact
   `SegmentPlaybackPrimitives` interface and return shape before writing
   it. After writing it, check both call sites against that contract.
2. **E2E cycle complete.** A passing unit test on the hook in isolation is
   NOT sufficient -- verify both `HighlightsScrubber` and
   `PublicHighlightsReel` still actually advance segments correctly with a
   real or realistic timeline (existing component tests +
   `HighlightsTrack.test.tsx` should still pass; extend them if the refactor
   changes what's testable).
3. **Tangent hunt.** While extracting this, check whether `SPEED_OPTIONS`'s
   duplication into a THIRD place (`YouTubePlayerAdapter.setPlaybackRate`'s
   hardcoded `0.5`/`3` clamp bounds) should also be unified now that you're
   touching this exact area -- single source of truth for the speed range.
   Report if fixed or if judged out of scope.

**If the refactor risks changing actual playback behavior (not just
structure), STOP and flag the specific behavioral risk in your report
rather than shipping a silent behavior change under a "refactor" label.**

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (test output + live manual verification,
not just "tests pass") → Tangents found → Deviations flagged (if any) →
Skills run + findings → Gates (exact output) → Files changed → branch name
for CC to review.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```

Do NOT open a PR or merge -- push the branch and report back to CC (the
dispatching session) for 10x verification before anything lands.
