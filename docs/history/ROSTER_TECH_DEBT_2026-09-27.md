# Standing Tech-Debt Roster — created 2026-09-27

**Rule (user directive 2026-09-27)**: debt discovered mid-task is NEVER declared "pre-existing" and dropped — it goes on this roster the moment it is found, and is handled at the next debt-clearing slot after the current task closes. Nothing on this list is "forgotten until later"; it is tracked until closed.

| # | Opened | Found by | Item | Impact | Status |
|---|---|---|---|---|---|
| D1 | 2026-09-27 | OC | `worker` `tsc --noEmit` reports 99 lines of errors: `web/lib/env.ts:134` + `web/lib/types/contracts.ts:122` use `window` without DOM lib (2-3 errors), and ~8 worker test files cannot resolve `vitest` types / have implicit-any params (`ApifyTranscriptProvider.test.ts`, `SupadataTranscriptProvider.test.ts`, likely more — full list in worker tsc output) | Worker repo type-check is red at baseline; masks real regressions in worker type safety | OPEN — negative-control verified pre-existing (identical 99-line count before/after 2026-09-27 UCIS changes) |
| D2 | 2026-09-27 | OC | web lint: 3 unused-var warnings (`useHistoryOverview.test.tsx:10` unused `waitFor`, `highlights-coverage.test.ts:30` unused `SEGMENTS`, `:164` unused `completion`) | Noise; hides future real warnings | OPEN |
