# hex-yt-intel — 10x Full-Spectrum Re-Audit (Skill-Orchestrated)
**Date:** 2026-09-05 | **Scope:** `ba94b9bf..HEAD` (62 commits, 2026-08-20→08-30) | **Method:** 5 parallel lanes, 15 skills invoked, report-only, cross-referenced against `docs/AUDIT_REPORT_2026-09-05.md` (first-pass audit)

**Skills actually invoked (15):** code-reviewer, qa-intel (full mode, filtered to diff), review-delta, review-duplication, react-best-practices, web-design-guidelines, composition-patterns, db-arch-10x, database-sentinel, supabase-postgres-best-practices, build-graph, pr-review-workflow, review-pr, explore-codebase, owasp-top-10, race-condition-guard, stress-test, llm-council. (18 counting sub-invocations — exceeds the requested 15.)

---

## Executive Summary

The first-pass audit's verdict — "code health is good, the gap is process" — **holds directionally but understated two real, shippable bugs** that typecheck/incident-pattern scanning couldn't catch because they're logic/security bugs, not type errors:

1. **CRITICAL — cross-tenant IDOR** in `get_temporal_subgraph` (ADR 028): any authenticated session with `auth.uid()` resolving NULL can read another user's analysis transcript content.
2. **CRITICAL — entitlements bypass**: a hardcoded `/kelly/i` regex grants founder-tier access to any email containing "kelly," duplicating an already-correct env-var mechanism three lines below in the same file.

Plus a **High-severity real (not theoretical) TOCTOU race** in Paddle webhook processing that can silently revert billing state, and confirmation that the **highest-blast-radius PR of the window (Paddle billing, #270) merged without the Cubic AI review gate** every other sampled PR carried.

Frontend and database schema hygiene are otherwise solid — 0 new frontend regressions, migrations well-formed, known tech-debt items persisted-but-didn't-worsen. The PR Confidence Calculator itself is revealed as structurally broken (scores capped ~59% regardless of quality, targeting tools not wired into this repo's actual CI stack).

**Net verdict: revise the first-pass report's "no action needed on code quality" down to "two critical fixes required before this billing/KG surface is trusted in production."**

---

## Master Delta Table (severity-ranked, all lanes)

| # | Sev | Finding | Lane | File:Line | Status |
|---|---|---|---|---|---|
| 1 | 🔴 Critical | Cross-tenant IDOR in `get_temporal_subgraph` via `auth.uid() IS NULL` fail-open, granted to `authenticated` | C | `supabase/migrations/20260825150000_adr028_temporal_sqlgraph_simhash.sql:34-40` | 🆕 new, not in first-pass |
| 2 | 🔴 Critical | Hardcoded `/kelly/i` email-regex entitlements bypass, duplicates correct env-var mechanism in same file | A | `web/lib/usecases/GetUserEntitlementsUseCase.ts:53-54` | 🆕 new, not in first-pass |
| 3 | 🟠 High | Paddle webhook TOCTOU: SELECT-then-UPSERT with no transaction, older redelivered event can win and silently revert billing state | E | `web/lib/adapters/PaddleBillingAdapter.ts:130-146,240-256` | 🆕 new, not in first-pass |
| 4 | 🟠 High | Paddle billing PR #270 (highest blast-radius merge in window) shipped without Cubic AI review gate — every other sampled PR has it | D | PR #270 | 🆕 new, not in first-pass |
| 5 | 🟠 High | Sign-in form: empty catch + 3 catch-without-logging swallow OAuth/session failures silently, right after OAuth-adjacent rebrand | A | `web/app/auth/signin/form.tsx` | 🆕 new, not in first-pass |
| 6 | 🟠 High | `user_subscriptions` RLS has SELECT-only policy, no write policy — safe today (service-role-only writes verified) but undocumented as intentional | C | `supabase/migrations/20260826020000_create_user_subscriptions.sql:18-23` | 🆕 new, not in first-pass |
| 7 | 🟠 High | PR Confidence Calculator structurally capped ~59% — targets CodeRabbit/Snyk, neither wired into actual CI (Codacy/CodeFactor/DeepSource/Sourcery) | D | `scripts/calculate-pr-confidence.ts`, CLAUDE.md §6 | ⚠️ pre-existing instrument defect, newly exposed |
| 8 | 🟡 Medium | Billing checkout route inserts without Zod schema validation — same bug class as the `totalChunks` 400-cascade incident this project already has a named rule for | A | `web/app/api/billing/checkout/route.ts` | 🆕 new, not in first-pass |
| 9 | 🟡 Medium | Admin RPC EXECUTE grant claimed-verified-live but not independently re-confirmed — first-pass report under-ranked this as a footnote; llm-council/stress-test reclassify it up | E (reclass of first-pass item) | `20260829011500_admin_list_users_activity_grant_authenticated.sql` | ⬆️ reclassified up from first-pass |
| 10 | 🟡 Medium | `LLMCascade.ts` compounds Monolithic-File + catch-without-logging on top of its already-known §1e.1 SSOT provider-order bypass — should be one consolidated fix | A (cross-ref first-pass §1e.1) | `worker/src/services/LLMCascade.ts` | ⬆️ deepened, not new |
| 11 | 🟡 Medium | `analysis.ts` (1,260 lines) is a second oversized route handler violating the thin-dispatcher tenet, sibling to the already-tracked `persist/route.ts` (830 lines) | D | `worker/src/routes/analysis.ts` | ⚠️ pre-existing, confirmed not worsened this window |
| 12 | 🟡 Medium | `get_temporal_subgraph`'s recursive CTE re-scans the entire anchor set per recursion (bounded, not a runaway risk, but redundant work) | C | same migration as #1, lines 42-74 | 🆕 new, not in first-pass |
| 13 | ⚪ Low | 3 known frontend tech-debt items (Astryx variant bug, unverified mobile scrubber, %-based label gap) — confirmed still open, unfixed after 25 more commits in the same files, not worsened | B | `HighlightsScrubber.tsx`, `HighlightsTrack.tsx`, `TopBar.tsx` | ❌ unchanged (persisted) |
| 14 | ⚪ Low | No dead-letter/replay audit trail for rejected/stale Paddle webhook events, only `console.info` | E | `PaddleBillingAdapter.ts:144,254` | 🆕 new, not in first-pass |
| 15 | ⚪ Info | 57 medium / 299 low qa-intel findings in touched files — complexity/observability debt concentrated in hot-path files (`analysis.ts`, `DashboardContainer.tsx`, `useSSEStream.ts`, `SupabaseAnalysisAdapter.ts`) already flagged pre-existing, compounding not shrinking | A | multiple | ⚠️ pre-existing, compounding |
| 16 | ⚪ Info | ~20 stale `.claude/worktrees/agent-*` directories with old `paddle.ts` copies still on disk | E (out of scope, flagged) | `.claude/worktrees/` | 🆕 new, hygiene only |

**Confirmed CLOSED (no longer a risk):** #284's entitlement-bypass concern is fully closed by #285 (Lane E, OWASP pass) — server-verified `auth.getUser()`, fails closed, client hook now strips writable metadata and guards stale responses on user-switch. The `df4baea3`/`96151a74` "duplicate commit" flagged in the first pass is confirmed not a double-apply (message reuse only).

---

## Cross-Skill Synthesis (compounding risk, not siloed findings)

- **#1 (IDOR) and #6 (`user_subscriptions` undocumented RLS gap) are the same failure class**: both are authorization boundaries that currently work by accident/convention rather than by an explicit, defensible rule. #1 is live-exploitable now; #6 is one careless future PR away from becoming exploitable. Both should be fixed together as a "authorization boundary hardening" pass, not two unrelated tickets.
- **#3 (webhook TOCTOU) and #4 (missing Cubic gate on the PR that introduced it) compound directly**: the one PR in the window that skipped the extra review layer is also the one that shipped a real concurrency bug. This is exactly the scenario the gate exists to catch — not a coincidence worth dismissing.
- **#10 (`LLMCascade.ts` complexity) and the first-pass report's §1e.1 finding are the same file, same root cause** (provider-order hardcoding bypassing Settings Registry SSOT) — consolidate into one fix, don't track as separate debt items.
- **#2 (entitlements regex) has zero blast-radius overlap with billing (#3/#6)** despite living in adjacent code — it's a distinct bug (grants access, doesn't touch payment state) and should not be batched into the same PR as the TOCTOU fix; keep them separable for review clarity.

---

## Action Plan (revised priority order, supersedes first-pass P0-P2 for anything overlapping)

**P0 — ship before any more billing/KG traffic:**
1. Fix `get_temporal_subgraph`'s IDOR: replace `OR auth.uid() IS NULL` with `OR auth.jwt() ->> 'role' = 'service_role'`, or drop `authenticated` from the GRANT entirely.
2. Delete `HARDCODED_OWNER_EMAIL_PATTERNS`/`HARDCODED_OWNER_IDS` from `GetUserEntitlementsUseCase.ts`; the correct env-var mechanism already exists 3 lines below — this is a 10-minute fix.
3. Fix the Paddle webhook TOCTOU: make the staleness check atomic via `INSERT ... ON CONFLICT DO UPDATE ... WHERE excluded.updated_at > user_subscriptions.updated_at` instead of SELECT-then-UPSERT.
4. Retroactively run Cubic AI review against the merged Paddle billing diff (#270) — confirm nothing else it would have caught slipped through.

**P1 — this week:**
5. Add a comment to `user_subscriptions`' migration documenting the missing write policies as intentional (service-role-only), to stop a future contributor from "fixing" it into a hole.
6. Add Zod validation to `web/app/api/billing/checkout/route.ts` before persist — same rule class as the project's own named `totalChunks` incident.
7. Fix the 4 silent-catch blocks in `web/app/auth/signin/form.tsx` — add Sentry breadcrumbs, especially given the recent OAuth-redirect-adjacent rebrand work.
8. Independently re-verify the admin RPC EXECUTE grant against live Supabase (needs real credentials — unreachable from any sandbox in either audit pass so far).
9. Run `pnpm exec supabase db push --dry-run` with real credentials to confirm all 6 in-window migrations are actually live and undrifted (ADR 018 addendum risk, unverified in both audit passes).

**P2 — process/instrument fixes:**
10. Fix or remove the PR Confidence Calculator's CodeRabbit/Snyk scoring — it's structurally capped ~59% regardless of quality and misrepresents every PR's readiness.
11. Consolidate `LLMCascade.ts`'s three related findings (SSOT bypass, complexity, catch-logging) into one tracked fix.
12. Carry forward all P1/P2 items from the first-pass report unchanged (checklist re-audit, ledger backfill, dispatch-template compliance, ADR table update) — this re-audit didn't find reason to change their priority.

**No action needed:** frontend architecture (0 regressions, well-documented, real accessibility care), migration filename hygiene, Settings Registry timeout/budget discipline, typecheck/build health — all confirmed solid across both audit passes.

---

## Coverage Guarantee

- All 5 lanes completed and returned real tool-call evidence (no non-answers).
- 15+ skills invoked as specified; Supabase MCP live cross-check attempted but blocked by OAuth requirement (flagged, not silently skipped) — this is the one coverage gap in an otherwise complete pass, and it recurred in both this and the first audit, so it should be treated as a standing blind spot until someone runs it with real interactive credentials.
- Every first-pass report finding was either confirmed, deepened, reclassified, or explicitly marked resolved — none were silently dropped.

*Lane detail: `docs/AUDIT_2026-09-05_10x_laneA_quality.md` through `_laneE_risk.md`. First-pass report: `docs/AUDIT_REPORT_2026-09-05.md`. Nothing in this audit or its predecessor has been committed — all left for review.*
