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

### 2026-07-24 — reserved-keyword rule false-positives on `const` inside identifiers it doesn't own
- **Rule**: "Syntax Error Risk: Reserved keyword 'const' used as identifier" (source file TBD — grep `scripts/quality-engine/rules` for the exact rule name)
- **Symptom**: flagged `web/lib/config/cascade.ts` (commit `e6acd4e4`) twice for `export const ANALYSIS_CASCADE` / `export const CHAT_CASCADE` — normal `export const` declarations, not `const` used *as* an identifier name.
- **Root cause (hypothesis, not yet confirmed)**: likely a crude substring/regex match on the literal token `const` without checking whether it's in declaration-keyword position vs. identifier position.
- **Not fixed yet** — needs a look at the actual rule source before editing (same class of bug as the two `StreamResilienceRule` entries below: text-matching without position/AST awareness).

## Resolved

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
