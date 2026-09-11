# QA-Intel Retro-Wave: Extracted Review Findings

Extracted 2026-09-11 by OC (opencode) from PR review comments (Cubic, CodeRabbit,
Sourcery), the agent ledger, the ruleset lessons ledger, and agent-prompt
review-findings files. Research only — no code changed.

---

## Findings by bug class (grouped, most-recurring first)

### silent-catch-swallows-error (12 occurrences)

Catch blocks that swallow errors without Sentry.captureException, or that
log to console but bypass the project's mandatory error-reporting contract
(`Sentry.captureException(error, { contexts: { ... } })`).

- PR #268 (CodeRabbit, 2026-08-25): `HighlightsScrubber.tsx:81` — catch handles AbortError correctly but non-abort failures only `console.warn` + `setError`, no `Sentry.captureException`. UI renders `null` on error so failure is invisible in both UI and tracker. Fixed: yes — added Sentry.captureException + structured logging.
- PR #268 (CodeRabbit, 2026-08-25): `DubShortLinkAdapter.ts:49-51` — both catch blocks pass `unknown` to Sentry and return empty body without structured log or normalized error. Fixed: yes — normalized with toError, added Sentry + structured log.
- PR #268 (CodeRabbit, 2026-08-25): `SupabaseAnalysisAdapter.ts:725-730,863,885` — three new catch blocks use `tags`/`extra` instead of `contexts` option. Fixed: partially — noted as trivial/low-value by reviewer.
- PR #246 (Sourcery, 2026-08-20): `DubShortLinkAdapter.ts:85` — `logActivity` swallows errors to avoid blocking main operation; persistent RLS/schema issues only appear in console. Fixed: no — suggestion only.
- PR #254 (Sourcery, 2026-08-20): `activity-log.ts` — thrown-exception path doesn't report to Sentry, only the Supabase error path does. Fixed: no — suggestion only.
- PR #256 (Sourcery, 2026-08-20): `activity-log.ts:55` — `captureMessage` with `extra: { message }` discards stack trace. Should use `captureException` to preserve stack. Fixed: no — suggestion only.
- PR #234 (CodeRabbit, 2026-08-15): `fail/route.ts:74-77` — `err` not normalized, no `contexts` payload, no structured `[analyses]` log. Fixed: no — suggestion only.
- PR #234 (CodeRabbit, 2026-08-15): `useSSEStream.ts:287-292` — rejected write-back request not captured with Sentry before non-fatal log. Fixed: no — suggestion only.
- Ledger (OC, 2026-08-28): `worker/src/middleware/error-handler.ts` — the ONLY worker error path with zero Sentry capture (37 sites elsewhere). Dropped message/stack in production, client saw only `{"error":"Internal server error"}`. Fixed: yes — added Sentry.captureException + errorId in 500 body.
- Ledger (Claude, 2026-07-19): V5 re-audit found empty-catch gaps in PR #156. Fixed: yes.
- Ledger (OCT2, 2026-06-18): PR #89 — 8 high-attention files fixed including empty catch blocks.
- Ledger (GCT2, 2026-06-12): `SynthesisStreamAdapter.ts` — silent catch block narrowed to only cover JSON.parse of incomplete progressive stream. Fixed: yes.

Generalizable: **yes** — an AST rule can detect catch blocks where no `Sentry.captureException`/`captureMessage` call exists in the catch body, or where `console.*` is the only error handling. The existing `SwallowedErrorRule` partially covers this but has known false-positive gaps (see RULESET_LESSONS_LEDGER entries on documented intentional swallows).

---

### stale-state-survives-context-switch (8 occurrences)

State (React state, refs, or store values) persists across context switches
(analysis change, video change, graph switch, user sign-out) causing stale
data to render or corrupt the new context.

- PR #207 (Cubic, 2026-08-06): `WordCloud.tsx` — `lastClickedWordKeyRef`/`lastSelfSelectedIdRef` not reset when `graph.rootId` changes. Selected word survives graph replacement. Fixed: yes — added reset to existing `graph?.rootId` effect.
- PR #235 (CodeRabbit, 2026-08-15): `BentoMetadata.tsx:39` — `descriptionExpanded` persists across prop changes. New video's description starts expanded. Fixed: no — suggestion only.
- PR #285 (CodeRabbit, 2026-09-07): `useEntitlements.ts:38-43,60-63` — `activeUserIdRef.current` not updated before `setUserId`. If user A's request resolves after sign-out, it commits A's entitlements. Stale premium state suppresses upgrade prompt. Fixed: no — suggestion only.
- PR #268 (CodeRabbit, 2026-08-25): `HighlightsScrubber.tsx:49` — previous response can resolve after newer request and overwrite current highlights. Old data and active playback timer persist during analysisId transition. Fixed: no — suggestion only.
- Ledger (GC, 2026-06-12): `ChatDock.tsx` — hydration amnesia, state not restored on mount. Fixed: yes.
- Ledger (GC, 2026-06-12): `ChatDock.tsx` — stale subscription, grounding context not cleaned. Fixed: yes.
- Ledger (AGY, 2026-07-27): URL not synced on analysis load → `clearAnalysis()` destroys video stores → YouTube player goes black. Fixed: yes — added url sync + guarded clearAnalysis.
- Ledger (AGY, 2026-07-27): entitlements reset on same-user auth events, unsticking Pro/Simple toggle. Fixed: yes (PR #292).

Generalizable: **partially** — an AST rule can detect React `useState`/`useRef` variables that are set in one context but never reset in a `useEffect` keyed on the context-change signal (e.g. `graph?.rootId`, `analysisId`, `userId`). However, the specific context-change trigger varies per component, making a fully general rule difficult. The existing `StaleStateResetRule` partially covers this.

---

### config-mismatch-between-prompt-and-validator (7 occurrences)

Prompt instructions, Zod schemas, and parser logic disagree on limits
(max items, max count, valid indices), causing either validation failures
on valid model output or acceptance of invalid output.

- PR #283 (Sourcery, 2026-08-27): `ZodSchemas.ts:55` — schema accepts max 18 edges, but `PromptBuilder` instructs model to generate up to 20 edges (and only 15 nodes). A 19-20 edge response follows the prompt but fails persistence schema. Fixed: yes — aligned PromptBuilder to `(max 24 nodes, 18 edges)`.
- PR #285 (Sourcery, 2026-09-07): `highlights-extraction.ts:54` — prompt sends first 10 takeaways, but parser validates `parent_takeaway_idx` against full `takeaways.length`. Index 10+ accepted though takeaway was never in prompt. Fixed: yes — passes truncated count to parser.
- PR #285 (Sourcery, 2026-09-07): `highlights-extraction.ts:149` — parser enforces per-highlight duration and item count but never tracks cumulative duration. `maxHighlights` individually-valid highlights can exceed ADR 029 cumulative budget. Fixed: yes — accumulates durations and stops at budget.
- Ledger (Claude-Haiku, 2026-07-10): `getAnalysisGrounding` read status from `validation_report.status` instead of `billing_status`. Chat always said "analysis not complete." Fixed: yes (commit 7b6167e).
- Ledger (Claude-Haiku, 2026-07-10): persist validation over-failing on empty dimensions — fail if ANY chunk had empty dimensions array. Fixed: yes (commit fd1db35) — only fail on missing/malformed chunks.
- Ledger (Claude-Haiku, 2026-07-09): persona schema duplication — legacy `p1-p5` enum vs `z.enum(VALID_PERSONAS)`. Fixed: yes — replaced with canonical IDs.
- Ledger (Antigravity, 2026-06-13): `PromptBuilder.ts` hardcoded dimension bounds not synced with `TOTAL_DIMENSIONS` constant. Fixed: yes.

Generalizable: **yes** — an AST rule can cross-reference numeric constants between prompt-builder files and Zod schema files, flagging when a `.max(N)` in a schema differs from a corresponding `N` in a prompt template string. The challenge is establishing the semantic link between the two files.

---

### qa-intel-rule-false-positive-or-blind-spot (10 occurrences)

qa-intel rules fire incorrectly on valid code (false positive) or miss real
bugs they should catch (false negative). These are meta-findings about the
quality engine itself, extracted from `docs/qa-intel/RULESET_LESSONS_LEDGER.md`.

- RULESET_LESSONS_LEDGER (2026-08-14): `WorkflowRule` "Missing finally block for I/O" fires on `Promise.finally()` chains — different AST shape (CallExpression, not TryStatement). Worked around, not fixed in rule.
- RULESET_LESSONS_LEDGER (2026-08-14): "String truncation without ellipsis" fires on `array.slice(0, N)` — capping array length, not truncating display text. Worked around, not fixed.
- RULESET_LESSONS_LEDGER (2026-07-25): "DB operation without validation" fires on read-only `.select()` calls. Still not fixed as of 2026-08-02.
- RULESET_LESSONS_LEDGER (2026-07-25): secrets-exposure "token" pattern false-positives on YouTube pagination cursors (`pageToken`). Fixed: yes — added `PAGINATION_TOKEN_NAME` regex exemption.
- RULESET_LESSONS_LEDGER (2026-08-02): `InformationDisclosureRule` flags any `userId` in log calls, no exemption for server-side correlation-ID logging. Not fixed.
- RULESET_LESSONS_LEDGER (2026-08-02): empty-catch detector fires on documented intentional swallows with explanatory comments. Not fixed.
- RULESET_LESSONS_LEDGER (2026-08-05): `SchemaContractRule` blind spot — `.refine()` nested inside `z.array()` wrapper, `.optional()` on outer array invisible to rule. Worked around, not fixed in rule.
- RULESET_LESSONS_LEDGER (2026-09-07): `SecurityFixWithoutTestRule` bare-word `"bypass"` matches unrelated prose ("bypasses the cache"). CI-blocking twice. Not fixed at rule level.
- RULESET_LESSONS_LEDGER (2026-09-07): `WorkflowRule` fires on AbortController-in-effect-cleanup pattern (correct pattern, rule can't see it). 20+ pre-existing violations. Not fixed.
- RULESET_LESSONS_LEDGER (2026-09-06): `SecurityFixWithoutTestRule` path-basis mismatch — `source.getFilePath()` (absolute) vs `ctx.allFiles` (relative) compared as equivalent. Would have made rule always fire. Fixed: yes — use `ctx.filePath`.

Generalizable: **yes, inherently** — these ARE the rules. Each false positive / false negative is a candidate rule fix. The recurrence pattern (10 instances) shows the rules need a systematic audit pass, not one-off fixes.

---

### error-normalization-missing (5 occurrences)

Catch blocks pass `unknown` values to Sentry or rethrow without normalizing
to `Error` first, violating the project's universal catch pattern
(`error instanceof Error ? error.message : String(error)`).

- PR #268 (CodeRabbit, 2026-08-25): `DubShortLinkAdapter.ts:40,48-50` — both catch blocks pass `unknown` to Sentry and rethrow unchanged. Fixed: yes — normalized with `err instanceof Error ? err.message : String(err)`.
- PR #234 (CodeRabbit, 2026-08-15): `fail/route.ts:74-77` — `err` not normalized before Sentry, no structured log. Fixed: no.
- PR #237 (Sourcery, 2026-08-15): `LogsViewerClient.tsx:283` — logs `[ERROR] ${data.error || ...}` assuming `data.error` is string. Object/array produces `[object Object]`. Fixed: yes (commit a36).
- Ledger (Claude, 2026-08-29): `fetchSentryLogs` 401/403 returns `200 {issues:[], warning}` — error swallowed silently. Fixed: yes.
- Ledger (OC, 2026-08-28): `error-handler.ts` dropped message/stack in production. Fixed: yes — echoes Sentry event id.

Generalizable: **yes** — an AST rule can detect catch blocks where the caught variable is used in `Sentry.captureException(var)` or `console.*(template_string_with_${var})` without a preceding `instanceof Error` guard or `String(var)` coercion.

---

### null-coercion-to-zero / missing-null-guard-on-external-data (5 occurrences)

`Number(null)` returns `0`, `Number(undefined)` returns `NaN`, and
`setTimeout` treats both as `0`. External data (registry values, DB columns,
API responses) passes through without type-checking, causing silent
misbehavior.

- PR #268 (CodeRabbit, 2026-08-25): `highlights/route.ts:22` — `Number(null)` returns `0`, passes `(0, 10)` range check, returns `0` instead of `2.5` fallback. Reel has no lead-in context. Fixed: yes — added `typeof value !== 'number' && typeof value !== 'string'` guard.
- PR #268 (CodeRabbit, 2026-08-25): `share/[token]/page.tsx:72-73` — raw `Number(...)` passed to client component, `NaN`/`0` makes reel skip through highlights instantly. Fixed: yes — clamped with shared bounds.
- PR #268 (CodeRabbit, 2026-08-25): `SupabaseAnalysisAdapter.ts:685` — `video_id` with `_archived_<ts>` suffix not stripped before passing to YouTube player. Invalid ID, black frame. Fixed: yes — applied `stripArchivedVideoIdSuffix()`.
- PR #285 (CodeRabbit, 2026-09-07): `useEntitlements.ts:111` — entitlement response not `safeParse`d before caching. Missing fields enter `globalCache` as invalid state. Fixed: no — suggestion only.
- Ledger (AGY, 2026-07-27): YouTubePlayerAdapter non-finite playback rate not guarded before clamping. Fixed: yes (PR #258, Sourcery finding).

Generalizable: **yes** — an AST rule can detect `Number(x)` calls where `x` is not type-narrowed to `number | string` first, especially in API route handlers and adapter return paths.

---

### missing-timeout-or-status-check-on-fetch (5 occurrences)

Fetch calls lack timeout, AbortController, or `response.ok` check, allowing
hung requests or silent acceptance of error responses.

- PR #206 (Qodo/CC, 2026-08-06): `worker/src/routes/analysis.ts` — `waitUntil` fetch ignores non-2xx (treats 400/500 as success), no timeout. Hung request consumes background task indefinitely. Fixed: yes — added `response.ok` check, AbortController timeout.
- PR #240 (CodeRabbit, 2026-08-19): `ci-cd.yml:447` — diagnostic curl has no `--connect-timeout` or `--max-time`. Stalled endpoint runs until job timeout. Fixed: no.
- Ledger (Claude-Haiku, 2026-07-10): chat streaming hang — fetch to worker had no timeout, indefinite hang. Fixed: yes — added `AbortSignal.timeout(50s)`.
- Ledger (Claude Code, 2026-07-01): `retryWithBackoff` used pure `2^n` with zero jitter — 5 concurrent streams retry at identical milliseconds (thundering herd). Fixed: yes — added `jitterFactor = 0.5 + Math.random()`.
- Ledger (Haiku, 2026-07-01): `persistController` parameter accepted but never used — `buildStreamResponse` created independent controller. Fixed: yes (commit e644c5a).

Generalizable: **yes** — an AST rule can detect `fetch(...)` calls not wrapped in a timeout (no `AbortSignal.timeout`, no `AbortController`, no `setTimeout` abort) and without a `response.ok` / `response.status` check afterward.

---

### promise-all-fail-quiet-broken / optional-data-breaks-main-render (4 occurrences)

Code claims "optional" or "fail quiet" behavior but uses `Promise.all`
(which rejects on ANY failure), or optional data fetch failures crash the
main render path instead of degrading gracefully.

- PR #268 (CodeRabbit, 2026-08-25): `share/[token]/page.tsx:53` — comment says highlights are optional and "fail quiet," but `Promise.all` rejects on any failure. Transient highlights query failure crashes entire share page. Fixed: yes — isolated highlights with `.catch()`.
- PR #268 (CodeRabbit, 2026-08-25): `PublicHighlightsReel.tsx:57` — `adapter.mount` called with only `onReady`, no `onError`. Mount failure leaves "Play highlights" button permanently disabled, black frame. Fixed: no.
- Ledger (Claude, 2026-07-16): non-embed video playback — no error-code-gated overlay or retry for error codes 101/150. Fixed: yes — thumbnail fallback player with timestamp handoff.
- Ledger (AGY, 2026-07-27): YouTubePlayerAdapter async mount lifecycle leak — `playerRef.current` not assigned immediately, dual iframe instances. Fixed: yes.

Generalizable: **partially** — detecting `Promise.all` where one promise is documented as "optional"/"fail quiet" requires semantic understanding. An AST rule could flag `Promise.all` containing a fetch call without a `.catch()` in environments where the project convention says optional fetches should use `Promise.allSettled` or individual `.catch()`.

---

### documentation-in-source-comments (10+ occurrences)

Operational history, RCA narratives, ADR rationale, deployment instructions,
and incident records embedded in source code comments instead of `/docs/`.
CodeRabbit flags this consistently across many PRs.

- PR #234 (CodeRabbit): `fail/route.ts:13-26` — ADR and incident-history in source comments.
- PR #240 (CodeRabbit): `cascade.ts:36-40` — migration history and study documentation.
- PR #240 (CodeRabbit): `pricing.ts:3-164` — pricing provenance, provider readiness, incident history.
- PR #244 (CodeRabbit): `cors.ts:7` — ADR rationale, migration dates, cutover instructions.
- PR #257 (CodeRabbit): `DashboardContainer.tsx:706-710` — dated placement history.
- PR #257 (CodeRabbit): `ApexSummaryCard.tsx:14-21` — dated bug history.
- PR #268 (CodeRabbit): `middleware.ts:149` — historical incident documentation.
- PR #268 (CodeRabbit): `DubShortLinkAdapter.ts:24` — lifecycle note with future-dated validation.
- PR #240 (CodeRabbit): `parity-review/route.ts:30` — deployment limitation record.
- PR #244 (CodeRabbit): `CommentClassifier.ts:17` — OpenRouter header in domain service.

Generalizable: **yes** — an AST rule can detect multi-line comments (JSDoc or block comments) in `web/**/*.{ts,tsx}` that contain date patterns (`2026-XX-XX`), ADR references, or incident-history keywords, flagging them for relocation to `/docs/`.

---

### single-letter-variable-names (5 occurrences)

Variables named `m`, `s`, `t`, `k` outside loop context, flagged by qa-intel
lint and CodeRabbit as unclear.

- PR #268 (CodeRabbit): `PublicHighlightsReel.tsx:18` — `m` and `s` in `fmtDuration`. CI lint fails.
- PR #240 (CodeRabbit): `ProDashboardView.tsx:145-148` — `t`/`k` single-letter params.
- PR #240 (CodeRabbit): `founders-table-client.tsx:59-105` — single-letter mapping parameters.
- PR #257 (CodeRabbit): various components.
- Ledger (OC, 2026-08-29): qa-intel flags single-letter variables pervasively.

Generalizable: **yes** — already partially covered by existing qa-intel rules. The recurrence shows the rule exists but isn't CI-blocking consistently (pre-existing violations in files touched by new PRs get re-reported).

---

### import-ordering-violations (3 occurrences)

Type imports mixed with value imports, or import groups in wrong order
(framework → third-party → internal `@/` → `import type`).

- PR #234 (CodeRabbit): `fail/route.ts:5` — `NextRequest` (type-only) not in separate `import type`.
- PR #240 (CodeRabbit): `parity-review/route.ts:8` — import order violated, CI lint fails.
- Ledger (AGY, 2026-06-25): POSIX normalized path checks, import ordering in rules.

Generalizable: **yes** — already covered by existing qa-intel/eslint rules. Recurrence is from new code not following the established pattern, not a rule gap.

---

### regex-authorization-bypass / unanchored-auth-regex (2 occurrences)

Regex literals used in authorization/entitlement decisions that are not
word-boundary or exact-match anchored, allowing attacker-controlled input
to bypass checks.

- PR #286/288 (CC/Cubic, 2026-09-07): `GetUserEntitlementsUseCase.ts` — `HARDCODED_OWNER_EMAIL_PATTERNS = [/kelly/i, ...]` — unanchored substring regex matching ANY email containing "kelly". Attacker email `kelly@evil.com` bypasses billing. Live in prod ~10 days. Fixed: yes — removed entire hardcoded fallback block (PR #288).
- PR #287 (Cubic, 2026-09-07): `security.ts:97` — exact-anchor check accepts `m` flag, so `/^admin$/m` matches `admin` on a later line of attacker-controlled input. Fixed: no — P1 suggestion.

Generalizable: **yes** — the new `AuthorizationRegexBypassRule` (added same session) detects regex literals in authorization contexts that lack `^` and `$` anchors or accept the `m` flag. This is a high-value rule class.

---

### workflow-script-injection / ci-security-gap (2 occurrences)

GitHub Actions `${{ }}` expressions interpolated directly into `run` steps,
allowing crafted input to execute arbitrary commands on the runner.

- PR #240 (CodeRabbit/zizmor, 2026-08-19): `deploy-hmac-secret.yml:29-34` — `${{ inputs.hmac_secret }}` interpolated into curl `-d` JSON body. Crafted `hmac_secret` can close the string and execute commands. Fixed: yes (commit 2cd8444) — pass through `env` + `jq -n --arg`.
- PR #240 (CodeRabbit/zizmor, 2026-08-19): `ci-cd.yml:447` — template expansion in diagnostic curl. Fixed: no.

Generalizable: **yes** — a static rule can scan `.github/workflows/*.yml` for `${{ inputs.* }}` or `${{ github.event.* }}` inside `run:` blocks without an intervening `env:` assignment.

---

### dead-code-registration-omission (2 occurrences)

New rule/function exported but not registered in the registration function
that callers use to activate it, so it never runs.

- PR #286 (Cubic, 2026-09-07): `security.ts:37` — `AuthorizationRegexBypassRule` exported but `registerSecurityRules` omits `e.addRule(AuthorizationRegexBypassRule)`. Never runs. Fixed: yes (commit b549d86).
- PR #286 (Cubic, 2026-09-07): `security.ts:11` — `CredentialLeakRule` test-file exemption removed prematurely, assuming PR #287 lands first. Ordering not enforced. Fixed: no — P2.

Generalizable: **yes** — an AST rule can detect exported rule constants (matching `IRule` type) that are not referenced in any `register*Rules` function. Applicable to any plugin/registry pattern.

---

### test-env-restore-leak / test-isolation-gap (2 occurrences)

Test environment stubs restored inside the test body (not in `afterEach`),
so a failing assertion leaks the stub into subsequent tests.

- PR #286 (Cubic, 2026-09-07): `get-user-entitlements.test.ts:132` — `vi.unstubAllEnvs()` called at end of test body. If assertion fails, env never restored, leaks into remaining tests. Fixed: no — P3.
- Ledger (OCT2, 2026-06-19): PR #91 post-mortem — shallow tests asserting mock-called shape, not real behavior. Fixed: yes — qa-intel expanded 29→40 rules.

Generalizable: **yes** — an AST rule can detect `vi.stubEnv`/`vi.unstubAllEnvs` calls in test bodies without a corresponding `afterEach` hook at the describe level.

---

### missing-clamp-in-public-path (3 occurrences)

Private/authenticated path clamps or validates values, but the public path
doesn't, causing display corruption or security exposure.

- PR #268 (CodeRabbit, 2026-08-25): `PublicHighlightsReel.tsx:102` — `totalHighlightsSeconds` and `compressionPct` not clamped to video duration / 100%. Public path shows "2m00s of 1m30s (133%)". Fixed: yes.
- PR #268 (CodeRabbit, 2026-08-25): `share/[token]/page.tsx:72-73` — timing settings not clamped on public path, only authenticated route validates. Fixed: yes — extracted shared `clampSetting` module.
- PR #240 (CodeRabbit, 2026-08-19): `pricing-table-client.tsx` — candidate pricing visible and checkout-able despite `PRICING_APPROVED=false`. Fixed: no — P0 critical.

Generalizable: **yes** — an AST rule can detect shared utility functions (e.g. `clampSetting`) used in one route handler but not in a sibling route handler for the same feature (public vs. authenticated), or detect `PRICING_APPROVED` / similar gate flags not checked before serving data.

---

### duplicated-logic-across-components (3 occurrences)

Same logic implemented independently in two components, leading to drift
and inconsistency.

- PR #268 (CodeRabbit, 2026-08-25): `fmtDuration` duplicated in `PublicHighlightsReel.tsx` and `HighlightsScrubber.tsx` with different variable names. Fixed: yes — extracted shared helper.
- PR #240 (CodeRabbit, 2026-08-19): `PricingComparisonTable.tsx:23` — `COMPARISON_DATA`/`PLAN_COLUMNS`/`PLAN_LABELS` duplicate plan names/quotas from `pricing-plans.ts`. Manual sync required. Fixed: no.
- PR #268 (CodeRabbit, 2026-08-25): `clampSetting`/`REGISTRY_FALLBACK` declared in 3 separate places, only authenticated route validates. Fixed: yes — moved to shared module.

Generalizable: **partially** — detecting duplicated logic requires semantic comparison (detecting similar function bodies or identical constant declarations across files). ts-morph can detect identical variable declaration patterns, but semantic equivalence is harder.

---

### cors-origin-trust-too-broad (2 occurrences)

CORS/validation logic trusts overly broad origin patterns, allowing
unauthorized domains to access APIs.

- PR #244 (CodeRabbit, 2026-08-19): `cors.ts:32` — `isValidAppUrl` accepts every hostname ending in `.vercel.app`. Duplicated broader validator in `chat-stream.ts:38-78`. Fixed: no — heavy lift.
- PR #245 (Sourcery, 2026-08-19): `analysis.ts:1183` — hardcoded `https://getvintel.com` fallback for non-prod environments. Preview/staging callbacks incorrectly target production. Fixed: no.

Generalizable: **yes** — an AST rule can detect regex patterns in CORS/URL-validation contexts that match overly broad patterns (e.g. `.vercel.app$` without a project-specific prefix) or hardcoded production URLs used as fallbacks in non-production code paths.

---

### missing-streaming-response (2 occurrences)

API route returns `NextResponse.json(...)` instead of a streaming response,
violating the project's Law #3 (all analytical routes MUST stream).

- PR #234 (CodeRabbit, 2026-08-15): `fail/route.ts:86` — all branches return `NextResponse.json(...)`. Fixed: no.
- Ledger (OCT2, 2026-06-19): multiple routes not streaming — identified during Wave 4. Fixed: yes.

Generalizable: **yes** — already partially covered by existing qa-intel rules. The rule should detect `NextResponse.json` in route handlers for analytical endpoints (those matching `/api/analyses/*` or `/api/chat/*`).

---

### intentional-abort-reported-as-failure (2 occurrences)

User-initiated abort (stop, unmount) triggers error write-back, marking
a still-processing analysis as `failed` before the cancel operation settles.

- PR #234 (CodeRabbit, 2026-08-15): `useSSEStream.ts:292` — stream path reaches `settleAnalysis('error')` without checking `currentSignal.aborted`. Write-back updates analysis to `failed` on user stop. Fixed: no — heavy lift.
- Ledger (Haiku, 2026-07-01): `persistController` coordination — client disconnect handler called `persistService.persist({status: 'interrupted'})` but didn't check if signal was already aborted. Fixed: yes (commit e644c5a).

Generalizable: **yes** — an AST rule can detect `settleAnalysis('error')` / `setError(...)` calls in catch blocks that don't first check `signal.aborted` / `controller.signal.aborted`.

---

## Findings that are one-offs (not grouped, appeared once, listed for completeness)

- PR #286 (Cubic, 2026-09-07): `security.ts:81` — file shadows a regex variable name, scan combines unrelated declarations and flags exact regex as unsafe. **Bug class**: variable-shadowing-breaks-ast-scan. Generalizable: yes — AST rules should resolve lexical binding scope, not file-level.
- PR #285 (CodeRabbit, 2026-09-07): `useEntitlements.ts:125-128` — result guard still sees user A until passive effect runs. Stale premium state suppresses upgrade prompt. **Bug class**: ref-not-updated-before-state-change. Generalizable: partially — requires understanding React effect timing.
- PR #240 (CodeRabbit, 2026-08-19): `ParityReviewClient.tsx:90` — synthetic/fabricated model output rendered in review tool when artifact unavailable. **Bug class**: mock-data-in-production-ui. Generalizable: yes — detect hardcoded synthetic data arrays in non-test components.
- PR #240 (CodeRabbit, 2026-08-19): `checkout/route.ts:80` — checkout session created even while `PRICING_APPROVED=false`. Authenticated user can call route directly. **Bug class**: unapproved-feature-exposed. Generalizable: yes — detect feature-gate flags not checked in route handlers.
- PR #240 (CodeRabbit, 2026-08-19): `founders-table-client.tsx:86` — card labels `$49`/`$99` as "one-time" but describes price lock for 1-2 years. **Bug class**: billing-model-contradiction. Generalizable: no — business logic, one-off.
- PR #240 (CodeRabbit, 2026-08-19): `waitlist/page.tsx:216` — "First 200 creators" vs founders page "target, oversubscription not capped." **Bug class**: copy-contradiction-across-pages. Generalizable: no — content, one-off.
- PR #235 (CodeRabbit, 2026-08-15): `BentoMetadata.tsx:12` — `line-clamp-2` always applied, but toggle only appears when >140 chars. Short descriptions truncated with no expand control. **Bug class**: conditional-clamp-mismatch. Generalizable: yes — detect CSS clamp applied unconditionally when expand toggle is conditional.
- PR #235 (CodeRabbit, 2026-08-15): `useAutoRestoreAnalysis.ts:122` — restored description skipped when metadata has same videoId + truthy duration but lacks description. **Bug class**: guard-short-circuits-field-update. Generalizable: yes — detect conditional guards that skip individual field updates.
- PR #236 (Sourcery, 2026-08-15): `EntityMentionTimeline.tsx:276` — aria-label no longer exposes rank information, tooltip still includes it. **Bug class**: aria-label-information-loss. Generalizable: yes — detect aria-label changes that drop information present in tooltip.
- PR #206 (Qodo/CC, 2026-08-06): `worker/src/routes/analysis.ts` — `if (description)` on empty string `''` is falsy, skips POST for present-but-empty description. **Bug class**: falsy-check-on-empty-string. Generalizable: yes — detect `if (stringVar)` where the intent is "field is present" not "field is non-empty."
- PR #206 (Qodo/CC, 2026-08-06): `useChaptersStore.reset(videoId)` exists but no call site. **Bug class**: cache-invalidation-missing-call-site. Generalizable: partially — detect store reset methods with zero callers.
- PR #206 (Qodo/CC, 2026-08-06): `useChapters.ts` — subscribed to `useChaptersStore()` with no selector (whole store object), included in `useEffect` deps. Zustand's `set()` creates new ref every state change, causing effect to re-run immediately, self-cancelling. **Bug class**: zustand-whole-store-in-effect-deps. Generalizable: yes — new rule `ZustandWholeStoreInEffectDepsRule` already added.
- PR #207 (Cubic, 2026-08-06): `WordCloud.tsx` `handleMouseClick` — `word.id === selectedId` compares shared node ID, not `word.wordKey`. Clicking different same-node word deselects. **Bug class**: wrong-identity-key-in-toggle. Generalizable: yes — detect toggle comparisons using shared parent ID instead of item-specific key.
- PR #207 (Cubic, 2026-08-06): `WordCloud.tsx` `drawCanvas` — `requestAnimationFrame` draw fires before `startTransition`-wrapped `selectedId` commits. Ref pair may read stale prop as "external change." **Bug class**: transition-timing-race-in-canvas. Generalizable: partially — requires understanding React startTransition + rAF timing.
- PR #207 (Cubic, 2026-08-06): `WordCloud.tsx` `selectedWordCount` — ARIA count uses `w.id === selectedId` (node-id), canvas highlight uses `wordKey`. Overcount. **Bug class**: aria-canvas-predicate-drift. Generalizable: yes — detect ARIA label computation using different predicate than render logic.
- PR #286 (Cubic, 2026-09-07): `TEMPLATE.md:61` — `qa-intel --diff` and `qa-intel --full` are wrong flag forms. Engine uses `--mode diff` / `--mode full`. `--full` silently leaves mode at default `diff`. **Bug class**: wrong-cli-flag-silent-noop. Generalizable: yes — detect documentation referencing wrong CLI flags.
- PR #286 (Cubic, 2026-09-07): `TEMPLATE.md:14` — `improve-prompt` skill referenced but not in `skills-lock.json` or `.opencode` classification. **Bug class**: referenced-skill-not-installed. Generalizable: yes — cross-reference skill names against skills-lock.json.
- Ledger (CC, 2026-07-23): `SupabasePersistenceAdapter.ts` — dead upsert to nonexistent `videos` table, silently swallowed on every analysis finalize. **Bug class**: dead-write-to-nonexistent-table. Generalizable: yes — detect `.from(tableName)` where tableName doesn't exist in migrations.
- Ledger (CC, 2026-07-23): 10X re-audit found `billing_status` can be NULL — report claimed bypass, but DB has `NOT NULL DEFAULT 'processing'`. **Bug class**: report-false-alarm-on-missing-constraint. Generalizable: no — meta-finding about audit accuracy.

---

## Sources scanned

- **Ledger**: `.memory/AGENT_LEDGER.md` lines 1-989+ (full file), grepped for `cubic|coderabbit|deepsource|codacy|codefactor|sourcery|review.*found|found.*bug|self.cancel|race|regression|stale` — 60 matching lines reviewed.
- **Closed PRs checked**: 63 merged PRs listed via `gh pr list --state closed --limit 80`. Bot review comments pulled via `gh api` for PRs: #308, #306, #304, #303, #302, #301, #300, #299, #298, #294, #293, #292, #291, #290, #289, #288, #286, #285, #283, #281, #280, #279, #276, #274, #272, #270, #268, #266, #264, #263, #262, #259, #258, #257, #256, #254, #253, #252, #251, #250, #248, #247, #246, #245, #244, #240, #239, #238, #237, #236, #235, #234, #233, #232, #230, #229, #227, #224. Total: 58 PRs checked out of 63 merged PRs in the listed range.
- **Docs files read**: `docs/qa-intel/RULESET_LESSONS_LEDGER.md` (187 lines, full), `docs/agent-prompts/2026-08-08-self-retro-review-pr208-214.md` (205 lines, full), `docs/agent-prompts/2026-08-06-agent-pr207-cubic-findings-and-merge.md` (245 lines, full), `docs/agent-prompts/2026-08-06-oc-pr206-remaining-findings.md` (172 lines, full).
- **THOS files**: `docs/history/THOS_*.md` files enumerated (17 files found) — not read individually as the ledger entries and PR comments already captured their substantive findings. Key THOS files whose findings are represented via ledger entries: `THOS_2026-08-07_1600_TIMEOUT_RCA_AND_MULTI_PR_STABILIZATION.md`, `THOS_2026-08-14_2112_HIGHLIGHTS_REEL_HMAC_INCIDENT_AND_ADMIN_UI.md`, `THOS_2026-09-07_0313_AUDIT_SECURITY_FIXES_AND_SKILL_SSOT_UNIFICATION.md`, `THOS_2026-09-07_1510_SECURITY_HIGHLIGHTS_PR_MERGE_MARATHON.md`.

## Coverage gaps / things that could not be checked

- **PRs #62-155 (earlier PRs)**: not checked via `gh api` due to time budget. The ledger covers this range (lines 30-68) with summary entries, but the raw bot review comments for these PRs were not pulled. Some findings from this range are captured via ledger entries but may be incomplete.
- **PRs #155-224**: partially checked (PRs #224, #227, #229, #230, #232-#240 were pulled). PRs #155-#223 were not individually pulled via `gh api` — findings from this range are from ledger entries only.
- **DeepSource/Codacy/CodeFactor findings**: these tools do not post PR comments via `gh api` in the same way Cubic/CodeRabbit/Sourcery do. Their findings are captured indirectly via ledger entries that mention addressing them (e.g., "13 deepsource, 11 codacy, 15 cubic, 8 coderabbit" replied to on PR #89), but the individual finding texts were not available via the API. The `gh api` filter for `deepsource|codacy|codefactor` returned zero comments — these tools report via check runs / review summaries, not inline PR comments.
- **Qodo findings**: Qodo was mentioned in the agent-prompts file for PR #206, but `gh api` filtering for `qodo` returned zero PR comments — Qodo may report via a different mechanism or may have been paused (ledger notes "Qodo: Reviews paused (subscription)" on PR #145).
- **THOS files not individually read**: 17 THOS files were enumerated but only their findings were extracted indirectly via ledger cross-references. A direct read of each THOS file might surface additional findings not captured in the ledger.
