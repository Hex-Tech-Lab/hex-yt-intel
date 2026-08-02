# Tech Debt Ledger

A **dynamic, priority-sorted roster** — not static P0/P1/P2 buckets. Every item
carries a numeric score computed from the rubric below; new findings insert at
their computed rank, not appended at the bottom. Re-sort whenever an item's
status or score changes.

## Scoring rubric

`score = Severity(1-3) × Blast Radius(1-3) × Impact(1-3)` — max 27.

- **Severity**: 1 = cosmetic/style, 2 = degraded behavior, 3 = wrong output / security / data loss
- **Blast radius**: 1 = single file, narrow feature, 2 = one module/feature area, 3 = core/every-request path (analysis creation, auth, billing)
- **Impact**: 1 = no user-visible effect, 2 = user sees a degraded/confusing outcome, 3 = user gets an actively wrong answer, loses data, or a security boundary is crossed

`status`: `open` | `fixed` | `false-positive` | `deferred` (needs a larger contract change or explicit user call)

## Roster (sorted by score, descending)

| Score | # | Finding | File(s) | Status | Note |
|---|---|---|---|---|---|
| 27 | 1 | Transcript-fetch network failure silently misreported as "no captions" | `web/lib/adapters/WorkerIngestionAdapter.ts` | **fixed** | `fetchWorkerTranscript()` had no try/catch; a rejected promise fell through `Promise.allSettled` to an empty transcript with **zero logging** — indistinguishable from the video genuinely having no captions, which the UI reports as a normal (non-error) outcome. Every single analysis creation goes through this path. Fixed: try/catch + `Sentry.captureException` + `console.warn` on the fallback branch; metadata-fetch rejection now preserves the real error instead of a generic string. Regression test added: `web/lib/__tests__/WorkerIngestionAdapter.test.ts` (4 cases). |
| 12 | 13 | `ERR_NO_TRANSCRIPT` conflated "genuinely no captions" with "extraction pipeline exhausted" | `worker/src/ports/TranscriptProviderPort.ts`, `worker/src/services/TranscriptExtractor.ts`, `worker/src/routes/analysis.ts`, `web/app/api/analyses/persist/route.ts`, `web/hooks/useSSEStream.ts` | **fixed** | User confirmed: distinguish both. Added `confirmedNoCaptions` flag (true only when YouTube's caption-list API AND the page's own data both independently confirm zero tracks — one alone failing doesn't count, avoids false claims), new `NoCaptionsConfirmedError` marking those exact sites, a second placeholder string + new client code `ERR_TRANSCRIPT_PIPELINE_UNAVAILABLE` with accurate retry-this-video messaging. Every old `.includes("Transcript unavailable")` string-match gate updated to also catch the new placeholder (5 sites) so it can't slip through as real content. Also consolidated per-tier Sentry `captureException` calls (previously 3 separate, hard-to-correlate events) into one `captureMessage('Transcript pipeline exhausted', {extra: {tierFailures}})` carrying the full per-tier failure breakdown in a single searchable event — direct response to "how can we fix something if we don't know which part is failing." Full web suite: 917/917 passing, worker build clean. |
| 12 | 2 | Per-bundle stream network failures had zero Sentry telemetry | `web/hooks/useSSEStream.ts` | **fixed** | Raw `fetch()` failures to the CF worker re-thrown as-is with no context; `abortOnPartialFailure` (default `true`) aborted the whole analysis on one bundle's transient network error with only "network error" to go on. Fixed: `Sentry.captureException` at both the connection-failure site (bundle index + worker host) and the aggregate per-stream catch (covers read/parse failures too); error message now names the bundle. Prompted by a live incident (video `LTNVA2iP9YU`, 2026-08-02). |
| 8 | 16 | `req.tier` read but never sent — every user's SSE meta frame reports `tier: "free"` | `worker/src/chat-stream.ts:328`, `web/lib/usecases/ProcessChatMessageUseCase.ts` | **fixed** | Threaded `tier: UserTier` through `ProcessChatMessageUseCase`'s payload (already destructured from params) and added `tier?: string` to `ChatStreamRequest`; `useChatStore.ts` forwards `job.payload` unfiltered (no allowlist to update). Worker + web typecheck clean, full web vitest suite (917 passed) green. |
| 8 | 6 | Persist call, no retry/error-state | `web/app/atlas/AtlasClient.tsx`, `web/lib/services/sentry-telemetry.ts` | **fixed** | Transient network blip was a permanently lost write with no user-visible failure. Applied the existing `MetadataScraper.fetchComments` retry shape (`worker/src/services/MetadataScraper.ts`): max 2 attempts, immediate retry (no backoff, low-traffic paths), 4xx client errors treated as non-retryable (retry can't fix a bad request), everything else (5xx/network) gets one retry. `AtlasClient.tsx`: on final failure, `console.error` + `showToast(..., 'error')` via the existing `web/lib/dashboard/toast-bridge.ts` pattern (already used by `export.ts`, `ChatDock.tsx`, etc.) instead of silently swallowing. `sentry-telemetry.ts`: on final failure, `console.error` + a new `console.warn` before falling back to the existing static-healthy-state, so the failure is visible in logs instead of compounding the pre-existing silent fallback. No test files existed for either component. |
| 8 | 10 | `SILENT_ERROR_RETURN_NO_TELEMETRY` | `web/lib/utils/require-admin.ts` (×2), `web/middleware.ts`, `web/lib/skills/wiki-builder/wiki-builder.ts` (×2) | **fixed** | Same class as the already-fixed `LLMCascade.ts` pattern (commit `23eb5a36`) — failure objects returned with no throw/log. `require-admin.ts`: both the 401 (unauthenticated) and 403 (non-admin) branches now `console.warn` + `Sentry.captureMessage` at `warning` level (denials are routine individually, worth seeing in aggregate — probing/broken-client/upstream-bug signal). `middleware.ts`: the `bearer_invalid` branch inside `hasSupabaseAuth` now `console.warn`s (not `Sentry.captureMessage` — the caller already reports to Sentry for any request with a real credential via the `hadCredential` branch, so a second report here would double up; the other `ok:false` branches in that function already had `console.error`/`console.warn`, this was the only truly silent one). `wiki-builder.ts`: `getAllActiveUsers`'s two catch/error branches already had `console.warn`/`console.error` but no Sentry — added `Sentry.captureMessage`/`captureException` for parity (same gap class as item 14's `MetadataScraper.ts`). Typecheck clean, full web suite 917/917 passing. |
| 5 | 5 | `openrouter.ts` stream-timeout error-state settling | `web/lib/services/openrouter.ts` | **deferred** | `callOpenRouter` has zero current callers (verified via exhaustive grep), but ADR 011 explicitly documents it as the intentional dormant Vercel single-model-completion fallback ("chat completions, if ever used") — **do not delete**. On final-tier `AbortError` it already correctly `throw`s (not a silent swallow). No caller exists yet to catch that throw and settle UI/DB state — re-verify the day this path gets wired up, not before. |
| 4 | 14 | `MetadataScraper.ts`: `fetchChannelDetails` had no Sentry parity with its siblings | `worker/src/services/MetadataScraper.ts` | **fixed** | Read line-by-line (grep-count triage was wrong again — same pattern-miss as item 13, file uses `console.warn`/`Sentry.captureMessage` throughout, well-instrumented). Every method except `fetchChannelDetails` already reported to Sentry; that one only threw a bare `Error`. Both current callers already catch+`console.warn`/`error` it, so nothing was silently lost — just invisible to Sentry search/alerting. Added `Sentry.captureMessage` for parity. Rescored down from 8 (was based on the wrong triage) to 4 — real gap, but low severity since callers already log it, and no misdiagnosis risk like items 1/13. |
| — | 15 | `CommentClassifier.ts` | `worker/src/services/CommentClassifier.ts` | **false-positive, no action** | Read line-by-line. Well-instrumented: every cascade-tier failure logs via `console.warn`, and the "all tiers exhausted" case reports once to Sentry for the whole batch (deliberate design — avoids per-comment noise). Grep-count triage was wrong a third time in this wave — same lesson every time: read the file before scoring it, never trust a catch-vs-log line count alone. |
| 2 | 11 | `UNVERIFIED_ENDPOINT_NO_TEST` (hardcoded OpenRouter URLs) | `web/lib/intelligence/relations-engine.ts`, `web/lib/services/dimension-remediation.ts`, `web/lib/services/openrouter.ts`, `worker/src/chat-stream.ts`, `worker/src/services/CommentClassifier.ts`, `worker/src/services/LLMCascade.ts` | open | 6 sites, no contract test against OpenRouter's request/response shape. Not urgent — cheap insurance, one shared contract test would cover all 6. |
| 2 | 12 | qa-intel rule-quality: false positives found this scan | `scripts/verify-quality-engine.ts` (`InformationDisclosureRule`, POST-307 detector, `DataIntegrityRule`, empty-catch detector) | open | Low individual score but high leverage — fixing these reduces noise on every future scan. See `docs/qa-intel/RULESET_LESSONS_LEDGER.md` for the 5 specific false-positive entries logged 2026-08-02. |
| 1 | 8 | Empty catch in test file | `worker/src/__tests__/TranscriptExtractor.test.ts` (×3) | open | Test-only, no prod blast radius. |
| 1 | 9 | Persist call in test file | `web/lib/__tests__/SupabaseTranscriptAdapter.test.ts` | open | Test-only. |

### Already resolved this scan, not re-scored

- **Item 7** — `web/lib/chat/outbox.ts`'s `write()` catch: real data-loss risk (chat message silently not persisted on quota/private-mode failure), **fixed** with a `console.warn`. The other 3 originally-flagged empty-catch sites (`YouTubePlayerAdapter.ts:141`, `useSearch.ts:132`, `useRelations.ts:89`) were verified **false-positive** — each has an explanatory comment and a sibling catch in the same function that already logs the real failure.
- **Item 4** — "DB write with no schema validation" (`admin/settings`, `admin/stats`, `billing/checkout`, `upstash-snapshot-poll`): verified **false-positive** — `admin/settings` is pure reads (matches an already-known 2026-07-25 qa-intel bug, still unfixed at the rule level); the other three insert only server-computed/already-validated fields, no raw external input reaches the DB.
- **Items 1-3** (P0 in the prior version of this ledger) — YAML injection, POST-307, `userId`-in-logs: all verified **false-positive**, logged to the ruleset ledger.

## Network-Error RCA & Telemetry Wave (opened 2026-08-02, worker/ audit complete)

Triggered by a live incident where a single transient network failure aborted
an entire analysis with only "network error" to diagnose it by, plus a
confirmed-worse sibling bug (item 1) that silently misreported a network
failure as a content fact. Scope: audit every `fetch()`/`catch` pair across
`web/` and `worker/` for (a) swallowed error reasons, (b) missing telemetry,
(c) misleading fallback behavior. Triage so far (fetch-count / catch-count /
Sentry-or-log-count per file, `web/` only — `worker/` triage is partial):

- `web/lib/admin-logs/fetchers.ts` — 8/19/11 (healthy ratio, not flagged)
- `web/lib/adapters/WorkerIngestionAdapter.ts` — was 4/1/0, **now fixed** (item 1)
- `web/hooks/useSSEStream.ts` — was 3/10/4, **now fixed** (item 2)
- `web/lib/services/dimension-remediation.ts` — 2/7/4 (healthy, not flagged)
- Remaining `web/` files with 0 Sentry near their catch (`useAutoRestoreAnalysis.ts`, `useStreamReattach.ts`, `UsersAdminClient.tsx`, `AdminSettingsClient.tsx`, `LogsViewerClient.tsx`, `UpstashVectorAdapter.ts`, and ~15 single-fetch hooks) were individually inspected — all use intentional `console.debug`/best-effort patterns on non-critical/background paths (chat session restoration, status polling) or are low-blast-radius admin UI. Not re-flagged; re-check only if one becomes a reported incident.
- `worker/src/services/TranscriptExtractor.ts` — read line-by-line: well-instrumented, no fix needed at that layer. Real finding moved one layer downstream to the `ERR_NO_TRANSCRIPT` message-conflation issue (item 13, **fixed**).
- `worker/src/services/MetadataScraper.ts` — read line-by-line: well-instrumented except `fetchChannelDetails` (item 14, **fixed** — added Sentry parity with its siblings).
- `worker/src/services/CommentClassifier.ts` — read line-by-line: well-instrumented, no fix needed (item 15, **false-positive**).
- **Lesson learned 3x in this wave**: grep-count triage (`fetch(` vs `catch` vs logging-string counts) was wrong on all three `worker/` files — each uses `console.warn`/`Sentry.captureMessage` patterns the initial grep patterns didn't match. The ratio is a decent *prioritization signal for what to read first*, never a substitute for reading the file. Worker-side network-error audit is now complete — `web/` was already fully triaged (see above). Remaining open items (6, 10, 11, 16) don't belong to this wave; they're separate findings from the broader qa-intel/contract-auditor sweep.

## Not re-litigated here

CodeFactor complexity/style findings on `DimensionDrawer.tsx` /
`ExpandedPanelOverlay.tsx` (missing JSDoc, non-null assertions, cyclomatic
complexity 8) surfaced during PR #183/#185 review — already logged as
pre-existing, non-blocking, not duplicated into this ledger. See PR #183/#185
review threads.

## Next scan

Re-run `pnpm tsx scripts/verify-quality-engine.ts --mode full` and
`pnpm tsx web/scripts/contract-auditor.ts` after clearing the top of the
roster to confirm no regressions and re-sort.
