# Tech Debt Ledger

Generated from a full-repo `qa-intel --mode full` + `contract-auditor` sweep on
2026-08-02, post-merge of PRs #183-187. All findings below are **pre-existing**
(present in `main` before this session's PRs, not introduced by them) — 0
critical, 21 high (qa-intel), 31 warning (contract-auditor).

Scored by **priority = severity × blast radius × exploitability/user impact**.
Fix top-down; each item lists file(s), the concrete failure mode, and rough
effort.

## P0 — verified 2026-08-02, all three are false positives (no fix needed)

| # | Finding | File(s) | Verification |
|---|---|---|---|
| 1 | YAML injection (unescaped values) | `web/app/api/chat/capture-question/route.ts` | Already fixed — `escapeYamlValue()` helper at line 151-156 quotes/escapes every front-matter value, explicitly labeled "P0 Security Fix" in a comment. qa-intel's regex flags the raw `key: value` template literal shape without seeing the escape call feeding it. |
| 2 | POST 307 redirect preserves method | `web/app/api/auth/signin/route.ts` | Already correct — `POST()` uses **303** (line 26), only the separate `GET()` handler uses 307 (harmless: GET→GET). qa-intel matched "307" textually near "POST" without distinguishing the two exported handlers. |
| 3 | Sensitive `userId` in error logs | `web/lib/skills/wiki-builder/wiki-builder.ts` | Server-side-only `console.error`/`Sentry.captureException` correlation-ID logging (not user-facing, not a secret) — matches this repo's own "always use correlation IDs for traceability" convention. qa-intel's `InformationDisclosureRule` treats any `userId` token in a log line as sensitive regardless of context. |

**Action**: none required on the code. Consider tightening qa-intel's `InformationDisclosureRule`/307-redirect regex to reduce this false-positive rate (rule maintenance itself is a P2, tracked below).

## P1 — schedule this sprint (real but needs judgment / bigger surface)

| # | Finding | File(s) | Failure scenario | Effort |
|---|---|---|---|---|
| 5 | Stream timeout abort doesn't settle error state — **currently dormant, not dead** | `web/lib/services/openrouter.ts` | `callOpenRouter`/`AnalysisEngineError` have zero *current* callers (verified via exhaustive grep), but ADR 011 explicitly documents this file as the intentional Vercel single-model-completion fallback path ("chat completions, if ever used") — do **not** delete. On final-tier `AbortError` it does correctly `throw err` (not a silent swallow — qa-intel's title is slightly misleading), but no caller exists yet to catch that throw and settle UI/DB state, so the finding is real but only activates the day this fallback path gets wired up. Track as "verify error-state settling when this path is activated," not an active bug today. | — (no action until wired up) |
| 6 | Persist call, no retry/error-state | `web/app/atlas/AtlasClient.tsx`, `web/lib/services/sentry-telemetry.ts` | Transient network blip = permanently lost write, no user-visible failure | M |
| 7 | Empty catch swallows error | `web/lib/chat/outbox.ts`, `web/lib/adapters/YouTubePlayerAdapter.ts`, `web/hooks/useSearch.ts`, `web/hooks/useRelations.ts` | Real fetch/clipboard/persist failures vanish with zero telemetry — indistinguishable from success in prod | S each |

### 4 — DEMOTED to false positive (verified 2026-08-02)

`web/app/api/admin/settings/route.ts` (×3), `web/app/api/admin/stats/route.ts`,
`web/app/api/billing/checkout/route.ts`, `web/app/api/webhooks/upstash-snapshot-poll/route.ts`

- `admin/settings` has **zero** `.insert`/`.upsert`/`.update` calls — pure `.select()` reads. This is the exact bug already tracked in `docs/qa-intel/RULESET_LESSONS_LEDGER.md` (2026-07-25 entry, "fires on read-only .select() calls") — **still unfixed as of this scan**.
- `admin/stats` and `billing/checkout` each have one real `.insert()` into `usage_logs`, but every field is server-computed (`userId` from the authenticated session, a static `action` string, `new Date().toISOString()`) — no raw client input reaches the row. `billing/checkout`'s only user-supplied fields (`successUrl`/`cancelUrl`) are already Zod-validated earlier in the handler (`validation.data.*`) before this insert.
- `upstash-snapshot-poll` is QStash-signature-verified (401s on bad signature) and inserts only internally-computed poll results (`pollRedis()`/`pollVector()` return values), not raw request body content.

None of the four writes puts unvalidated external input into the DB. Rule needs
a second fix beyond the 2026-07-25 one: also skip firing when every inserted
field is either a literal, a server-derived value (session/auth/timestamp), or
already passed through a Zod parse earlier in the same function — see ledger
item 12 below.

## P2 — track, fix opportunistically (test-file only or narrow blast radius)

| # | Finding | File(s) | Note |
|---|---|---|---|
| 8 | Empty catch in test file | `worker/src/__tests__/TranscriptExtractor.test.ts` (×3) | Test-only, no prod blast radius — lowest priority of the empty-catch group |
| 9 | Persist call in test file | `web/lib/__tests__/SupabaseTranscriptAdapter.test.ts` | Test-only |
| 10 | `SILENT_ERROR_RETURN_NO_TELEMETRY` | `web/lib/skills/wiki-builder/wiki-builder.ts` (×2), `web/lib/utils/require-admin.ts` (×2), `web/middleware.ts` | Same class as the fixed `LLMCascade.ts` pattern (commit `23eb5a36`) — failure objects returned with no throw/log, invisible to telemetry. `require-admin.ts` and `middleware.ts` are auth-adjacent, worth prioritizing above wiki-builder within this tier |
| 11 | `UNVERIFIED_ENDPOINT_NO_TEST` (OpenRouter) | `web/lib/intelligence/relations-engine.ts`, `web/lib/services/dimension-remediation.ts`, `web/lib/services/openrouter.ts`, `worker/src/chat-stream.ts`, `worker/src/services/CommentClassifier.ts`, `worker/src/services/LLMCascade.ts` | Hardcoded OpenRouter API paths, no contract test — matches the class of bug that already silently 404'd for Supabase `logs.all`/QStash schedule endpoints once. Not urgent (external API is stable) but cheap insurance: one shared contract test asserting the request shape against OpenRouter's OpenAPI spec would cover all 6 sites |

| 12 | qa-intel false-positive rate | `scripts/verify-quality-engine.ts` rules `InformationDisclosureRule`, POST-307 detector | Both fired on already-correct code (see P0 verification above) — narrow the regex to check which exported handler function a "307" match sits inside, and exempt `userId`/similar identifier logging from the sensitive-pattern list unless paired with a real secret pattern (token/key/password) | S |

## Not re-litigated here

CodeFactor complexity/style findings on `DimensionDrawer.tsx` /
`ExpandedPanelOverlay.tsx` (missing JSDoc, non-null assertions, cyclomatic
complexity 8) surfaced during PR #183/#185 review — already logged as
pre-existing, non-blocking, not duplicated into this ledger to avoid two
sources of truth. See PR #183/#185 review threads.

## Next scan

Re-run `pnpm tsx scripts/verify-quality-engine.ts --mode full` and
`pnpm tsx web/scripts/contract-auditor.ts` after clearing P0/P1 to confirm no
regressions and pick up P2 progress.
