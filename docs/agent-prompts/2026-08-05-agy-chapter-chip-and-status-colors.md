# AGY Prompt — Chapters chip + 3-color status convention, 2026-08-05

Chapters landed on `feat/chapters-and-speaker-id` (migration
`20260805000000_add_transcript_chapters.sql`, `worker/src/services/
chapter-parser.ts`, `entity-time-seek.ts` chapter-priority path — read
these before starting, don't re-derive what already exists). This prompt is
UI-only: expose chapter-fetch status as a chip, and make the 3-color
convention consistent across every existing status chip, not just the new
one.

## Contract

Every status-style chip (existing and new) uses exactly 3 states:
- **Green** — data fetched/available (chapters present for this video,
  dimension present, etc.)
- **Orange** — attempted but failed (chapter parse ran, description had no
  parseable markers or parse errored — distinguish from "not attempted")
- **Grey** — not available / not attempted (no chapter data exists for this
  video, most already-analyzed videos, per the additive-fallback design in
  `docs/specs/CHAPTERS_AND_SPEAKER_ID_SPEC_2026-08-05.md`)

## Fix — Part 1: new ChapterChip

Add a `ChapterChip` next to the existing `PlatformChip`/`MetricChip` in
`web/components/templates/console/AnalysisHistory.tsx` (~line 58-91, follow
the same component shape). Data source: whether `transcript_chapters` rows
exist for the video (join/count, or a boolean the row already carries if
the history RPC exposes it — check `get_user_history_overview` and extend
it with a `has_chapters` boolean if it doesn't already surface one, that's
a small RPC change, cheaper than N+1 querying `transcript_chapters` per
row). Three states as above: green (rows exist), orange (parse was
attempted — e.g. `worker/src/services/chapter-parser.ts` ran and returned
zero, meaning attempted-but-empty counts as failed/no-signal, distinguish
from grey), grey (chapter parsing hasn't run for this video at all, e.g.
pre-dates the feature).

## Fix — Part 2: audit existing chips against the 3-color convention

`PlatformChip` (line 58) currently omits itself entirely for
null/unrecognized platforms instead of showing a grey "unavailable" state —
per its own comment this was a deliberate choice for older rows. Decide:
does it now need to conform to the 3-color convention (grey chip shown, not
omitted), or is the omission still correct for this specific chip? Don't
silently change behavior — state the RCA for whichever you pick.

Audit `MetricChip` usages (Dimensions produced/received, Executive digest,
Partial analysis, etc. — lines 636-764) the same way: do any of these
currently use ad hoc colors instead of the green/orange/grey convention?
List every chip you touch or explicitly decide not to touch, with why.

## Tangent hunt

Check `web/components/templates/console/WordCloud.tsx` and `ChatDock.tsx`
(both also use "chip" terminology per earlier grep) for any status-style
chips that should also conform, even if out of scope to fix this pass —
report them.

## E2E verification

Real page load of the history list with: (a) a video that has chapters
(green), (b) a video where chapter parsing ran and found nothing (orange),
(c) an older video that predates the feature (grey). Screenshot or describe
actual rendered state for all three, not just unit assertions.

## RCA before fix

Required, visible step — especially for the `PlatformChip` omission
decision above.

## Skills — enumerate live, not from memory

CORE: qa-intel, contract-auditor, `/simplify`.
SELECT (checked fresh against `.claude/skills/pr-review-workflow`):
`web-design-guidelines` (color/contrast for 3-state chips, must work in
both light/dark theme per Astryx tokens — don't hardcode raw hex, use
theme-neutral tokens), `composition-patterns` (chip prop API consistency
across PlatformChip/MetricChip/ChapterChip), `react-best-practices` if any
new state/data-fetching is introduced for the `has_chapters` signal.

## Report format (mandatory)

RCA → Contract → Fix → Tangents found → Skills run + findings → Gates
(tsc/lint/vitest/qa-intel) → Files changed. CC independently verifies
against real rendered output before merging.
