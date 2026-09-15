# Audit Part 3 — CI/PR Health, Tech-Debt Ledger, Agent-Prompt Coverage

Scope: last ~10 days (2026-08-26 → 2026-09-05). Read-only.

## CI Health

`gh run list --limit 40` shows the repo has been consistently green on `main`. Only two anomalies in the full window:

- **33282110505** (`CI/CD Pipeline`, 2026-08-29T23:55:41Z, commit "feat(highlights): add red playhead needle...") — **failure**. Root cause: `react/no-unescaped-entities` lint violation. Fixed 4 minutes later by commit "fix(lint): escape verbatim caption quotes..." (33282225996, run **cancelled**, superseded), then properly fixed by "fix(lint): remove unescaped quotes..." (33282388494 — **success**). Net: caught and resolved same-night, no bad state reached `main` for long, but it took 3 pushes to actually fix (first fix attempt itself got cancelled/respun) — indicates the lint-escaping fix wasn't verified locally before pushing twice in a row.
- No other red runs in the 40-run window. `CodeQL`, `OSSAR`, `Deploy Worker` all consistently green.

## PR Health

`gh pr list --state all --limit 40` (covers #246–#285, spanning 2026-08-20 through 2026-08-27, i.e. this listing's most-recent 40 rows only reach back to 08-26/27 — most recent work past that date is on `main` directly per the CI log above, not via PR):

- Merged: the large majority (≈34/40).
- **CLOSED without merge** (5): #284 (billing upgrade modal positioning/entitlement bypass), #282 (ssot takeaway linkage), #278 (contract boundaries — superseded by #280 "complete contract hardening"), #267 (highlights/digest consistency — superseded by #268 "v2"). Pattern: each closed PR was superseded by an immediate follow-up PR that landed the real fix (282→ merged via later work, 278→280, 267→268), so these read as abandoned-in-favor-of-a-redo rather than dropped work — but confirm #284's entitlement-bypass concern actually got re-addressed somewhere, since I didn't find an obvious successor PR title for it in this window (#285 "enforce server-authoritative auth + prompt 0-based linkage" is the closest candidate and likely is the successor, given timing 1.5h later).
- **Duplicate PR pair**: #273 and #274 have the identical title ("fix(graph): harden entity frequency accumulation, wordcloud data flow...") and both MERGED 10 minutes apart — worth confirming with git log that #273 wasn't redundantly merged (possible double-merge / branch confusion, flagged for the commit-inventory fork to verify against actual commit hashes).
- No stale open PRs as of this listing — everything in the 40-row window is resolved (merged or closed).

## Tech-Debt Ledger (`docs/TECH_DEBT_LEDGER.md`)

18 total entries, most recent five all dated **2026-08-20/21** — nothing logged 2026-08-22 through 2026-09-05, despite the CI log showing active work continued through at least 08-30. This is either (a) a genuine quiet period for deferred-debt-worthy findings, or (b) a **process gap**: the mandatory-skill-stack memory requires findings to be logged as they happen, and 10 days of subsequent work (see part 1/4 commit inventory) produced zero new entries. Given the volume of merged PRs after 08-21 (paddle billing, ADR-028 temporal graph, KG simple/pro view, entitlements security fix, worker tsconfig realignment), zero debt items is suspicious — flag for the risk-scan fork to sanity-check whether any of that work actually had deferred findings that went unlogged.

Open items still outstanding from 08-20/21 (not resolved since):
1. Highlights-reel scrubber mobile/narrow-viewport (375/390px) never live-verified.
2. HighlightsTrack percentage-based label-collision gap (worse on mobile).
3. Astryx `variant="primary"` renders white instead of cyan, app-wide pre-existing bug.
4. Open-redirect guard theoretical backslash-normalization bypass (low urgency, pre-existing).
5. Rebrand text/copy vs. infra split (emails, DMCA registration, README) — explicitly deferred, not yet closed.

## Ruleset Lessons Ledger (`docs/qa-intel/RULESET_LESSONS_LEDGER.md`)

Last entry: 2026-08-20 (string-truncation-ellipsis rule gap). Nothing logged since — same gap pattern as tech-debt ledger above.

## Agent-Prompt Dispatch Coverage

`docs/agent-prompts/` has only 2 entries after 2026-08-21: `2026-08-27-AGY2-fix-qa-intel-warnings.md` and `2026-08-27-agy1-adversarial-verify-pr281.md`. Nothing between 08-22–08-26 or after 08-27, yet PRs #260–285 (dated 08-20 through 08-27) and CI activity through 08-30 show substantial work landing without a corresponding filed prompt — **template-mandatory-dispatch compliance broke down** for most of this window's work (either work was done directly by CC without the template — acceptable per the template's own scope of "AGY/OC/remote/self-dispatch" — or dispatches happened without filing the required prompt doc, which would be a repeat of the exact incident that made the template mandatory in the first place on 2026-08-06).

## Summary

- CI: 1 real failure in the window, self-resolved same night in 3 pushes (should've been 1).
- PRs: ~34 merged, 5 closed-unmerged (all apparently superseded), 1 suspicious duplicate-title pair (#273/#274) needing commit-level verification.
- Tech-debt & ruleset ledgers: **silent since 2026-08-21** despite continued heavy shipping through 08-30 — process-compliance gap, not necessarily a code-quality gap, but unverifiable without deeper review.
- Agent-prompt template compliance: **broke down** after 08-27 — no filed prompts for whatever produced the 08-28/08-29/08-30 commits.
