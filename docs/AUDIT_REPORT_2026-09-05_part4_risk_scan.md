# Audit Part 4 — Code Risk Scan (window: last ~30 commits, dbb84a44..HEAD)

## Typecheck / Build
- `pnpm --filter web type-check` (`tsc --noEmit`): **PASS**, 0 errors.
- `worker` `pnpm run typecheck` (`tsc --noEmit -p tsconfig.typecheck.json`): **PASS**, 0 errors.

## New TODO/FIXME/XXX/HACK markers
- **0** introduced in this window (`git log -30 -p -- worker/ web/` scanned for added `+` lines matching those tokens).

## Known-incident pattern regression checks

### Law #2 stratified timeouts
No regression — commits in-window actively *moved timeouts into the Settings Registry* rather than hardcoding them:
- `6c6236dd` fix(worker): move LLM cascade timeouts to settings registry, fix false 90s CF ceiling, un-suppress Sentry on abort/timeout
- `e52211e5` fix(config): move channel-meta timeout/size-cap into settings registry
- `54bfa6ff` feat(settings): comments-fetch config driven by registry + known count, not a hardcoded timeout
- `a234d11a` fix(worker): fallback LLMCascade handshake timeout to registry default
This is the correct direction (undoing the exact class of bug Law #2 documents). No new hardcoded ms literal found near "timeout" in touched files.

### ADR 018 migration filename drift
All migrations in `supabase/migrations/` from this window (20260813222120 through 20260829011500) have well-formed 14-digit timestamp prefixes, monotonically increasing, no duplicates. No local Supabase MCP access in this session to cross-check against `list_migrations` server-side — **flag for the user to run `pnpm exec supabase db push --dry-run` before next migration work**, per the ADR 018 addendum's raw-Management-API drift risk (which is invisible from local files alone).

### ADR 019 budget tunables
No hardcoded numeric constants found near budget/cap/limit in the diffed files beyond what's already registry-backed. The `82fc8732` fix below actually *removes* a magic-number risk (unbounded budget) rather than adding one.

## Deep-dive: commit 82fc8732 ("harden AudioContext singleton, clamp short-form budget...")
Real, non-band-aid fixes, both narrowly scoped:
1. **AudioContext singleton** (`HighlightsTransitionOverlay.tsx`): previously created a *new* `AudioContext` on every `playSwoosh()` call and closed it after 0.7s via `setTimeout` — repeated rapid triggers (fast highlight scrubbing) could exhaust the browser's limited AudioContext pool (Chrome/Safari cap concurrent contexts, historically ~6). Fix switches to a module-level shared context, reused/resumed rather than recreated, with `console.debug` (not throw) on failure paths. Correct fix for a real resource-exhaustion class of bug, not a workaround.
2. **Budget clamp** (`highlights-settings.ts`): `calculateEffectiveHighlightBudget` could return `Math.max(base, minRequired, ideal)` exceeding actual video duration for short-form video with many takeaways (e.g., 8 takeaways × 15s floor = 120s budget on a 90s video). One-line `Math.min(raw, videoDurationSeconds)` clamp — correct, minimal, addresses root cause.

**Tests added are real, not superficial**: `highlights-budget-boundary.test.ts` specifically asserts the clamp behavior at the boundary (90s video / 8 takeaways → budget ≤ 90, exactly 90), plus a floor case and a long-form scaling case. `fetchSentryLogs.test.ts` exercises the 401/403 fail-soft path (added in the same prelaunch-gap-audit track) and the 503-on-missing-token path — genuinely covers the described bug, not just a smoke test.

## Other risk observations
- Ledger entry (`.memory/AGENT_LEDGER.md`, same commit) shows a **cancelled/superseded** OC entry from 2026-08-21 (`fix/highlights-chat-digest-consistency` 18-step dispatch) — the branch itself is not visible in this scan's range; if that branch still exists unmerged, it may be stale/conflicting work sitting in the repo. Worth a `git branch -a` check by whichever fork owns ledger/branch inventory.
- No single commit in the 30-commit window stands out as unusually large/risky by stat count — most are tightly scoped (3–6 files). `0432904f` ("strict 1:1 takeaway-highlight DAG, 44px scrubber targets, admin RPC grants, sentry fail-soft") bundles several unrelated concerns (DAG logic + touch targets + RPC grants + Sentry) into one commit — not a correctness risk found, but a code-hygiene/reviewability note.
- Migration `20260829011500_admin_list_users_activity_grant_authenticated.sql` touches `EXECUTE` grants on an admin RPC — ledger entry claims this was verified live via Management API (authenticated+service_role+postgres EXECUTE confirmed) — could not independently re-verify from this sandbox (no live DB access), flagging as **claimed-but-not-independently-reverified** per the CC verification standard in CLAUDE.md's agent roster section.

## Summary verdict
No regressions of the three named incident classes found. Both typecheck gates clean. Zero new debt markers. The one deep-dived commit (82fc8732) is a genuine, well-tested fix, not a band-aid. Residual risk is procedural (unverified live-DB claims, a possible stale branch) rather than code-quality.
