# PR #321 (observability) — external review, 2026-09-24 (head cb5d1aa). Status: addressed in round 2 (1c2a4615, ada3b0cb).
- P0 CodeFactor, DeepSource web, Netlify preview failing (Netlify = free-plan concurrent-build collision, not code).
- P1 Observability query filtered only `$metadata.error` exists → outcome-only events (`exceededCpu`) dropped.
- P1 second fetch had no timeout → a hung API holds the admin request open despite "fail-soft".
- P1 `limit: 100` silently truncated; no `truncated` flag.
- P1/P2 unexpected response shape silently became `[]` (`?.events ?? []`) → 200 with no data, no warning.
- P2 raw external `error`/`message` interpolated into newline-delimited log text → log-line forgery.
- P2 tests missed outcome-only events, µs→ms, error counts, malformed shape, timeout, >100 events.
- P2 `totalEntries` semantics changed without consumer check; stale comment about response shape.
