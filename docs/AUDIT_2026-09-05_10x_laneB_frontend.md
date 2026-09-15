# 10x Re-Audit — Lane B: Frontend/React Architecture
Skills applied: `react-best-practices`, `web-design-guidelines`, `composition-patterns`. Scope: `web/` changes in `ba94b9bf..HEAD`, focused on the Highlights-Reel rework (largest workstream, 25 commits).

## Status of the 3 previously-known tech-debt items (docs/TECH_DEBT_LEDGER.md, logged 2026-08-21)

| Item | Status | Evidence |
|---|---|---|
| Astryx `variant="primary"` renders white not cyan (app-wide) | **STILL OPEN** | Confirmed present in `HighlightsScrubber.tsx:267` (Play/Pause IconButton) and `TopBar.tsx:148` — both post-date the debt entry, meaning new code kept using the known-broken variant instead of a workaround or the underlying Astryx fix. |
| Scrubber never live-verified at 375/390px | **STILL OPEN, code shape unchanged** | `HighlightsScrubber.tsx:291` footer row is still `flex items-center justify-between gap-2` with no `flex-wrap` — the exact code-level risk the debt entry named is unchanged since 08-21. |
| `MIN_LABEL_GAP_PCT` is %-based not pixel-measured | **STILL OPEN, unchanged** | `HighlightsTrack.tsx:221`, same constant, same comment acknowledging the limitation, no ref/measured-width follow-up landed. |

None regressed further, but none were fixed either — they've simply persisted through 10 days and ~25 commits touching these exact files.

## New findings

**[High] `PlayheadNeedle` re-renders on every 250ms poll tick independent of visibility** — `HighlightsTrack.tsx:147-161` subscribes directly to `currentPlaybackSeconds` via Zustand selector, which is the correct narrow-scope pattern (doesn't re-render the parent `HighlightsTrack`). Verified this is *not* a perf issue — flagging only because it's the one place in this file doing fine-grained subscription; the marker buttons/labels around it do not, and are memoized correctly (`useMemo` on `markerLeftPcts`/`labelVisibility`, `useCallback` on `pctFor`). **No action needed** — noting it as a correct pattern other components in the same file don't need to copy but also don't undermine.

**[Medium] Composition: `HighlightsScrubber.tsx` renders an IIFE inside JSX** (`{(() => {...})()}`, lines 274-287) to compute `activeSegment` for the verbatim-caption block, when `activeSegment` could be a plain `const` above the `return` (it doesn't depend on anything not already in scope). Not a bug, but `composition-patterns` flags this as avoidable indirection — a plain variable is more readable and testable than an inline IIFE.

**[Medium] Prop-drilling depth in `HighlightsTrack`/`HighlightsNav`**: `highlights`, `activeIndex`, `onSelect` are threaded through 2 levels with a `Pick<...>` type to keep `HighlightsNav`'s subset in sync — this is a reasonable, disciplined pattern (not boolean-prop proliferation), but `hideNav` is a boolean flag controlling whether `HighlightsNav` renders inside `HighlightsTrack` vs. being rendered separately by the caller. This is the one boolean-prop smell in the file; a compound-component split (`<HighlightsTrack.Nav>` / `<HighlightsTrack.Track>`) would remove the flag entirely. Low priority — only 2 call sites (`HighlightsScrubber`, presumably `PublicHighlightsReel`), not yet worth the refactor.

**[Low] Accessibility — permanent-label row is fully `aria-hidden`** (`HighlightsTrack.tsx:337`), which is correct (the info is duplicated via each marker button's own `aria-label`), confirmed not a gap — noting only because it's easy to mistake for a miss on first read.

**[Low] `getClampedSegmentEnd`/settings fallback chain** (`HighlightsScrubber.tsx:87-89`) reads `data?.X ?? HIGHLIGHTS_REGISTRY_FALLBACK[...]` three times inline — minor duplication, could be a single destructure, not worth a dedicated pass.

## Compounding-risk check (cross-skill synthesis)

No finding in this lane compounds with another in the same component — the two open tech-debt items (mobile layout + label-gap %) both live in the *same two files* (`HighlightsScrubber.tsx`, `HighlightsTrack.tsx`) and *would* compound at narrow viewports (unverified flex-wrap + %-based collision threshold both degrading simultaneously on a small screen), which is exactly the mobile risk the original debt entry described — this audit did not find a new compounding risk beyond what was already flagged, just confirmed it's still live and unaddressed.

## Summary

- **Critical: 0, High: 1 (informational, not a defect), Medium: 2, Low: 2**
- **0 new regressions.** The Highlights-Reel code is unusually well-documented in-line (each fix cites the live report/PR that drove it) and shows real accessibility care (44px hit targets, aria-live, focus rings) — this is solid work, not a rushed patch job.
- **Top 3 issues**: (1) known Astryx `variant="primary"` bug still shipping in new code rather than being routed around, (2) mobile/narrow-viewport verification still never done despite 10 more days of related commits landing in the same files, (3) minor composition smell (IIFE-in-JSX) worth a 1-line cleanup, not a priority.
