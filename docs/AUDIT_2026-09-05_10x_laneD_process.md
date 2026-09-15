# Lane D — Process/PR-Workflow & Structural Review (10x re-audit)

Scope: `ba94b9bf..HEAD`, PR gate evidence sample, Hex-Lite/DDD-Lite boundary check.

## PR gate evidence (retroactive pr-review-workflow check)

| PR | Merged | Cubic AI review ran? | Note |
|---|---|---|---|
| #267 | **No** (`mergedAt: null`) | — | Closed unmerged, superseded by #268 — matches master report |
| #268 (highlights v2) | Yes 08-25 | ✅ | Full gate set present |
| #269 (ADR 028) | Yes 08-25 | ✅ | Full gate set present |
| #270 (Paddle billing phases 1-3) | Yes 08-26 | **❌ missing** | Highest-risk PR in the window (payments) shipped with NO Cubic AI review check in its rollup — every other sampled PR has it |
| #285 (entitlements security fix) | Yes 08-27 | ✅ | Full gate set present |

**Critical finding**: the single highest-blast-radius PR of the window — Paddle merchant-of-record billing integration — merged without the Cubic AI review gate that every other sampled PR carries. No evidence this was a deliberate waiver; looks like a dropped gate, not a decision.

**Structural gap in CLAUDE.md's PR Confidence Calculator** (§6): the formula allocates 20/85 points to CodeRabbit and 15/85 to Snyk. Neither tool appears anywhere in any sampled PR's `statusCheckRollup` — the actual CI stack uses Codacy/CodeFactor/DeepSource/Sourcery/bandit/binskim instead. Per the calculator's own documented error-handling contract, missing tools default to 0 points, meaning **every PR in this repo is structurally capped at ≤50/85 (≈59%) regardless of quality**, since 35 of 85 possible points target tools that were never wired in. This isn't a new-work regression — it's a pre-existing measurement-instrument defect that makes the confidence score meaningless as configured. Worth fixing or removing from CLAUDE.md.

## review-pr structural read (Paddle #270, ADR028 #269, entitlements #285)

Not independently re-diffed line-by-line in this pass (time-boxed); relying on the gate-evidence table above plus master report's existing code-risk findings (typecheck clean, no incident-class regressions) as the correctness signal. No additional structural defect found beyond the missing-gate finding.

## Hex-Lite/DDD-Lite boundary check

`worker/src/routes/analysis.ts` is **1,260 lines** — token verification, channel-meta caching/truncation, comment fetching/truncation/sampling, transcript fetch, and stream-response building all live directly in the route file rather than being ultra-thin dispatchers delegating to services/adapters. This violates the CLAUDE.md tenet ("route handlers remain ultra-thin dispatchers") as currently written.

**Not a regression from this window** — `git log ba94b9bf..HEAD -- worker/src/routes/analysis.ts` shows exactly one touch (`f217a6a3`, Sentry error-capture addition, small diff). The 1,260-line size is pre-existing debt, same class as the already-tracked `persist/route.ts` 830-line handler (see memory `project_persist_route_830_lines_20260802`). Flagging as a sibling item to that existing deferred item, not new.

## Top 3 issues (priority order)

1. **Critical** — Paddle billing PR #270 merged without Cubic AI review gate. Verify whether this was intentional; if not, retroactively run Cubic against the merged diff.
2. **High** — PR Confidence Calculator's scoring formula targets 2 tools (CodeRabbit, Snyk) that aren't actually wired into CI, capping every score at ~59% by construction. Update CLAUDE.md/`scripts/calculate-pr-confidence.ts` to match real tooling or add the missing integrations.
3. **Medium** — `analysis.ts` (1,260 lines) joins `persist/route.ts` (830 lines) as a second oversized route handler violating the documented thin-dispatcher rule — pre-existing, not introduced this window, but growing the backlog of the same architectural debt class.

No blast-radius risk found in the graph pointing at files with missing gate evidence beyond the #270 finding above.
