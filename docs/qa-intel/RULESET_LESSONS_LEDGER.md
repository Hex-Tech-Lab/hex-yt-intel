# QA-Intel Ruleset Lessons Ledger

Continuous-improvement log for `scripts/quality-engine/rules/*.ts`. Every time
a qa-intel rule fires wrong (false positive) or misses something it should
have caught (false negative), log it here as it happens — don't wait.

**Cadence**: at the end of every session (or every 2-3 days if a session
doesn't reach a natural end), sweep the entries below, fold each into the
actual rule file, and clear it out to `RESOLVED` once the fix is verified
(qa-intel run clean + no regression on the rule's original intended targets).
This file is the queue, not the archive — resolved entries can be dropped
once the corresponding commit lands, the commit hash is the permanent record.

---

## Open

### 2026-07-24 — driver silently suppresses medium/low findings whenever any high-severity finding exists
- **File**: `scripts/verify-quality-engine.ts:301-309`
- **Symptom**: `process.exit(0)` fires right after printing the high-severity block, before the script ever reaches the `nonCritical` (medium/low) print block below it. On a full-repo scan (`--mode full`), some high-severity finding almost always exists somewhere, so medium/low findings are effectively unreachable output in that mode — discovered while trying to verify the `ReservedKeywordRule` fix below: a genuine, correctly-flagged medium-severity violation in a throwaway test file produced zero output because an unrelated high-severity finding elsewhere in the repo triggered the early exit.
- **Root cause**: each severity tier's block is written as an independent early-return/exit rather than accumulating all tiers before one final report.
- **Not fixed yet** — needs the three severity blocks (critical/high/nonCritical) restructured to all print before any exit, with exit code decided last.

### 2026-07-25 — "DB operation without validation" fires on read-only .select() calls
- **File**: `web/app/api/admin/settings/route.ts` (new file, GET-only, contains zero `.insert`/`.upsert`/`.update` calls)
- **Symptom**: 3x "Data Integrity: DB operation without validation" (high severity) fired on a file whose only Supabase calls are `.select().order()` and `.select().eq().is()` -- pure reads.
- **Root cause**: the data-integrity rule appears to match on `supabase.from(...)` generically without checking which method (`.select` vs `.insert`/`.upsert`/`.update`) follows, so any DB call in a file gets flagged as an unvalidated write.
- **Not fixed yet** — needs the rule to only fire when the call chain actually contains a write method.

### 2026-07-25 — secrets-exposure "token" pattern false-positives on pagination cursors
- **Rule**: the Sentry/telemetry secrets-exposure check (`scripts/quality-engine/rules/security.ts`, "Secrets Exposure: Sensitive data in telemetry")
- **Symptom**: flagged `worker/src/services/MetadataScraper.ts`'s new `fetchCommentsPage` (`pageToken`, passed into `Sentry.captureMessage`'s `extra`) as a high-severity secret leak — high severity is CI-blocking. `pageToken` is YouTube Data API's opaque pagination continuation cursor, not a credential; Google's own docs treat it as safe to log.
- **Root cause**: the rule's `sensitivePatterns` list matches any identifier containing the substring `token` with no distinction between credential tokens (`accessToken`, `authToken`, `bearerToken`, `refreshToken`) and pagination cursors (`pageToken`, `nextPageToken`, `cursorToken`).
- **Fix**: added a `PAGINATION_TOKEN_NAME` regex (`^(page|next|prev|previous|continuation|cursor)token$`) that exempts only the `token` pattern's benign name-shape from the hit, applied narrowly (not a blanket allowlist token, still catches `accessToken`/`authToken`/etc.).
- **Verified**: working-tree scan on the real file now shows zero secrets-exposure findings; a synthetic `accessToken` case in a throwaway file still fires correctly (isolated, not committed).
- **Commit**: (pending — see next commit in this session)

## Resolved

### 2026-07-24 — `ReservedKeywordRule` false-positives on non-test files + property/type-literal names
- **Rule**: `reserved-keyword-avoidance` (`scripts/quality-engine/rules/security.ts:472`)
- **Symptom**: flagged `web/lib/config/cascade.ts` (`export const ANALYSIS_CASCADE ... as const`) and `worker/src/services/atomic-persist.ts` (`{ type: 'idle' }` discriminant properties, `AtomicPersistResult`'s `type:` fields) repeatedly — none are actual reserved-word identifier declarations.
- **Root cause**: two independent gaps. (1) The rule's own comment says it's meant for test files only ("Reserved words that should not be used as identifiers in test files"), but the check had no file-path gate and ran against every file in the repo. (2) `Node.isIdentifier(node)` matched ANY identifier with matching text, including property/type-literal names (`{ type: 'x' }`) and the `const` in `as const` assertions — TypeScript represents both as Identifier nodes with the same text as a real declaration, but neither is one.
- **Fix**: gated the whole rule behind a test-file path check (`.test.`/`.spec.`/`__tests__/`), and narrowed the identifier match to require the identifier actually be the declared name of a `VariableDeclaration`/`ParameterDeclaration`/`BindingElement`/`FunctionDeclaration`/`ClassDeclaration` (checked via `parent.getNameNode() === node`), excluding property and type-position identifiers.
- **Verified**: isolated ts-morph script confirms the fixed rule flags `const type = 'value';` in a `.test.ts` file and does NOT flag `{ type: 'idle' }` or `] as const;` — could not verify end-to-end via the full driver due to the open issue above (medium-severity output unreachable whenever a high-severity finding exists elsewhere in the same full-repo scan).
- **Commit**: (pending — see next commit in this session)

### 2026-07-24 — `StreamResilienceRule` false-positives on worker files (vocabulary gap)
- **Rule**: `stream-resilience-audit` (`scripts/quality-engine/rules/streaming.ts`)
- **Symptom**: flagged `worker/src/routes/analysis.ts`'s persist-retry timeout as "does not settle error state" — code the PR didn't even touch.
- **Root cause**: rule only recognized `settleAnalysis`/`setError`, identifiers that exist exclusively in `web/hooks/useSSEStream.ts`'s local closure. Can never match in `worker/`, so any worker file with an unrelated `setTimeout`+`abort` pair auto-failed.
- **Fix**: recognize the worker's actual settlement pattern (`send({type: 'error', ...})` SSE frame) as equivalent.
- **Commit**: `17038d18`

### 2026-07-24 — `StreamResilienceRule` false-positives on non-stream files (missing scope guard)
- **Rule**: same rule, second gap.
- **Symptom**: flagged `worker/src/adapters/WorkerPromptConfigAdapter.ts` — a plain Redis GET with a defensive timeout, not a client-facing stream response at all.
- **Root cause**: rule never confirmed the file actually handles a stream response before applying "settle error state" — any `setTimeout`+`abort` pair anywhere matched, stream or not.
- **Fix**: gate the whole check behind evidence of a real stream handler (`ReadableStream`/`text/event-stream`/`EventSource`/`.getReader()`/`response.body`) before the setTimeout+abort heuristic applies. Verified against a full-repo scan that the rule's original intended targets (`analysis.ts`, `useSSEStream.ts`) still fire correctly.
- **Commit**: `3f3826b8`
- **Also surfaced** (not fixed, logged for a future entry): `web/lib/services/openrouter.ts` and `web/lib/intelligence/relations-engine.ts` trip the same rule — previously masked by the false-positive noise on other files. Needs its own investigation (may be real, may be a third gap in the rule) before touching.
