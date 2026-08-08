# Historical Trend Analysis — hex-yt-intel Audit History (2026-05-16 → 2026-08-08)

**Compiled by:** CC (Claude Code), as a follow-on to `COMPARATIVE_ANALYSIS_2026_07_31_vs_2026_08_08.md` (which compared exactly two reports). This document extends that comparison across the project's **entire** 88-day audit history.

**Purpose:** build the historical record of recurring finding classes purely from what each dated audit document itself says. This is **not** an independent re-verification against current code — see item 5 below and the Comparative Analysis doc for that separate, partially-done exercise.

---

## 1. Methodology

- Listed all 51 files in `docs/audit/*.md` (`ls -la`), spanning file mtimes 2026-05-16 → 2026-08-08 (note: several files carry a uniform `Jul 8 13:31` mtime from a bulk copy/commit event — their **content headers/filenames**, not mtimes, were used for dating).
- Ran targeted greps across all files for the 5 known recurring-finding-class keyword sets (stale/`getState()` reads, `NOT VALID`/FK, monolithic file/LOC, hexagonal/adapter-bypass, CodeRabbit/DeepSource/SonarCloud/Cubic), then read matched sections in full context (not just headers) to confirm severity/status language.
- Cross-referenced `.memory/ADRS.md` and `.memory/AGENT_LEDGER.md` for any additional recurring-finding context not captured in `docs/audit/`.
- Dates below are pulled from each document's own filename/header (e.g., "Prior baseline: ... @ `df60965`", "HEAD: cbf3a88") — not estimated from file mtimes, except where noted.

### Files read in full or near-full detail
`DEEP_STRUCTURAL_AUDIT_2026_06_06.md`, `10X_CODEBASE_AUDIT_2026_06_07.md`, `10X_FULL_SPECTRUM_REAUDIT_2026_06_07.md`, `10X_REAUDIT_COMPARISON_2026_06_07.md`, `10X_REAUDIT_III_COMBINED_2026_06_07_1552.md`, `10X_REAUDIT_III_CORRECTED_2026_06_07_1605.md`, `10X_REAUDIT_IV_COMBINED_2026_06_10.md`, `10X_REAUDIT_V_COMBINED_2026_06_10.md`, `10X_FULL_SPECTRUM_REAUDIT_2026_06_11.md`, `10X_AUDIT_MASTER_CHECKLIST_2026_06_14.md`, `10X_FULL_SPECTRUM_REAUDIT_2026_06_22.md`, `10X_FIX_CLUSTER_PLAN_2026_06_29.md`, `10X_FIX_CLUSTER_PLAN_v2.0.0_2026-06-29.md`, `10X_FULL_SPECTRUM_REAUDIT_2026_06_29.md`, `QA_INTEL_ENGINE_ASSESSMENT_v1.0.0_2026-06-29.md`, `10X_FULL_SPECTRUM_REAUDIT_2026_07_23.md`, `code_review_2026_07_31.md`, `10X_FULL_SPECTRUM_REAUDIT_2026_08_08.md`, `COMPARATIVE_ANALYSIS_2026_07_31_vs_2026_08_08.md`, `code_review_report_2026_05_16_2008.md`, `code_review_report_legacy_2026_05_16_1848.md`, `CODE_SIMPLIFIER_REPORT_2026_06_07.md`.

### Files grep-scanned but skipped from the timelines (not comparable content)
- `E2E_*_RCA_2026_06_23.md`, `*_RCA_2026_06_22.md`, `FULL_PATH_RCA_2026_06_22.md`, `FULL_SYSTEM_PATH_TRACE_2026_06_22.md`, `SYSTEM_END_TO_END_RCA_2026_06_22.md`, `SETTLE_ANALYSIS_CALL_SITE_TRACE_2026_06_22.md`, `VECTOR_PATH_RCA_2026_06_23.md`, `VECTOR_PLACEHOLDER_FIX_2026_06_23.md`, `READBACK_FALLBACK_FIX_2026_06_23.md`, `TIMEOUT_FALLBACK_FIX_2026_06_22.md`, `TIMEOUT_FALLBACK_VERIFICATION_2026_06_22.md`, `VISION_VERIFICATION_2026_06_22.md` — these are **single-incident root-cause-analysis / fix-verification docs** for specific bugs (chat readback, vector search placeholder, timeout fallback), not general audits. They don't reference the 5 finding classes in a comparable dated-timeline way; skipped to avoid forcing a fit.
- `WAVE0_*`, `WAVE1_*`, `WAVE2_*` (`WAVE0_ANALYSIS_CREATION_FINDINGS.md`, `WAVE0_CHAT_GROUNDING_FINDINGS.md`, `WAVE0_KG_RELATIONS_FINDINGS.md`, `WAVE0_WAVE2_EXECUTIVE_SUMMARY.md`, `WAVE2_409_DIGEST_FINDINGS.md`, `WAVE_1_AUDIT_SUMMARY.md`) — scoped wave-execution findings docs (2026-07-08/10), mostly single-feature bugs (KG relations empty, 409 digest race). One incidental `getState()`-adjacent mention noted in the timeline below; otherwise skipped as out-of-class.
- `CURRENT_BRANCH_DIFF_EVIDENCE_PR97.md`, `PR_PREPARATION_CHECKLIST.md`, `INVESTIGATION_FINDINGS_2026_07_08.md`, `PRODUCTION_CHAT_ZERO_ADAPTATION_FINDINGS_2026_07_08.md` — PR-specific evidence/checklist docs, not general audits.
- `10X_PREFLIGHT_REPORT_2026_06_11.md`, `10X_PREFLIGHT_REPORT_2026_06_14.md` — short environment-health preflight checks (build/test status only), no finding-class content.
- `VERCEL_SKILLS_DEEP_APPLICATION_2026_06_07_1615.md` — Vercel-performance-specific deep dive; skimmed, contains hexagonal-boundary-adjacent language but is a performance audit, not a general structural one; not added to timelines to avoid double-counting against `10X_REAUDIT_III_*` same-day docs it supplements.
- `code_simplification_report_2026_05_16_2008.md` — earliest doc (2026-05-16), pure LOC-reduction opportunities on a codebase 4 days old; too early to carry any of the 5 finding classes (they hadn't emerged as recurring yet) — used only to confirm the project's LOC-consciousness existed from day 4.

---

## 2. Per-finding-class timelines

### Class 1 — Stale/non-reactive state reads (`getState()` outside React's subscription graph, module-level caches, polling races)

| Date | Audit doc | Status at that point | Notes |
|---|---|---|---|
| 2026-06-07 | `10X_FULL_SPECTRUM_REAUDIT_2026_06_07.md` (finding #7) | 🆕 New | `useSSEStream.ts:187` — synchronous `useAnalysisStore.getState().status` inside an async stream handler, "bypasses React batching, may read stale closure." |
| 2026-07-08/10 | `WAVE0_CHAT_GROUNDING_FINDINGS.md` | Adjacent, not the same finding | Notes "stale analysis state filtered" as a working safeguard elsewhere in chat grounding — not itself a new instance of the bug class, included for completeness. |
| 2026-07-23 | `10X_FULL_SPECTRUM_REAUDIT_2026_07_23.md` | Related remediation note | Recommends `useChatStore.getState().reset()` be called inside `useSSEStream.startAnalysis()` — implies an existing reset-path gap of the same "state read via a channel React doesn't track" shape. |
| 2026-07-31 | `code_review_2026_07_31.md` (C1, N1) | 🆕 New instances | **C1**: module-level `cachedRemainingBudgetCents` singleton in `runRemediationHarness` — cold-start-unsafe on Vercel, flagged as its own instance of the class. **N1**: `useStreamReattach.ts:34` mixes `.getState()` and hook selectors in the same effect — flagged as stylistically inconsistent, not broken. |
| 2026-08-08 | `10X_FULL_SPECTRUM_REAUDIT_2026_08_08.md` (P1.1, P1.2, P1.10, P2.2) | 🆕 New instances (2 later found stale by CC verification) | **P1.2**: `useAnalysisDimensionsStore.getState().getDimension(...)` inside a `useMemo` — memo doesn't re-run as dimensions stream in. **P1.1**: stale `currentPlaybackSeconds` on auto-advance. **P1.10**/**P2.2**: poll loop racing a live seek/stream. |
| 2026-08-08 | `COMPARATIVE_ANALYSIS_2026_07_31_vs_2026_08_08.md` | Verification pass | P1.1 and P1.2 independently confirmed **already fixed** before the audit that reported them finished running (commit `7c56488e` landed ~30 min before the audit's own completion timestamp) — the audit was reading stale code, not a live bug. |

**Trend verdict: cyclical-recurrence, not worsening or resolving.** Every full-spectrum audit cycle since 2026-06-07 (5 of 5 checked cycles) finds at least one new instance of "code reads state through a channel React's render/effect graph doesn't track." Individual instances get fixed fast (C1 in days; P1.1/P1.2 same-session), but the *class* itself has never had a structural fix (e.g., a lint rule banning `.getState()` inside `useMemo`/render bodies) — it is a standing background rate of ~1 new instance per audit cycle, not a shrinking backlog.

---

### Class 2 — DB migration missing `NOT VALID`/`IF EXISTS` (headlined by the `users.id` FK, H2)

| Date | Audit doc | Status at that point | Notes |
|---|---|---|---|
| 2026-06-07 (AM) | `10X_CODEBASE_AUDIT_2026_06_07.md` (F3.1, H2) | 🆕 New — CRITICAL | "`users` table lacks FK to `auth.users`" — `users.id` standalone uuid, no FK enforcement (trigger-only). Logged as H2 in the fix checklist. |
| 2026-06-07 (mid) | `10X_REAUDIT_III_COMBINED_2026_06_07_1552.md` | ✅ Marked RESOLVED (same day) | H2 marked "✅ RESOLVED / ✅ STILL RESOLVED / ✅ DONE" — but this was a shallow pass. |
| 2026-06-07 (later) | `10X_REAUDIT_III_CORRECTED_2026_06_07_1605.md` | ✅ Verified, but flagged `NOT VALID` | Corrected pass actually reads the migration: `users_id_fkey NOT VALID` in `20260607120000_wave4_indexes_and_fk.sql`. FK exists but was **never validated** — the constraint doesn't scan/enforce against pre-existing rows. |
| 2026-06-10 (x2) | `10X_REAUDIT_IV_COMBINED_2026_06_10.md`, `10X_REAUDIT_V_COMBINED_2026_06_10.md` | ✅ "RESOLVED" (superficially) | Both re-confirm "Foreign key added (defined as `NOT VALID` but active)" — treated as resolved despite the `NOT VALID` caveat being restated each time. |
| 2026-06-14 | `10X_AUDIT_MASTER_CHECKLIST_2026_06_14.md` | ✅ Marked done | "Foreign key added (NOT VALID)" carried forward as a checklist ✅ item, `NOT VALID` caveat present but not treated as blocking. |
| 2026-06-22 | `10X_FULL_SPECTRUM_REAUDIT_2026_06_22.md` | ✅/⚠️ mixed | "✅ FIXED / ✅ FK added (NOT VALID per DB audit)" — still open in substance, marked fixed in the checklist. |
| 2026-06-29 | `10X_FULL_SPECTRUM_REAUDIT_2026_06_29.md` | ❌ Reclassified open | First doc to call it explicitly **open**: "`users` FK `NOT VALID` — ❌ open — `20260607120000:8-18` never `VALIDATE`d; pre-existing orphans unchecked." Same-day `10X_FIX_CLUSTER_PLAN_2026_06_29.md` (D5) logs the exact remediation: `ALTER TABLE … VALIDATE CONSTRAINT users_id_fkey`, priority LOW. |
| 2026-07-23 | `10X_FULL_SPECTRUM_REAUDIT_2026_07_23.md` | ❌ Still open | "H2 — `users` FK `NOT VALID` — ❌ open — `20260607120000:16` still `NOT VALID`; no `VALIDATE CONSTRAINT` migration." Grouped under "5 prior open" LOW items. |
| 2026-08-08 | `10X_FULL_SPECTRUM_REAUDIT_2026_08_08.md` (P0.2, P2.13) | ❌ Still open, class **expanded** | H2 itself no longer individually re-listed (the audit's scope shifted to newer migrations), but the **same root pattern recurs on two new tables**: P0.2 — `usage_logs` CHECK constraints added without `NOT VALID` **and** without `IF EXISTS` on the paired `DROP CONSTRAINT` (risk: full-table-scan lock on production `usage_logs`, migration-chain crash on re-run). P2.13 — `transcript_chapters` CHECK constraint added without `NOT VALID` (new table, lower risk today, "sets a bad precedent"). |

**Trend verdict: worsening — the single most persistent unresolved finding class in the project's history.** The original H2 instance has been open for **62+ days** (2026-06-07 → 2026-08-08) and was re-reported (not re-planned — no owner, no target date in any audit) across at least 7 dated documents. Rather than being fixed, the underlying process gap (no pre-merge check for `NOT VALID`/`IF EXISTS` on new constraints) has now produced **two additional instances** on newer tables (`usage_logs`, `transcript_chapters`) as of 2026-08-08 — the class is spreading to new migrations faster than the original instance is being closed.

---

### Class 3 — Monolithic file growth (`DashboardContainer.tsx`, `dimension-remediation.ts`, `SupabasePersistenceAdapter.ts`, `env.ts`)

| Date | Audit doc | Status / measurement | Notes |
|---|---|---|---|
| 2026-06-06 | `DEEP_STRUCTURAL_AUDIT_2026_06_06.md` | 🆕 New — 336 LOC | `DashboardContainer.tsx` flagged as "SoC violation — 4 concerns mixed" at 336 LOC. Also flags `web/lib/prompts` (983 LOC, "BLOATED") and `web/lib/auth` (159 LOC across 7 files, "OVER-ENGINEERED"). |
| 2026-06-07 | `10X_CODEBASE_AUDIT_2026_06_07.md` (F1.1, F1.4) | 🆕 New instances | `analyses/route.ts` at 380 LOC (6 mixed concerns — SRP violation); `env.ts` at 350 LOC (validation+getters+CI mocks+client exports mixed). |
| 2026-06-07 | `CODE_SIMPLIFIER_REPORT_2026_06_07.md` | Remediation proposed | Proposes extracting `AnalyzeVideoUseCase.ts` (~120 LOC) out of `route.ts` (255 LOC at that point) and splitting `env.ts` into 3 files. Not yet implemented per later audits. |
| 2026-06-22 | `10X_FULL_SPECTRUM_REAUDIT_2026_06_22.md` | Mixed — env.ts open, DashboardContainer improving | `env.ts` still ~386 LOC ("❌ OPEN"). `DashboardContainer.tsx` reported **724 → 566 LOC** after a "Wave 6 decomposition" (22% reduction) — still over the 500-LOC qa-intel threshold. |
| 2026-06-29 | `10X_FULL_SPECTRUM_REAUDIT_2026_06_29.md` | Mixed — small further shrink, adapter bloat grows | `DashboardContainer.tsx` 566 → **563 LOC** (−3, "still over 500"). `env.ts` re-measured at **187 LOC** (prior 386 figure called "overstated" — corrected down). `SupabasePersistenceAdapter.ts` flagged growing: **31 one-line delegations + 5 real = 36 methods / 355 LOC** ("worse" than prior "28"). |
| 2026-07-23 | `10X_FULL_SPECTRUM_REAUDIT_2026_07_23.md` | ❌ Regressing | `DashboardContainer.tsx` 563 → **571 LOC** (+8, "still monolithic"). `SupabasePersistenceAdapter.ts` 355 → **493 LOC / 40 methods** (+138 LOC / +4 methods, "worse"). |
| 2026-08-08 | `10X_FULL_SPECTRUM_REAUDIT_2026_08_08.md` (P2.11, P2.16, P3.10) | ❌ Regressed sharply | **P2.16**: `DashboardContainer.tsx` 571 (07-23) → **776 LOC** — labeled "REGRESSED," unsplit. **P2.11**: `dimension-remediation.ts` (not previously tracked in this class's timeline) regressed **665 → 785 lines**. **P3.10**: `ChatDock.tsx` (865 lines) and `AnalysisHistory.tsx` (817 lines) newly flagged as past the split threshold. |

**Trend verdict: worsening.** `DashboardContainer.tsx` went from 724 LOC (pre-06-22) down to a low of 563 LOC (06-29) via one deliberate decomposition pass, then climbed every cycle since (566→563→571→776), ending 88 days in **larger than at the first-measured point**. This is active regrowth outpacing any splitting effort, not a stable plateau — three additional files (`dimension-remediation.ts`, `ChatDock.tsx`, `AnalysisHistory.tsx`) joined the "over-threshold" list in the most recent cycle alone.

---

### Class 4 — Hexagonal-architecture boundary violations (domain/adapter code bypassing ports)

| Date | Audit doc | Status | Notes |
|---|---|---|---|
| 2026-06-07 | `10X_CODEBASE_AUDIT_2026_06_07.md` (F2.2, F2.5) | 🆕 New | **F2.2**: `IQuotaPort.checkGate` accepts `request?: NextRequest`, "leaks HTTP transport into the port contract, violating hexagonal boundary" (this is the same H4 tracked and fixed under Class-2-adjacent H-numbering — see H4 rows in Class 2's source tables, resolved by 2026-06-10). **F2.5**: 1:1 port→adapter mapping with an ISP violation (`IIngestionPort` implemented by two unrelated adapters). |
| 2026-06-22 | `10X_FULL_SPECTRUM_REAUDIT_2026_06_22.md` (CRIT-1, HIGH-5, LOW-1) | 🆕 New instances (different flavor — boundary-adjacent type/filter bypasses) | `SupabaseAnalysisAdapter.ts:24` null-filter leak (SQL `NULL != 'processing'` bypasses cache-active-job filter); `SupabasePersistenceAdapter.ts` unsafe `any` casts bypass type safety in KG mapping; `SupabaseAuthAdapter.ts` silently falls back to 'free' tier on error (potential quota-gate bypass). |
| 2026-06-29 | `10X_FULL_SPECTRUM_REAUDIT_2026_06_29.md` | ❌ Still open (latent) | CRIT-1 null-filter leak reconfirmed: "0 NULL rows in prod currently → not exploitable, but defect remains." |
| 2026-07-23 | `10X_FULL_SPECTRUM_REAUDIT_2026_07_23.md` | ❌ Still open (latent) | CRIT-1 reconfirmed again, same "latent, no NULL rows currently" caveat — 3rd consecutive cycle unfixed. |
| 2026-08-08 | `10X_FULL_SPECTRUM_REAUDIT_2026_08_08.md` (P2.10, P2.15) | ❌ Still open, new domain-service instances | **P2.10**: `relations-engine.ts` calls `fetch()` directly instead of via `OpenRouterCompletionAdapter` (STILL OPEN — Partial). **P2.15**: `aux-remediation.ts` imports `getSupabaseServiceClient()` directly in a domain service, "bypassing persistence ports... Violates Hexagonal Architecture (AGENTS.md §9.1)." |

**Trend verdict: cyclical-recurrence, low-grade but steady.** Unlike Class 2 (one specific finding re-reported), this class shows a *pattern* recurring across different files each cycle — port-contract leaks (06-07), adapter-level filter/type bypasses (06-22 through 07-23, the CRIT-1 null-filter leak alone unfixed for 3 consecutive cycles / ~32 days), then new domain-service-level bypasses (08-08). qa-intel's `HexagonalBoundaryRule` exists specifically because of this history, but it functions as a backstop that reports the shape of the problem rather than one that has stopped new instances from appearing.

---

### Class 5 — AI-review tool coverage eroding (CodeRabbit, DeepSource, SonarCloud, Cubic)

| Date | Audit doc | Status | Notes |
|---|---|---|---|
| 2026-06-07 | `10X_FULL_SPECTRUM_REAUDIT_2026_06_07.md` | Tooling present, functioning | CodeRabbit actively reviewing (HEAD commit `cbf3a88` = "fix(pr-review): address CodeRabbit docstring coverage on PR 58"); PR #58's CodeRabbit feedback fully incorporated. No coverage gap yet. |
| 2026-06-29 | `10X_FIX_CLUSTER_PLAN_2026_06_29.md` | ⚠️ First sign of distrust in free-tier bots | "Gating philosophy: lean on qa-intel as the enforced gate (free, repeatable) and **stop depending on free-tier PR bots (Sourcery/CodeRabbit/cubic)** for correctness" — an explicit strategic pivot away from relying on these tools, predating any reported outage. |
| 2026-06-29 | `QA_INTEL_ENGINE_ASSESSMENT_v1.0.0_2026-06-29.md` | Related, not the same finding | Assesses qa-intel itself as not-yet-trustworthy as a sole gate ("today, leaning on it as-is would itself be a fabricated-green") — context for why the project still needed CodeRabbit/Cubic at this point despite the above pivot plan. |
| 2026-08-08 | `10X_FULL_SPECTRUM_REAUDIT_2026_08_08.md` (P0.4) | ❌ New, REGRESSED — first outage report | **P0.4**: "PR Gates Bypassed / AI Review Rate-Limited." CodeRabbit reported "Review rate limited" and marked passing despite performing **no review** on PRs #223/#224. Cubic pending on PR #224. **DeepSource no longer in the check suite** (removed, not just failing). SonarCloud returning 401. Combined: "3 of the 5 AI review tools are missing or bypassed on the two most complex PRs." |
| 2026-08-08 | `COMPARATIVE_ANALYSIS_2026_07_31_vs_2026_08_08.md` | Flagged as a new meta-trend | Notes this project's own `pr-review-workflow` skill weights CodeRabbit 20/100 and DeepSource 15/100 of PR confidence specifically because they catch classes qa-intel/Cubic don't — the outage costs 35/100 weighted points to tool unavailability, not code quality, and is "compounding." |

**Trend verdict: new and worsening (first flagged only in the most recent cycle, but sharply).** This is the one finding class where the *first documented instance of actual coverage loss* is 2026-08-08 itself — there was no earlier "flagged, unfixed" cycle to compare against, only an early (06-29) strategic signal that the team already distrusted these tools' reliability before any outage occurred. Treat this as a 1-data-point trend (cannot yet call it "recurring" in the same sense as Classes 1–4) but the severity (3 of 5 tools down simultaneously, on the most complex open PRs) and the fact the team's own prior instinct (06-29) anticipated exactly this failure mode make it worth tracking closely in the next audit cycle.

---

### New Class 6 — Ring/checklist "resolved" status not surviving re-verification (process-integrity finding, not a code finding)

Not in the original 5-class list, but visible across the FK timeline (Class 2) and independently confirmed in this session's own verification pass: multiple audits in the 2026-06-07 → 06-14 window marked H2 "✅ RESOLVED" based on the FK's mere *existence*, without reading the `NOT VALID` clause that made the fix incomplete. The same pattern shows up again on 2026-08-08 (P1.1/P1.2, see Class 1) where AGY's audit reported bugs that a prior same-session commit had already fixed — the audit was checked against stale code, not live code.

| Date | Instance | What went wrong |
|---|---|---|
| 2026-06-07 → 06-14 | H2 FK "RESOLVED" (3 separate documents) | Checklist-style pass-through of a prior audit's status label without re-reading the migration SQL; only the 2026-06-07 16:05 "corrected" pass and the 2026-06-29 full-spectrum audit actually read the `NOT VALID` clause and reclassified it open. |
| 2026-08-08 | P1.1/P1.2 stale-code findings | AGY-authored audit reported two bugs already fixed ~30 minutes earlier in the same session; only caught because this project's standing rule (CLAUDE.md: no agent's "verified" claim is trusted without independent re-check) triggered a same-day comparative verification pass. |

**Trend verdict: recurring, and the mitigation (independent re-verification, not trusting self-reported status) is itself the only thing that has caught it each time it occurred.** Worth naming explicitly since it's a meta-pattern that undermines confidence in *any* audit's "RESOLVED" label unless independently checked — which is exactly the caveat item 5 below restates.

---

## 3. Trend chart — finding-class × audit-date grid

Legend: `●` open/flagged this cycle · `◐` open but downgraded/partial · `✅` marked resolved this cycle (may later be reclassified) · `—` not mentioned/out of scope · `▲` regressed vs. prior cycle

| Audit date → | 06-06 | 06-07 | 06-10 | 06-14 | 06-22 | 06-29 | 07-23 | 08-08 |
|---|---|---|---|---|---|---|---|---|
| **1. Stale/non-reactive reads** | — | ● | — | — | — | — | ◐ | ▲ (2 later found stale) |
| **2. Migration NOT VALID/IF EXISTS (H2 FK)** | — | ● | ✅* | ✅* | ✅* | ● | ● | ▲ (spread to 2 new tables: P0.2, P2.13) |
| **3. Monolithic file growth (DashboardContainer)** | ● (336) | ● (route.ts/env.ts) | — | — | ◐ (566, improved from 724) | ◐ (563, −3) | ▲ (571, +8) | ▲▲ (776, +205) |
| **4. Hexagonal boundary violations** | — | ● (F2.2/F2.5) | — | — | ● (CRIT-1/HIGH-5/LOW-1) | ● (CRIT-1 latent) | ● (CRIT-1 latent) | ▲ (P2.10/P2.15, new files) |
| **5. AI-review tool coverage** | — | ✅ (working) | — | — | — | ⚠️ (strategic pivot away) | — | ▲▲ (3 of 5 tools down) |
| **6. False "RESOLVED" status (meta)** | — | ● | ● | ● | — | — | — | ● (P1.1/P1.2) |

\* Marked "✅ RESOLVED" in the checklist label at these dates, but the underlying `NOT VALID` gap was still present — see Class 2 table for why this is a "false-positive resolved" case, not a real fix, consistent with Class 6.

**Shape at a glance:** Class 2 (migration validation) and Class 3 (monolith growth) are the two lines trending strictly worse by 2026-08-08 — both show active regression/spread in the most recent cycle rather than stabilization. Class 1 and Class 4 oscillate (new instance every cycle, individual instances resolved fast) without a clear up/down slope — steady-state background noise. Class 5 is a step-function: flat/fine for ~2.5 months, then a sharp single-cycle drop.

---

## 4. Baseline as of 2026-08-08 (for future audits to measure against)

This baseline is drawn from `COMPARATIVE_ANALYSIS_2026_07_31_vs_2026_08_08.md`'s independently-verified findings, updated for two commits that landed on **2026-08-08 itself** (same day as the most recent audit, after that audit's report was generated):

| Finding class | State as of 2026-08-08 end-of-day | Source |
|---|---|---|
| **1. Stale/non-reactive reads** | P1.1 (auto-advance cascade) and P1.2 (`getState()` in `timelineEntityData` memo) — **already fixed pre-audit**, misdiagnosed by the audit as still-open. P2.1 (segment-boundary text-order bug) and P2.14 (no significance tiebreaker) — **fixed today**, commit `c11bfb90`, negative-control verified. P3.4/offset-dedup half-finish — **fixed properly today**, same commit. Remaining open: P1.10 (poll loop overwrites store mid-seek), P2.2 (stale pre-seek clock) — **not independently re-verified**, carry the audit's "still open" label as unconfirmed. | Comparative Analysis §1; commit `c11bfb90` |
| **2. Migration NOT VALID/IF EXISTS** | H2 (`users.id` FK) — **still open**, 62+ days, no owner/target date ever assigned. P0.2 (`usage_logs` CHECK constraints) — **still open**, not independently re-verified this session. P2.13 (`transcript_chapters` CHECK) — **still open**, low current risk (new/empty table). | Class 2 timeline above; Comparative Analysis §2 |
| **3. Monolithic file growth** | `DashboardContainer.tsx` at 776 lines, `dimension-remediation.ts` at 785 lines — **not touched by today's commits** (today's fixes were in `EntityMentionTimeline.tsx`/related segment-boundary logic, not these two files) — carry forward unchanged from the 08-08 audit's own measurement. | 10X_FULL_SPECTRUM_REAUDIT_2026_08_08.md P2.11/P2.16 |
| **4. Hexagonal boundary violations** | P2.10 (`relations-engine.ts` direct `fetch()`) and P2.15 (`aux-remediation.ts` direct `getSupabaseServiceClient()`) — **still open**, not independently re-verified this session; carry the audit's "still open" label as unconfirmed per the same distrust-agent-claims rule. CRIT-1 null-filter leak — status unknown post-08-08, not re-checked in either the 08-08 audit or the Comparative Analysis. | 10X_FULL_SPECTRUM_REAUDIT_2026_08_08.md |
| **5. AI-review tool coverage** | PR #225 — **closed as superseded today**, so its "must not merge" P0.3 finding is now moot. PR #224 — Cubic review status not re-checked today; CodeRabbit rate-limit and DeepSource removal not independently re-verified as resolved or still-broken. | Comparative Analysis §1, §4 |
| **6. False "RESOLVED" status (meta)** | No new instance introduced today (this session applied the negative-control-verification technique before claiming any fix, per this project's own standing lesson). | This session's own methodology |

**What changed today (2026-08-08) beyond the audit itself:** two commits — `c11bfb90` (segment-boundary/tiebreaker fixes, P2.1/P2.14, plus completing the P3.4 offset-dedup) — landed after the 08-08 audit report was written, and PR #225 was closed as superseded. Everything else in the 08-08 audit's P0/P1/P2/P3 list not named above should be treated as **unverified against current code** per the Comparative Analysis's own gap-analysis section — this document does not add new verification, only carries forward what was already confirmed.

---

## 5. Explicit caveat (per task scope)

Every status in sections 2–4 above is reported **"as stated in document X,"** not independently re-confirmed against live code by this pass — with the sole exception of the items explicitly inherited from `COMPARATIVE_ANALYSIS_2026_07_31_vs_2026_08_08.md`, which *was* a verification pass (and is cited as such throughout). Re-verifying the remaining ~24 unconfirmed 08-08 findings against current code is a separate, already-partially-done task (see that document's §4 "Gap analysis") and was explicitly out of scope here.

---

*This document supersedes no other report. It sits alongside `COMPARATIVE_ANALYSIS_2026_07_31_vs_2026_08_08.md` (2-report deep comparison + verification) as the full-history companion (51-file historical record, no new verification).*
