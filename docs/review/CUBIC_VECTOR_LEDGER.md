# The Complete Cubic Vector Ledger

> **Date Range Covered in this Ledger:** 2026-10-12 to 2026-10-13 (Batch 1: PRs #506 down to #471).  
> **Remaining Ranges to Process:**
> - Batch 2: PRs #470 down to #437 (2026-10-04 to 2026-10-12)
> - Batch 3: PRs #436 down to #404 (2026-10-02 to 2026-10-04)
> - Batch 4: PRs #403 down to #374 (2026-09-30 to 2026-10-02)
> - Batch 5: PRs #373 down to #343 (2026-09-24 to 2026-09-30)
> - Batch 6: PRs #342 down to #313 (2026-09-15 to 2026-09-24)
> - Historical: PRs #312 down to repo first commit #7 (2026-05-15 to 2026-09-15)

---

## Top Vector Coverage Table

| Vector ID & Name | Enforcing qa-intel Rule | Rule Source File | Rule Exists? |
|---|---|---|:---:|
| **V01: Documentation and ledger drift** | *none yet* (Review checklist / CI comparison) | *none* | ❌ No |
| **V02: Pattern matcher & regex bypass** | `AuthorizationRegexBypassRule`, `ConflictMarkerRule` | `scripts/quality-engine/rules/security.ts`, `data-lessons-20260924.ts` | ✅ Yes |
| **V03: Silent success or fail-open fallback** | `FailOpenUndefinedFilterRule`, `InsecureFallbackRule` | `scripts/quality-engine/rules/artas-rules.ts`, `security.ts` | ✅ Yes |
| **V04: Unvalidated model or external output** | `SchemaContractRule`, `SilentDefaultOnExternalResponseRule` | `scripts/quality-engine/rules/architecture.ts`, `reliability-lessons-20260924.ts` | ✅ Yes |
| **V05: Secret or signed-URL leakage** | `SecretsExposureRule`, `CredentialLeakRule`, `UntrustedLogInterpolationRule` | `scripts/quality-engine/rules/security.ts`, `data-lessons-20260924.ts` | ✅ Yes |
| **V06: Shared-state UI & layout regressions** | `ZustandWholeStoreInEffectDepsRule`, `InpAlertBlockerRule`, `StartTransitionWrappingRule` | `scripts/quality-engine/rules/ui.ts` | ✅ Yes |
| **V07: Configuration or registry key gaps** | `UnregisteredSettingsKeyRule` | `scripts/quality-engine/rules/lessons-20261009.ts` | ✅ Yes |
| **V08: Unbounded waits and missing timeouts** | `ServerFetchWithoutTimeoutRule`, `TimeoutCleanupRule`, `StreamReaderWithoutFinallyRule` | `scripts/quality-engine/rules/reliability-lessons-20260924.ts`, `quality.ts`, `lessons-20261009.ts` | ✅ Yes |
| **V09: Installer, shell & config edge cases** | `CrossPlatformRule`, `YamlInjectionRule` | `scripts/quality-engine/rules/architecture.ts`, `security.ts` | ✅ Yes |
| **V10: Dead or unwired code, inflated metrics**| `DeadCodeRule`, `AsyncWithoutAwaitRule` | `scripts/quality-engine/rules/quality.ts` | ✅ Yes |
| **V11: Zero, NaN and boundary inputs** | `NumberCoercionGuardRule`, `TruncationValidationRule` | `scripts/quality-engine/rules/quality.ts`, `data-integrity.ts` | ✅ Yes |
| **V12: Retry, redelivery, and idempotency** | `NonIdempotentRetryRule`, `SuccessGuardedPersistenceRule`, `RetryFlagInterferenceRule` | `scripts/quality-engine/rules/artas-rules.ts`, `reliability-lessons-20260924.ts`, `persistence.ts` | ✅ Yes |
| **V13: SSRF and unbounded body buffer reads** | `UnboundedBodyReadRule`, `UnconsumedStreamLeakRule` | `scripts/quality-engine/rules/artas-rules.ts` | ✅ Yes |
| **V14: Privilege escalation & SQL DEFINER** | `SqlSecurityDefinerCallerKeyRule`, `SqlDropFunctionDefaultArgRule` | `scripts/quality-engine/rules/sql-migrations.ts` | ✅ Yes |
| **V15: Untrusted tier grants & billing bypass**| `HardcodedTierGrantRule`, `UntrustedTierFallbackRule`, `ServiceRoleAnonFallbackRule`, `RuntimeTierTrustRule` | `scripts/quality-engine/rules/security-lessons-20260924.ts` | ✅ Yes |
| **V16: DB concurrency & JSONB clobber** | `JsonbReadModifyWriteRule`, `AdvisoryLockIsolationGuardRule` | `scripts/quality-engine/rules/data-lessons-20260924.ts`, `security-lessons-20261010.ts` | ✅ Yes |
| **V17: Stream lifecycle & socket leaks** | `StreamResilienceRule`, `StreamSettleRule`, `StreamReaderWithoutFinallyRule` | `scripts/quality-engine/rules/streaming.ts`, `lessons-20261009.ts` | ✅ Yes |
| **V18: Prompt drift & LLM contract mismatches**| *none yet* (Bake-off evaluation harnesses) | *none* | ❌ No |
| **V19: Client-IP and header spoofing** | `IpHeaderSinkRule` | `scripts/quality-engine/rules/security-lessons-20261010.ts` | ✅ Yes |
| **V20: Launch path & environment isolation** | `LaunchPathIsolationLiteralRule` | `scripts/quality-engine/rules/security-lessons-20261010.ts` | ✅ Yes |
| **V21: Type-casting safety & non-null assert**| `NonNullAfterArraySortFilterRule` | `scripts/quality-engine/rules/security-lessons-20260905.ts` | ✅ Yes |

---

# Cubic Vector Ledger (PRs #440-#506)

Source: `gh api` pulls of inline comments, issue comments and reviews for PRs 440-506
on Hex-Tech-Lab/hex-yt-intel. Filtered to `cubic-dev-ai[bot]`, `coderabbitai[bot]`,
`codacy-production[bot]`. Replies read from `TechHypeXP` on those threads.

Counting method: the 191 Cubic inline comments were hand-classified into vectors, so
counts are approximate (a comment can carry two vectors; the count reflects the primary one).
Cubic inline comments exist only for PRs 442-472. Cubic summary reviews (54) add no
new findings; they repeat "All reported issues were addressed" or "No issues found".
Cubic posts nothing on PRs 473-506.

Cubic severity mix (191 inline): P1 30, P2 121, P3 40.

---

## 1. Recurring defect vectors (ranked by approximate frequency)

### V1. Documentation and ledger drift (about 20 hits)
- **PRs:** 442 (most), 443, 444, 446, 461, 463, 465
- **Quote:** "`.memory/DEFENSIVE_LEDGER.md` lists 47 unique nodes, not 38."
- **Question:** Does every number, timestamp, path and "verified" claim in this doc match the code or ledger it describes right now?
- **Files:** `.memory/AGENT_LEDGER.md`, `.memory/DEFENSIVE_LEDGER.md`, `.memory/ARTAS_REGISTRY.md`, `.qa-intel/baseline.json`, code comments near constants
- **Sub-patterns:** out-of-order ledger timestamps; seconds and offset missing from `[ts]`; `file:///home/...` links; comments claiming behaviour the code no longer has (`.vercelignore` comment, `LLMCascade` JSDoc placement).

### V2. Pattern matcher bypass (lint rules, guards, parsers) (about 18 hits)
- **PRs:** 460 (7), 463 (5), 447 (4), 468 (6 across markdown helpers)
- **Quote:** "HTTP header names are case-insensitive, but this regex only matches lowercase literals"
- **Question:** What input shape (case, whitespace or newlines, `?.`, `~~~` fences, comments, `++` prefix, a second call in the same function) makes this check pass when it should fail?
- **Files:** `scripts/quality-engine/rules/*.ts`, `scripts/commit-guard/commit_guard.py`, `web/lib/utils/section-headings.ts`, `web/lib/utils/markdown-table-width.ts`, `web/lib/utils/format.tsx`
- **Sub-patterns:** `getFullText()` keeps comments, so a comment can silence a rule (460); a lock check matches anywhere in the function, not on the guarded path (463); a guard that matches a comment or log (463); `~~~` fences ignored (468); backslash-escaped pipe parity (468).

### V3. Silent success or fail-open fallback (about 16 hits)
- **PRs:** 442 (about 9), 446 (2), 447 (2), 463 (3)
- **Quote:** "this fallback reports success without writing the partial row"
- **Question:** When this dependency is missing or the input is empty, does the function return an error, or does it return success?
- **Files:** `worker/src/services/EpistemicPipelineDispatcher.ts`, `worker/src/services/GroundedExtractionEngine.ts`, `worker/src/services/ProjectiveSynthesisEngine.ts`, `web/lib/usecases/epistemic-shadow-grant.ts`, `scripts/quality-engine/rules/artas-rules.ts`
- **Sub-patterns:** `{}` treated as zero claims (442); an empty synthesis object returned as success (442); absent sensors read as healthy (442); a stale cached `true` used after a failed refresh (446); a nullable argument skipped by the type-checker filter (463).

### V4. Unvalidated model or external output accepted (about 12 hits)
- **PRs:** 442 (about 9), 446 (1), 447 (2)
- **Quote:** "A valid response like `{}` is accepted as zero claims and flushed"
- **Question:** Does every field that came from a model, a provider or a request body get type, range and presence checks before use?
- **Files:** `worker/src/services/sensor-fusion/probes/MultimodalProbeRunner.ts`, `web/lib/types/contracts.ts`, `web/app/api/analyses/[id]/grounded-claims/route.ts`, `scripts/commit-guard/jev.py`
- **Sub-patterns:** `"false"` coerced to `true` (442); reversed or negative timestamp ranges accepted (442); duplicate claim IDs accepted (442); missing confidence treated as certainty (442); the grounded-claims route accepts malformed payloads (446); Jev scores unchecked (447).

### V5. Secret or signed-URL leakage into Sentry, logs or thrown errors (about 9 hits)
- **PRs:** 442 (5), 447 (2), 452 (1), 442 `diarization-metrics` (1)
- **Quote:** "upstream error text can include a signed media URL"
- **Question:** Does any path from a caught provider error, URL parse error or HTTP body reach `captureException`, `console.*` or a thrown message without redaction?
- **Files:** `worker/src/adapters/AssemblyAIAdapter.ts`, `worker/src/services/sensor-fusion/probes/DiarizationFactory.ts`, `worker/src/services/sensor-fusion/diarization-metrics.ts`, `scripts/jev/jevRouter.ts`, `scripts/commit-guard/commit_guard.py`
- **Sub-patterns:** a URL parse error keeps `input` (442); the commit guard prints the first 24 characters of the matched line (447); a `redactMediaUrl` that covers `extra` but not the message (442).

### V6. Shared-state UI and layout transition regressions (about 8 hits)
- **PRs:** 442 (5), 456 (2), 461 (3)
- **Quote:** "Unmounting `MindMap` now clears text the user selected anywhere in the document."
- **Question:** Does this effect or cleanup touch global state (document selection, localStorage, a shared store) beyond the component that owns it? Does the state survive a mode switch, a remount, or a breakpoint crossing?
- **Files:** `web/components/templates/console/{MindMap,WordCloud,KnowledgeGraphCanvas,DashboardLayout,DimensionDrawer}.tsx`, `web/lib/hooks/useDashboardLayout.ts`
- **Sub-patterns:** global selection cleared (442 x3); a resize handle that is mouse-only and not keyboard-focusable (442); reset does not survive a shape toggle (461); a Group mounts with the default layout on a live shape switch (456, 461).

### V7. Configuration or registry key gaps (about 8 hits)
- **PRs:** 442 (4), 443 (3), 451 (1), 454 (1)
- **Quote:** "Both definitions accept any string up to 16 characters"
- **Question:** Is every new tunable registered (key, enum, range, migration, validation marker), and does the resolver validate it before anything else runs?
- **Files:** `supabase/migrations/*.sql`, `web/lib/config/cascade.ts`, `web/lib/config/epistemic-shadow.ts`, `worker/src/services/LLMCascade.ts`
- **Sub-patterns:** retry key never registered, so the registry lookup always falls back (451); an enum column accepts values that `parseReasoningEffort` throws on (443); a saveable fractional cap that breaks cascade resolution (442); Haiku tiers without `providerOrder` pass validation (442).

### V8. Unbounded waits and missing timeouts (about 7 hits)
- **PRs:** 442 (4), 451 (2), 442 poll loop (1)
- **Quote:** "This OpenRouter request has no timeout, so a stalled response"
- **Question:** Does every network call have its own deadline, separate from the cascade budget, and is that deadline cleared on success?
- **Files:** `scripts/phase-c-live-smoke-test.ts`, `web/lib/adapters/WorkerIngestionAdapter.ts`, `worker/src/adapters/AssemblyAIAdapter.ts`, `worker/src/services/EpistemicShadowRunner.ts`
- **Sub-patterns:** a per-iteration `abort` listener that is never removed (442); `Promise.all` over up to 15 chunks throws away every good chunk on one failure (442).

### V9. Installer and shell edge cases (about 7 hits)
- **PRs:** 447 (7, all in `scripts/commit-guard/install.sh`)
- **Quote:** "Appending the guard after the existing hook makes it unreachable"
- **Question:** Does the install step work from any cwd, with any shebang, a hook without a trailing newline, a symlink, a restrictive mode, and an existing hook that exits early?
- **Files:** `scripts/commit-guard/install.sh`
- **Sub-patterns:** raw relative `core.hooksPath` (use `git rev-parse`); shebangs such as `#!/usr/bin/bash` rejected; `0755` becoming `0711`; symlinks detached from the target.

### V10. Dead or unwired code, and inflated measurement (about 13 hits combined)
- **PRs:** 442 (wiring: about 7; metrics: about 6)
- **Quote:** "No production code calls this resolver, so saved overrides never reach the pipeline."
- **Question:** Is this new code reachable from a production entry point? And does the metric or test actually fail when the behaviour is wrong (for example 100% when the set is empty)?
- **Files:** `worker/src/services/sensor-fusion/probes/sampler.ts`, `worker/src/services/CombinerPass.ts` (duplicate of `web/lib/services/CombinerPass.ts`), `scripts/phase-c-micro-bakeoff.ts`, `scripts/phase-c-bakeoff.ts`, `scripts/phase-c-live-smoke-test.ts`
- **Quote (metrics):** "This reports 100% when there are no projections"

### Smaller recurring vectors (under 6 hits each)
- **Zero, NaN and boundary inputs (about 6):** `chunkDurationSec = 0` makes `numChunks` infinite (442); `MAX_JEV_CALLS` typo becomes `NaN`, which disables the cap (442); a start of `00:00` suppressed as falsy (442); `end >= start` not enforced (442). Question: what does this do at 0, negative, NaN and the exact boundary?
- **Deployment config placement (about 6):** `statusCode` combined with `permanent` (458); a root `vercel.json` outside the `web` root directory (458); unescaped regex dots in a host matcher (458); a connection string committed as a plain `vars` entry (442); UAT added to the production CORS allowlist (442). Question: is this config loaded by the deployed root directory, and are its values secret or public?
- **Prompt and contract drift (about 5):** a prompt example that is not valid JSON (442 x2); a prompt that asks for deductive projection despite a zero-extrapolation rule (442); a smoke test that calls a different model from the one it claims (442). Question: does the prompt example parse under `JSON.parse`, and does the model named in the log match the model called?
- **Retry and idempotency (about 2):** an in-memory `flag` does not stop a duplicate dispatch on retry (446). Question: is this guard shared across requests, or only per request?

---

## 2. Sequential review procedure (as Cubic appears to run it)

Inferred from the order and priority of findings within each PR. Cubic is not documented, so treat this as a working model.

1. **Contracts and schemas first.** Zod refines, enum values, example JSON in prompts, and the shape of cross-service payloads (V4, V7).
2. **Error and fallback paths.** Every `catch`, every `?? default`, every "return success when optional dependency is absent" (V3).
3. **Trust boundaries and secrets.** Anything sent to Sentry, console, a thrown message, or a response body (V5). Most P1 findings come from here.
4. **Reachability and wiring.** Is the new function called from a production entry point? (V10). Cubic checks this with grep, and most of its "never called" findings are right.
5. **Concurrency, ordering and retries.** Partial writes racing the final write, `Promise.all` over a set of chunks, duplicate dispatch, listener leaks (V8, retry vector).
6. **Boundaries and numeric edges.** Zero, NaN, negative, the exact limit, and the first or last element (zero and boundary vector).
7. **Tests and metrics.** Do fixtures predetermine the answer? Does the metric report 100% on empty input? Does the test fail when the fix is reverted? (V10)
8. **UI state transitions.** Mount, unmount, shape switch, breakpoint, and global side effects (V6).
9. **Docs and ledgers last.** Timestamps, counts, comment accuracy (V1). These are almost always P3, and most of them are one-line fixes.

Priority pattern in the data: P1 is nearly always a security leak, a fail-open path, data loss, or a deploy that will not load. P2 is correctness and wiring. P3 is style, comments and ledger text.

**Checklist for a reviewer before opening a PR** (each question maps to a vector above):
- Does every new `catch` log, capture, or rethrow? (V3, V5)
- Does every new fallback return an error, not success? (V3)
- Is any value from a model, a provider or a body validated for type, range and presence? (V4)
- Does any error text, URL or body reach Sentry or a log without redaction? (V5)
- Is every new function called from a production entry point, not just from tests? (V10)
- Does the test fail if the fix is reverted? (V10)
- Does every network call have its own timeout, cleared on success? (V8)
- Does a lint rule or guard handle case, whitespace, comments, `~~~` fences and `?.`? (V2)
- Is every new tunable registered, with validation, in the settings registry and a migration? (V7)
- Does any effect touch global state (document selection, storage, shared store) beyond its own component? (V6)
- Do the numbers, timestamps and file paths in the docs and ledgers match the code now? (V1)
- Do zero, NaN and negative inputs behave correctly? (boundary vector)

---

## 3. Accepted vs rejected suggestions

Read from `TechHypeXP` replies on Cubic threads (142 replies cover 191 Cubic inline comments).

### Fixed (most of them)
Mostly tagged `VALID-FIX`, `FIXED`, `ALREADY-FIXED` or `STYLE-FIX`, with a triage doc under `docs/reviews/` and often a negative-control regression test.
- Redaction of provider error text before Sentry (442).
- Weighted block averages in `analyze()` (442).
- Per-speaker interval union in diarization metrics (442).
- Schema refines for reversed ranges and duplicate claim IDs (442).
- Fail-closed on schema-invalid model output (442).
- Stream-to-fallback ordering and partial-output suppression (446).
- Grant verification over the raw body, then schema enforcement (446).
- Commit guard: every added line checked, quote-aware header parsing, env template allowlist, validated Jev scores (447).
- Markdown fence handling shared across helpers, with backslash parity (468).
- Trailing-timestamp and `payoff` overlap fixes in highlights (470, 472).

### Accepted as-is, with a stated reason
- **Mutating the caller's input object** (442): the input is single-use and the caller passed buffers so the pipeline can release them. Memory guard by design.
- **Dropping a malformed claim with a warning instead of failing the whole extraction** (442): all-or-nothing aborts were the failure mode ADR 021 was written to fix.
- **Diarization-first routing policy** (442): intentional per ADR 039 section 1.1; physical evidence overrides text heuristics.
- **Per-row failures in the bake-off not retried** (442): offline research harness; retrying would re-pay tokens.
- **Over-wide markdown table rows merged, not widened** (468): an extra cell is almost always a literal pipe in model output; owner-reported. Intentional.
- **Historical ledger entries not rewritten** (442): the ledger is append-only. Timestamp issues were annotated, not overwritten.
- **Secret-looking pooler host left as plain `vars`** (442): the reply argued that a host string without a password is not a secret. (Rejected Cubic's P2; disputed.)
- **Tampered browser body sending `none` for a mandatory reasoning model** (443): self-inflicted 400 for the caller; no cross-user effect. Deferred.

### Pushed back as invalid (the reply said Cubic was wrong)
- **Example JSON in `PromptBuilder`** (442): the example value was a single valid enum, not a `|`-joined list. (Cubic's P1 was wrong about the current head.)
- **`sensorScores` fields missing from `FusionResult`** (442): verified that no such fields exist. The reviewer referenced fields that do not exist.
- **Algebraic claim that chunk timestamps collapse to a fixed 60-second grid** (442): not an identity; the `min` clamp breaks it.
- **Timestamp dimension "duplicate `content.trim()`" style** (442): a correct guard was already in place.

### Deferred (valid, tracked, not fixed in this PR)
- **Wiring the new sensor-fusion pieces into production** (442): the probe orchestrator, sampler, resolver and dispatcher were deliberately unrouted. Wiring requires an ADR and user sign-off (ADR 039 phases B-D). Cubic's P1/P2 reachability findings were accepted as valid, but out of scope.
- **Role split (system vs user) in `streamCascade`** (446): Won't fix in the PR. The shared builder is used by every legacy bundle, and splitting changes caching for all of them.
- **Cross-request dedup of the shadow run** (446): flag defaults off. An idempotent overwrite costs extra spend, and a KV or Redis lock is a tracked blocker.
- **Per-occurrence baseline fingerprints** (463): the baseline is file plus title by engine design; changing it is an engine change.
- **Replaying migrations to detect deleted keys** (463): belongs in the shared manifest builder. Today's rule errs toward passing, never toward a false positive.
- **Typed-program analysis for `V05`** (463): needs the engine to load a real tsconfig Program.
- **Git history rewrite to remove research blobs** (462): accepted as a time-boxed risk and scheduled as repo-reorg Phase 4.
- **Deleting the duplicate `worker/src/services/CombinerPass.ts`** (442): deferred to a dead-code cleanup PR to keep the review round scoped.

### Recurring pattern in pushback
Pushback is not a dismissal. Each rejected or deferred item has a reason tied to an ADR or a measured behaviour (for example, "verified: only references are tests"). Reviewers who want fewer rounds should bring that evidence in the first reply rather than waiting for the bot to reopen the thread.

---

## 4. CodeRabbit and Codacy (secondary)

**CodeRabbit** (162 inline, 51 reviews, PRs 442-485). Inline bodies are tagged by category: Functional Correctness (22), Maintainability (11), Security & Privacy (8), Stability & Availability (6), Data Integrity (4), plus about 42 untagged. The largest counts are on PR 442 (40), 447 (14), 463 (9), 481 (3). Themes overlap with Cubic: timeouts, error-path handling, URL redaction, and config drift. Replies on CodeRabbit threads were typically "Fixed in <sha>" and then a thank-you from CodeRabbit.

**Codacy** (one summary per PR, PRs 440-506): PRs 440-442, 449, 461, 468, 472, 473, 477, 487-506 report "Not up to standards". Most others pass. Codacy's gate was red on every PR from 487 to 506; it was not investigated in this pass, so do not treat those results as analysed.

---

## 5. Notes for the owner

- Cubic covered only PRs 442-472 in this window. It may have been turned off or stopped reviewing after #472. Check the Cubic settings before expecting it on newer PRs.
- Vectors V1-V3 (docs drift, pattern bypass, silent success) account for about half of all hits. A pre-PR self-check on those three questions catches most of what Cubic flagged.
- The counts above are approximate. The source data is in the `gh api` output for each PR (inline, issue and review endpoints). Re-run a count before quoting any number in a report.


---

## 6. Batch 1 Harvested Entries (PRs #471–#506: 2026-10-12 to 2026-10-13)

| Vector Name | Source (Bot, PR/Finding ID, Date) | What Was Caught | The Question to Ask on Every Future PR | Enforcing qa-intel Rule (or none yet) |
|---|---|---|---|---|
| **V08 (Unbounded waits & missing timeouts)** | CodeRabbit / PR #502 / 2026-10-13 | Premature watchdog timer expiration during worker streaming persist frame (`saving` stuck indicator) | Does every watchdog or timeout timer arm only after receiving the initial streaming persist frame, and clear upon settlement? | `TimeoutCleanupRule` (`scripts/quality-engine/rules/quality.ts`) |
| **V04 (Unvalidated model output & schema contract)** | Cubic (`f050cf0c`) / PR #472 / 2026-10-12 | Payoff extension pushes clip past next highlight start, causing subsequent highlights to move forward by a full line or drop | Does payoff or boundary extension check the next element start position to prevent collisions or dropped items? | `SchemaContractRule` (`scripts/quality-engine/rules/architecture.ts`) |
| **V11 (Zero, NaN and boundary inputs)** | Cubic (`10e4ef99`) / PR #472 / 2026-10-12 | Follow-through line matching treated any line with a bare digit as a payoff, extending clips on unrelated text | Are numeric regex matchers bounded to conversational follow-through context rather than matching any raw digit? | `NumberCoercionGuardRule` (`scripts/quality-engine/rules/quality.ts`) |
| **V10 (Dead code & redundant computation)** | Cubic (`4f8c32f3`) / PR #472 / 2026-10-12 | `withEnds` segment mapping rebuilt on every `harvestWindow` loop iteration and retry instead of being cached once | Are immutable collections computed outside of iterative/retry closures to prevent redundant allocations? | `DeadCodeRule` (`scripts/quality-engine/rules/quality.ts`) |
| **V10 (Goal-driven test coverage & negative control)** | CodeRabbit (`0d0ad7b4`) / PR #472 / 2026-10-12 | Regression test suite missed assertion for `FOLLOW_THROUGH` behavior on completed sentences | Does every bug fix and feature addition have a regression test that fails if the implementation is removed? | `none yet (goal-driven test review)` |
| **V03 (Silent success or fail-open fallback)** | Sourcery / PR #506 / 2026-10-13 | Comment sentiment consumer returned success without writing or notifying when sampling-claims failed | Does the consumer fail closed and re-raise/reject immediately when any required dependency step fails? | `FailOpenUndefinedFilterRule` (`scripts/quality-engine/rules/artas-rules.ts`) |
| **V14 (Privilege escalation & SQL grants)** | CodeRabbit / PR #503 / 2026-10-13 | `get_temporal_subgraph` SECURITY DEFINER SQL function permissions and auth.uid() null check drift | Does every SECURITY DEFINER migration revoke execute from public/anon and check caller ownership explicitly? | `SqlSecurityDefinerCallerKeyRule` (`scripts/quality-engine/rules/sql-migrations.ts`) |
| **V01 (Documentation and ledger drift)** | Sourcery & CodeRabbit / PR #503 / 2026-10-13 | Discrepancy between THOS handover timestamp records and live code timeout settings | Does every timestamp, duration, and deadline in documentation exactly match the real constant values in code? | `none yet (review checklist enforced)` |
| **V06 (Shared-state UI & layout regressions)** | CodeRabbit / PR #491 / 2026-10-12 | Panel default widths hardcoded inconsistently between local storage defaults and dashboard layout SSR hydration | Does layout sizing use single-source-of-truth default width constants across both server rendering and client hydration? | `ZustandWholeStoreInEffectDepsRule` (`scripts/quality-engine/rules/ui.ts`) |
| **V18 (Prompt drift & LLM contract mismatches)** | CodeRabbit / PR #492 / 2026-10-12 | Exact Dim 7 placeholder string mismatch between backend generation prompt and frontend renderer parser | Does the renderer parse exact literal strings matching the system prompt Insufficient Data Protocol specification? | `none yet (evaluator benchmark enforced)` |
