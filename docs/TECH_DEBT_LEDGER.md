# Tech Debt Ledger

A **dynamic, priority-sorted roster** — not static P0/P1/P2 buckets. Every item
carries a numeric score computed from the rubric below; new findings insert at
their computed rank, not appended at the bottom. Re-sort whenever an item's
status or score changes.

**Assignment workflow (2026-08-03)**: cheap/well-scoped items on this roster
default to OC (opencode / DeepSeek v4 Flash, low effort) for both
investigation and the fix — see CLAUDE.md's "Agent roster" section. CC
(Claude Code) verifies the resulting diff against real sources before
marking an item `fixed`; a fix report alone is not sufficient to close an
item. Every dispatch prompt must include CLAUDE.md's "Mandatory sections
in every AGY/OC prompt" template (contract def+review, E2E, tangent hunt,
RCA-before-fix, full skill enumeration, structured report) — not optional
for tech-debt items just because they're individually small.

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
| 8 | 18 | `worker/` package has no vitest type declarations or test runner of its own | `worker/tsconfig.json`, `worker/package.json` | open | Found 2026-08-09 auditing ADR 026 Phase 1's new `chunk-grouping.test.ts`. `worker/tsconfig.json`'s `types` array lists only `@cloudflare/workers-types`, never `vitest`; `worker/package.json` has no vitest devDependency and its `test` script is a literal `"echo \"No tests yet\""` stub. Real, non-trivial consequence: every file in `worker/src/__tests__/` (at least 6 pre-existing files plus this session's new one) fails `tsc --noEmit` when run from inside `worker/` with `Cannot find module 'vitest'`, and none of them are swept by any default test command — they only run when `web/vitest.config.ts` (which aliases into `worker/src/`) is pointed at them with an explicit path, confirmed working (5/5 new tests passed this way). The tests are real and not broken, they're just invisible to `worker/`'s own tooling and to any CI step that scopes to `worker/`. Fix: add `vitest` to `worker/package.json` devDependencies and `"vitest"` to `worker/tsconfig.json`'s `types` array (or point worker's `test` script at `web/vitest.config.ts` explicitly) — small, bounded, not done here (out of scope for the PR that found it). |
| 8 | 6 | Persist call, no retry/error-state | `web/app/atlas/AtlasClient.tsx`, `web/lib/services/sentry-telemetry.ts` | **fixed** | Transient network blip was a permanently lost write with no user-visible failure. Applied the existing `MetadataScraper.fetchComments` retry shape (`worker/src/services/MetadataScraper.ts`): max 2 attempts, immediate retry (no backoff, low-traffic paths), 4xx client errors treated as non-retryable (retry can't fix a bad request), everything else (5xx/network) gets one retry. `AtlasClient.tsx`: on final failure, `console.error` + `showToast(..., 'error')` via the existing `web/lib/dashboard/toast-bridge.ts` pattern (already used by `export.ts`, `ChatDock.tsx`, etc.) instead of silently swallowing. `sentry-telemetry.ts`: on final failure, `console.error` + a new `console.warn` before falling back to the existing static-healthy-state, so the failure is visible in logs instead of compounding the pre-existing silent fallback. No test files existed for either component. |
| 8 | 10 | `SILENT_ERROR_RETURN_NO_TELEMETRY` | `web/lib/utils/require-admin.ts` (×2), `web/middleware.ts`, `web/lib/skills/wiki-builder/wiki-builder.ts` (×2) | **fixed** | Same class as the already-fixed `LLMCascade.ts` pattern (commit `23eb5a36`) — failure objects returned with no throw/log. `require-admin.ts`: both the 401 (unauthenticated) and 403 (non-admin) branches now `console.warn` + `Sentry.captureMessage` at `warning` level (denials are routine individually, worth seeing in aggregate — probing/broken-client/upstream-bug signal). `middleware.ts`: the `bearer_invalid` branch inside `hasSupabaseAuth` now `console.warn`s (not `Sentry.captureMessage` — the caller already reports to Sentry for any request with a real credential via the `hadCredential` branch, so a second report here would double up; the other `ok:false` branches in that function already had `console.error`/`console.warn`, this was the only truly silent one). `wiki-builder.ts`: `getAllActiveUsers`'s two catch/error branches already had `console.warn`/`console.error` but no Sentry — added `Sentry.captureMessage`/`captureException` for parity (same gap class as item 14's `MetadataScraper.ts`). Typecheck clean, full web suite 917/917 passing. |
| 6 | 17 | Supabase logs `logs.all` endpoint is deprecated; its successor `/logs` (ClickHouse SQL) is currently broken for `postgres_logs` | `web/lib/admin-logs/fetchers.ts` (`fetchSupabaseLogs`) | **fixed** | Dual-path strategy implemented: try `/logs` first, fall back to `logs.all` on empty result. Sentry telemetry tracks which path is used. `console.warn` + `Sentry.captureMessage` when the deprecated endpoint serves data. The `/logs` endpoint returns empty for `postgres_logs` as of 2026-08-03 — likely a ClickHouse migration issue. When it stabilizes, remove the fallback path. See `docs/REPORT_ITEM17_SupabaseLogs.md`. |
| 5 | 5 | `openrouter.ts` stream-timeout error-state settling | `web/lib/services/openrouter.ts` | **deferred** | `callOpenRouter` has zero current callers (verified via exhaustive grep), but ADR 011 explicitly documents it as the intentional dormant Vercel single-model-completion fallback ("chat completions, if ever used") — **do not delete**. On final-tier `AbortError` it already correctly `throw`s (not a silent swallow). No caller exists yet to catch that throw and settle UI/DB state — re-verify the day this path gets wired up, not before. |
| 4 | 14 | `MetadataScraper.ts`: `fetchChannelDetails` had no Sentry parity with its siblings | `worker/src/services/MetadataScraper.ts` | **fixed** | Read line-by-line (grep-count triage was wrong again — same pattern-miss as item 13, file uses `console.warn`/`Sentry.captureMessage` throughout, well-instrumented). Every method except `fetchChannelDetails` already reported to Sentry; that one only threw a bare `Error`. Both current callers already catch+`console.warn`/`error` it, so nothing was silently lost — just invisible to Sentry search/alerting. Added `Sentry.captureMessage` for parity. Rescored down from 8 (was based on the wrong triage) to 4 — real gap, but low severity since callers already log it, and no misdiagnosis risk like items 1/13. |
| — | 15 | `CommentClassifier.ts` | `worker/src/services/CommentClassifier.ts` | **false-positive, no action** | Read line-by-line. Well-instrumented: every cascade-tier failure logs via `console.warn`, and the "all tiers exhausted" case reports once to Sentry for the whole batch (deliberate design — avoids per-comment noise). Grep-count triage was wrong a third time in this wave — same lesson every time: read the file before scoring it, never trust a catch-vs-log line count alone. |
| 2 | 11 | `UNVERIFIED_ENDPOINT_NO_TEST` (hardcoded OpenRouter URLs) | `web/lib/intelligence/relations-engine.ts`, `web/lib/services/dimension-remediation.ts`, `web/lib/services/openrouter.ts`, `worker/src/chat-stream.ts`, `worker/src/services/CommentClassifier.ts`, `worker/src/services/LLMCascade.ts` | **fixed** | Single shared contract test added: `web/lib/__tests__/contracts/openrouter-request.contract.test.ts` (11 assertions, no network calls — Zod schema against OpenRouter's documented chat-completions request shape, validated against per-site fixtures copied field-for-field from each call site). Covers all 5 sites that actually POST to `/chat/completions` (`openrouter.ts`, `relations-engine.ts`, `chat-stream.ts`, `CommentClassifier.ts`, `LLMCascade.ts` — the latter has 2 call sites, both covered). Bonus finding: `dimension-remediation.ts` does **not** construct a chat-completions body at all — its only direct OpenRouter call is `GET /auth/key` (balance check); real analysis requests are delegated S2S to the Worker's `/analyze-llm-stream`, which internally uses the already-covered `LLMCascade.ts`. Also found real body-shape inconsistencies across the 5 sites: `temperature` varies (0.3/0.2/0.6/1/unset), `provider.allow_fallbacks` is `false` everywhere except `CommentClassifier.ts` (`true`, and conditional), and the `user` correlation field is sent by 3 of 5 sites but not `openrouter.ts` or `CommentClassifier.ts`. None of these are bugs per se, just undocumented drift — see test file header comment for full detail. |
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

## Open — missing REVOKE on pre-existing SECURITY DEFINER function (2026-08-05)

`public.purge_expired_transcripts()` and `public.compliance_check_transcripts()`
in `supabase/migrations/20260718000000_add_transcripts_and_markers.sql` are
`SECURITY DEFINER` with no `revoke execute ... from anon, authenticated,
public` — same gap class as the PR #179 incident that this project's own
`pr-review-workflow` mandatory sub-check exists to catch (precedent:
`update_analysis_result_atomic`, `get_user_history_overview`). Found while
reviewing the sibling `transcript_chapters` migration (which copied this
pattern and has now been fixed with an explicit REVOKE before merge, since
it hadn't shipped yet). This one has likely already been applied to prod —
fixing it needs a new migration plus a live `select grantee, privilege_type
from information_schema.routine_privileges where routine_name = '...'`
check, not a blind edit to an already-applied file. Not fixed yet — flagging
for the next scan pass.

## Open — stale `anon` UPDATE grant on `public.users` (2026-08-08)

`information_schema.role_table_grants` shows table-level `UPDATE` on
`public.users` still granted to `anon` (also `authenticated`, `service_role`,
`postgres`) after PR #202's self-role-escalation fix. **Not currently
exploitable**: `users_update_own`'s RLS `USING`/`WITH CHECK` requires
`auth.role() = 'authenticated'`, which `anon` can never satisfy, so the
table-level grant is dead weight, not a live hole. Found during a post-merge
`supabase-postgres-best-practices` audit of PR #202 (2026-08-08) that
independently re-verified the fix against the live DB (`pg_trigger`,
`pg_policy`, `information_schema.role_table_grants`) rather than trusting the
migration file alone — the fix itself (a `BEFORE UPDATE` trigger blocking
`role` changes) is confirmed live and correctly enforced; this is a separate,
lower-severity least-privilege cleanup on the same table.

Deliberately not fixed in that pass: revoking a grant on `public.users` (a
security-sensitive production table) without explicit sign-off, even though
the fix itself is a trivial one-line migration:

```sql
revoke update on public.users from anon;
```

No `NOT VALID`/`VALIDATE CONSTRAINT` needed (grants aren't constraints).

## Next scan

Re-run `pnpm tsx scripts/verify-quality-engine.ts --mode full` and
`pnpm tsx web/scripts/contract-auditor.ts` after clearing the top of the
roster to confirm no regressions and re-sort.

## 2026-08-18 — `analyses.duration_seconds` is a dead/NULL column

Found while running the digest/UCIS parity test: `analyses.duration_seconds`
is NULL on all 210 real rows checked. Real video-duration data lives instead
at `analysis_payload->'videoMetadata'->>'duration'`, and even that's only
populated on 32/210 rows — the rest have no video-length metadata captured
at all.

**Impact**: any real analytics/pricing work relying on video length (e.g.
the compound-quota design in the pricing master doc, which caps by
"total video hours") currently has no reliable source for it across most
of the dataset.

**Not fixed this pass** — flagged for next wave. Real fix needs: (1) confirm
whether `duration_seconds` should be backfilled from `videoMetadata.duration`
where available, or deprecated/dropped since it's never written; (2) confirm
why `videoMetadata` itself is missing on ~85% of rows (fetch failure? column
added after those rows were created? worth checking real ingestion code path
via `code-review-graph` before assuming); (3) if kept, add real write-path
coverage so future rows populate it consistently.

## 2026-08-18 — Cascade provider order has THREE sources of truth, not one — real SSOT violation

Found while fixing Haiku 4.5's provider order (Vertex→Azure→Anthropic Direct→
Bedrock, per real OpenRouter speed data). There are actually THREE places
this config lives, out of sync:

1. `web/lib/config/cascade.ts` — `ANALYSIS_CASCADE_FALLBACK` constant (fixed 2026-08-18)
2. `setting_values` DB table, `cascade.analysis` key — the documented "real" source of truth (fixed 2026-08-18)
3. `worker/src/services/LLMCascade.ts` (2 occurrences) — a SEPARATE hardcoded
   fallback `['anthropic', 'google-vertex', 'amazon-bedrock']` for Haiku 4.5,
   with NO Azure at all, never touched by today's fix. This may be the
   actual code path driving real worker-side analysis calls, meaning
   today's registry fix might not have changed real production behavior.

**Not fixed this pass** (checkpoint-constrained, flagged for immediate next
session): the worker needs to read `cascade.analysis` from the same
Settings Registry as the web app (worker has no DB access per ADR 005 —
check how it currently receives cascade config, likely via the signed
stream payload forwarded from web per cascade.ts's own comment — the fix
is probably "web resolves the real registry value and forwards it to the
worker," not "worker queries DB directly"). Until fixed, do not trust that
editing `cascade.ts`/the DB registry alone changes real worker behavior for
Haiku 4.5 specifically — verify against `LLMCascade.ts`'s actual behavior too.

Real Vertex-Europe OpenRouter slug (needed for the pending "Vertex EU as
top priority" request): `google-vertex/europe` (confirmed by user, not yet
applied to any of the three locations above).

## 2026-08-20 — Automated review findings on PRs #246/#247, deferred (P2/P3, not launch-blocking)

Real findings from automated PR review, investigated and either fixed (see
commit `1d469d10` — activity_log error handling, empty-array cascade
fallback, defensive registry-resolve wrap) or deliberately deferred here:

1. **Cascade SSOT still has 2 copies of the Haiku fallback order**
   (`web/lib/config/cascade.ts` and `worker/src/services/LLMCascade.ts`'s
   `HAIKU_PROVIDER_ORDER_FALLBACK`) — the worker can't read the DB registry
   directly (ADR 005), so full consolidation needs a shared package/constant
   or a build-time sync check, not a quick fix. Real risk: if the registry
   order ever changes, the worker's defensive-only fallback (used only when
   a client sends no `providerOrder` at all) can silently drift again.
2. **`LLMCascade.test.ts` only covers the streaming call site**
   (`callLLMStream`) — the non-streaming path (`callLLM`) uses the identical
   fallback logic but has zero direct test coverage. Add non-streaming tests
   mirroring the streaming ones (explicit providerOrder precedence + no-order
   fallback + empty-array fallback).
3. **No end-to-end test from cascade resolution through to the OpenRouter
   payload** — current tests construct `LLMCascade` directly with a manually
   supplied cascade array, so a regression in `resolveAnalysisCascade()`,
   payload serialization, or constructor wiring could pass unit tests while
   production silently loses the provider order. Needs a real contract test.
4. **`P1 — ELEVATED PRIORITY 2026-08-20 (explicit user directive: "put it on
   a higher priority... it's a security issue")`. `/api/test-auth/login`
   has no rate limiting** — a leaked `TEST_AUTH_BYPASS_SECRET` plus the
   registry toggle enabled would allow unlimited session minting. Existing
   `web/lib/services/traffic.ts` (`checkRateLimitSlidingWindow`) is the real
   primitive to reuse, but it's keyed on `userId`/`tier`/`endpoint` (built
   for authenticated-user rate limiting) — this route has no user yet at the
   point rate limiting would need to apply. Needs a small
   IP-or-secret-hash-keyed variant, not a blind reuse of the existing
   function signature. Not P0 (route is default-OFF via `testAuthBypass.enabled`
   and gated by a 64-char random secret — real exposure requires two
   independent misconfigurations), but real and should land soon after
   launch, not indefinitely deferred. Next real task after the TestSprite
   re-run.
5. **`dub.domain` registry value has no hostname validation** — only
   `maxLength` in the migration's `validation` jsonb. An admin could persist
   a malformed value (URL, path, whitespace) and every Dub share would
   silently fall back to the raw un-shortened URL with no visible error.
6. **`activity_log`'s "append-only" is a convention, not a DB invariant** —
   RLS blocks ordinary UPDATE/DELETE, but the service role (used by the app
   itself) can bypass RLS entirely. Real hardening would need a trigger or
   REVOKE on UPDATE/DELETE even for the owning role, with an explicit
   documented exception path if one is ever needed.
7. **`ShareButton.tsx` doesn't check clipboard availability before creating
   the share link** — on a browser/context where `navigator.clipboard` is
   blocked (some iframes, older browsers, non-HTTPS), a real Dub link gets
   created and audited, but the user only sees a generic error, and a retry
   creates a duplicate link. Should check clipboard support first and offer
   a manual-copy fallback instead of silently discarding a created link.

None of these are launch-blocking; all are real hardening/coverage gaps
worth a dedicated pass post-launch.

## 2026-08-20 — Astryx CSS class-name targeting accumulating in globals.css (altitude finding, deferred)

`/simplify` altitude review flagged: three independent overrides now reach past
Astryx components into their internal, unversioned class names
(`.astryx-tooltip`, `.astryx-toast`, `.astryx-chat-composer-input`) rather than
going through a proper theme-level override. Each is individually justified
and documented with its own RCA, but collectively they signal the `<Theme>`
provider wired up tonight (`web/app/providers.tsx`) isn't yet the single place
all Astryx theming flows through — a future Astryx version bump could rename
any of these classes and silently break the override with no compile error.

**Deferred, not fixed tonight**: investigate whether `@astryxdesign/theme-neutral`'s
`defineTheme()` API can absorb these three via `onDark.components`/token
overrides instead of CSS class targeting (per `MediaTheme.tsx`'s own doc
comment, this may be exactly what that API is for). If genuinely no override
slot exists for these specific cases, that's an upstream/dependency gap worth
filing directly with Astryx rather than treating as tribal CSS knowledge.

## 2026-08-20 — Open-redirect guard has a theoretical backslash-normalization bypass (pre-existing pattern)

`next.startsWith('/') && !next.startsWith('//')` (used in both
`web/app/auth/signin/page.tsx`'s existing redirect logic and the new
`form.tsx` test-auth form added this session) doesn't reject
`/\evil.com` -- some older browsers historically normalized a leading
`/\` to `//` before following a redirect, which would make this an
external-origin bypass. Not introduced by tonight's work (page.tsx
already had this exact check); found via owasp-top-10 review while
adding the new form. Real fix: also reject any `next` value containing
a backslash, or parse with `new URL(next, origin)` and compare
`.origin` instead of a startsWith heuristic. Low urgency (modern
browsers don't do this normalization), not launch-blocking.

## 2026-08-20 — Highlights-reel redesign: /simplify findings deferred past merge (PR #257/#258)

Real findings from the mandatory 4-agent /simplify pass, applied where safe, deferred here where the fix was too large/risky to land right before merge:

1. ✅ **RESOLVED (2026-08-20, branch `refactor/shared-segment-playback-hook`).** ~~Duplicated media-time-clamping state machine.~~ `HighlightsScrubber.tsx` (store-driven) and `PublicHighlightsReel.tsx` (own `YouTubePlayerAdapter` poller) implement the same segment-advance/seek-settlement-guard logic twice, only the time-source primitive differs. Extracted `web/lib/hooks/useSegmentPlayback.ts`, both components now call it with their own `SegmentPlaybackPrimitives`. Also fixed the duplicated `SPEED_OPTIONS` array -- the 0.5-3 range hardcoded a third time as `YouTubePlayerAdapter.setPlaybackRate`'s clamp bounds now derives from `HIGHLIGHTS_SPEED_MIN`/`HIGHLIGHTS_SPEED_MAX` in `web/lib/utils/highlights-settings.ts`, one source of truth for all three.
2. ✅ **RESOLVED (2026-08-20, branch `refactor/shared-markdown-link-renderer`).** ~~`ApexSummaryCard.tsx`'s `apexComponents.link` is a verbatim copy (including the comment) of `SelectedDimensionReadout.tsx`'s `readoutComponents.link` (the `#t=` -> `TimestampLink` routing + external-link `target="_blank"` guard). Extract one shared `createMarkdownLinkRenderer()` used by both.~~ Extracted to `MarkdownLink` in new `web/components/markdown/dimensionMarkdownComponents.tsx`; both `readoutComponents.link` and `apexComponents.link` now just reference it. Only `link` was actually duplicated -- `SelectedDimensionReadout.tsx`'s other overrides (`heading`/`paragraph`/`code`/`inlineCode`/`blockquote`/`hr`) are not used by `ApexSummaryCard.tsx` and were left file-local. Real-render regression test at `web/components/markdown/__tests__/dimensionMarkdownComponents.test.tsx` (RTL, both components, `#t=` seek, external-link, and relative-link behavior), plus a direct `MarkdownLink` URL-class matrix (protocol-relative/relative/mailto/anchor).
3. ✅ **RESOLVED (2026-08-20, branch `refactor/shared-segment-playback-hook`).** ~~Three uncoordinated timers for one concept.~~ `useHighlightTicker`'s own 150ms `setInterval` (word-reveal) ran alongside the 250ms advance-poller in both scrubber variants. `useHighlightTicker.ts` now takes an externally-supplied `elapsedSeconds` parameter (sourced from `useSegmentPlayback`'s own media-time poll) instead of owning `setInterval`/`Date.now()` internally -- no timer of its own left to desync.
4. ✅ **RESOLVED (2026-08-20, branch `refactor/shared-segment-playback-hook`).** ~~`HighlightsScrubber`'s videoMetadata guard lives in the caller, not the component.~~ `DashboardContainer.tsx`'s `status === 'complete' && analysisId && videoMetadata` guard is now `status === 'complete' && analysisId` -- `useSegmentPlayback`'s own readiness check (its `getCurrentTime` primitive reading `null` until the player/store is actually ready) makes the player-context guard redundant; `videoDurationSeconds` is passed through as possibly-null instead.
5. **`astryx-list-item > span:first-child` CSS selector** (numbered-marker width fix, `web/app/globals.css`) targets Astryx's private/undocumented DOM structure inferred from reading its source, not a public contract -- any Astryx version bump could silently break it with no compile-time signal. No better option available without an upstream Astryx fix; flagged, not fixable from this repo alone.

None of these are correctness bugs in the shipped code -- all were judged safe to defer past this merge, not silently dropped.

## 2026-08-20 — Rebrand: text/copy done separately from infra (deferred here)

Old branding: "Hex-YT Intel" / "Hex YT Intel" / "yt-intel" / "yt intel", domains `yt-intel.getmytestdrive.com` + `v-intel.getmytestdrive.com`.
New branding: "vIntel", domains `getvintel.com` / `www.getvintel.com` (already correctly in the CORS allowlist as of tonight's PR #257).

User's explicit sequencing (2026-08-20): text/copy rebrand only, done as its own pass after tonight's 3 PRs merge — NOT bundled into this session's other work. Infra/technical renames deferred to a later, separate pass:

- `web/package.json` name field
- Cloudflare Worker service name (`yt-intel` → currently deployed at `yt-intel.hex-tech-lab.workers.dev`) — a real rename here changes the live deploy URL, needs explicit go-ahead and careful sequencing with DNS/any hardcoded worker URLs.
- Any DB refs, GitHub repo/org name, or other infra identifiers still carrying the old name.
- Copyright holder "Hex-Tech-Lab" in `docs/legal/LICENSE-ADDENDUM.md`/`NOTICE.md` — a legal-entity-name question distinct from the product brand; left untouched pending an actual new legal entity name from the user.
- Operational verification of the 3 new contact mailboxes (`privacy@`/`legal@`/`billing@getvintel.com`) — DNS/MX/inbound delivery/monitoring not verified by this session (code-only rebrand). Flagged by post-merge automated review on PR #261, not a code defect.

## 2026-08-20 — `useSegmentPlayback` readiness enforcement gap (found post-merge on PR #262, fixed PR #263)

Post-merge automated review found `isReady` was computed and returned by the hook but never actually consulted by its own `start()`/`jumpTo()` actions — both called `seekTo`/`play` unconditionally even while `getCurrentTime()` still returned `null` (player not ready). Fixed: `start()`/`jumpTo()` now queue the requested index in `pendingStartIndexRef` when not ready; the existing poll loop flushes it on the first tick the primitive becomes ready; `stop()` cancels a pending queued start. 3 new regression tests added. See PR #263.

Text-only scope (222 hits across code+docs, 6 legal documents in `docs/legal/*.md` + their `web/app/*/page.tsx` renders) is a real KYC-driven ask (MOR payment provider review) — not cosmetic, needs to actually land, just sequenced after the open PRs.

## 2026-08-21 — Astryx `variant="primary"` renders white instead of app cyan (app-wide, pre-existing)

Live report on the highlights-reel Play/Pause `IconButton`: rendered as a plain white circle instead of the app's cyan accent, despite `variant="primary"` being coded correctly (Astryx's own source: `primary` variant sets `backgroundColor: colorVars['--color-accent']`, `color: colorVars['--color-on-accent']` — the component code isn't wrong).

**Root cause (confirmed, not a guess):** every single live screenshot taken this session — across every component, not just the highlights reel — logged this console warning:

```
[Astryx] Theme "neutral" is using runtime style injection. For better performance, use the pre-built theme:
  import {neutralTheme} from '@astryxdesign/theme-neutral/built';
  import '@astryxdesign/theme-neutral/theme.css';
```

The app is using Astryx's theme-neutral package in runtime-injection mode rather than the pre-built theme, and `--color-accent` is falling back to Astryx's own generic default (white) instead of this app's actual cyan (`#06B6D4`, `web/app/globals.css`'s own `--accent`). This is **app-wide and pre-existing** — confirmed by grepping for other already-shipped components using `variant="primary"`: `web/components/search/result-card.tsx`, `web/components/organisms/ResponsiveHeader.tsx`, `web/components/billing/checkout-button.tsx`, `web/components/billing/founders-table-client.tsx`, `web/components/billing/pricing-table-client.tsx` — all potentially affected, not something introduced by tonight's highlights-reel work.

**Not fixed inline** — a one-off cyan override on just the highlights-reel `IconButton` would mask the real bug and cause drift the next time anyone uses `variant="primary"` elsewhere. Needs the real fix: wire the app's root theme provider to `@astryxdesign/theme-neutral/built` + `theme.css` per Astryx's own stated fix, and confirm `--color-accent` actually resolves to the app's cyan afterward (not just that the warning disappears). User flagged this as "deal with it ASAP" — next session priority, not deferred indefinitely.

## 2026-08-21 — HighlightsTrack permanent-label collision uses percentage gap, not pixels

`web/components/dashboard/HighlightsTrack.tsx`'s `MIN_LABEL_GAP_PCT` (6) is a percentage of the track's rendered width, not a measured pixel gap. Flagged by the `/simplify` altitude pass on PR #266 (`design/highlights-reel-astryx-overhaul`): on a much narrower or wider track than the ~700px dashboard card this was verified against, the same 6% could be too permissive (labels genuinely overlap) or too strict (labels drop that would have fit). Verified correct on the actual reported 9-highlight case at the real card width, but the mechanism itself is width-agnostic by construction, not measured.

**Not fixed** — a pixel-accurate version needs a `ref` + `getBoundingClientRect()`/`ResizeObserver` on the track container to know its real rendered width, which is a bigger lift than tonight's pass. Low priority unless this component is reused somewhere with a meaningfully different width than the dashboard scrubber card.

## 2026-08-21 — Highlights-reel scrubber: mobile/narrow-viewport not verified

All live verification tonight (PR #266, `design/highlights-reel-astryx-overhaul`) was done at a single fixed ~945px desktop viewport via Playwright screenshots. Responsive behavior at mobile/narrow widths was NOT tested. Two concrete, code-level risks spotted (not confirmed live):

1. `HighlightsScrubber.tsx`'s footer row (transcript ticker + speed pill + moment nav) is `flex items-center justify-between gap-2` with no `flex-wrap` — on a narrow phone width, the fixed-content-width speed pill + nav could squeeze the `flex-1` transcript text down hard or off-balance, with no tested fallback.
2. The `MIN_LABEL_GAP_PCT` percentage-based collision threshold (item above) means the same 6% gap represents fewer real pixels on a narrow screen than on the ~700px card this was verified against — permanent labels are more likely to visually collide on mobile specifically, not just a theoretical edge case.

No hardcoded pixel widths were found in either file (everything is `flex`/`%`-based), which is a reasonable baseline, but that's not the same as verified. Needs a real live check at common mobile breakpoints (375px, 390px) before this can be called done.
