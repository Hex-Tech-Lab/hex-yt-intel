# OC Prompt — Non-descriptive title display fallback, 2026-08-05

Follow-up to #14 (closed as not-a-bug: video `EoKdX13w7SI` is genuinely
titled "April 28, 2026" by its creator, confirmed via YouTube oEmbed API
independently of the DB). The user's point stands even though it's not a
data bug: a bare-date title is useless in a history list.

## Contract

When persisting/displaying a video title that matches a "non-descriptive"
pattern (bare date like "April 28, 2026", "4/28/26", or empty/whitespace),
prepend the channel name so the history list stays scannable:
`"{channel_name} — {original_title}"`. Do NOT alter the stored raw title
(it's the real YouTube title, keep it as ground truth) — this is a display
formatting rule, likely in `mapHistoryOverviewRow` (referenced in an earlier
session's "History Title Fallback" work) or wherever history rows are
rendered. Channel name is already fetched (`MetadataScraper.ts` — same
`snippet` object as title).

## RCA before fix

Confirm where the display-layer title fallback currently lives and whether
it already handles null/missing titles (it does, per earlier session work)
but not present-and-non-descriptive ones (it doesn't, this is the gap).

## E2E

Verify against the real row: `analyses.id=dde9ebe3-0c40-4712-95d3-41a4e5cada22`
should render as something like "Mark Johnson — April 28, 2026" in the
history list after the fix, not bare "April 28, 2026".

## Skills

CORE: qa-intel, contract-auditor, /simplify. SELECT: react-best-practices
if this touches a rendering component.

## Report format

RCA → Contract → Fix → Tangents → Skills run → Gates → Files changed.
