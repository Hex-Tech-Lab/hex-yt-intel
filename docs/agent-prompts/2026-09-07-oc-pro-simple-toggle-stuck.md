# Agent Dispatch Prompt — Pro/Simple UI toggle appears stuck on Simple

**Target Agent**: OC (OpenCode, glm-5.3-flash)
**Effort Level**: low

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

---

## 1. Context & Problem Statement

Live user report (2026-09-07, screenshot confirmed the toggle shows both
"Simple" and "Pro" options but clicking "Pro" has no effect — the view stays
on Simple). This is on a paid/Enterprise Tier account (per screenshot,
"kellybakri / Enterprise Tier"), so this is NOT expected entitlement-gating
behavior for this user — Pro should be accessible.

Root cause, already confirmed via code investigation this session:

- `web/components/templates/console/ViewModeToggle.tsx:10-20`:
  ```tsx
  const { effectiveViewMode: viewMode, setViewMode, canAccessPro, isLoading } = useEffectiveViewMode();
  const handleToggle = (mode: ConsoleViewMode) => {
    if (mode === "pro" && !canAccessPro && !isLoading) { setPricingModalOpen(true); return; }
    setViewMode(mode);
  };
  ```
  The toggle's displayed/active state is bound to `effectiveViewMode`, not
  the raw persisted store value.

- `web/lib/hooks/useEffectiveViewMode.ts:13-16`:
  ```ts
  const canAccessPro = !isLoading && Boolean(entitlements?.canAccessKnowledgeGraph);
  const effectiveViewMode: ConsoleViewMode = !canAccessPro ? "simple" : viewMode;
  ```
  `setViewMode("pro")` correctly writes `"pro"` into the persisted Zustand
  store (`web/lib/stores/useConsoleViewStore.ts:15`), but the UI reads back
  `effectiveViewMode`, which is hard-clamped to `"simple"` whenever
  `canAccessPro` is false.

- `web/lib/hooks/useEntitlements.ts:16,29` defaults
  `canAccessKnowledgeGraph: false` and `isLoading: true` on every mount/user
  change. So: any user for whom entitlements are still loading, fail to
  fetch, or genuinely lack the flag will see the toggle visually flip on
  click but the view (and toggle) snap right back to Simple —
  indistinguishable from the click doing nothing.

The likely real bug is one of:
(a) `canAccessKnowledgeGraph` is not actually true for this Enterprise-tier
    user's real entitlements row (a billing/entitlements data bug, separate
    from this toggle's own logic), or
(b) entitlements never resolve (`isLoading` stays true, or the fetch fails
    silently) so `canAccessPro` never becomes true even though it should.

## 2. Contract & Implementation Directives

**Contract**: for a user whose real entitlements include
`canAccessKnowledgeGraph: true`, clicking "Pro" in `ViewModeToggle` must
result in `effectiveViewMode === "pro"` and the Pro dashboard actually
rendering. For a user who genuinely lacks that entitlement, clicking "Pro"
must show the pricing modal (this path already works, per the `handleToggle`
code above) — do not break that.

**Implementation approach**:
1. First, determine WHICH of (a)/(b) above is actually happening for a real
   Enterprise-tier account. Do this by:
   - Reading `useEntitlements.ts` in full: where does it fetch entitlements
     from (`/api/billing/entitlements`, per the network log)? Trace that
     API route's handler and confirm what it returns for an Enterprise-tier
     user — does the route's response actually set
     `canAccessKnowledgeGraph: true` for Enterprise tier, or is there a
     tier-name mismatch / missing case in whatever maps billing tier →
     entitlement flags?
   - Check whether `isLoading` ever resolves to `false` — is there a race
     where `useEffectiveViewMode` reads `entitlements` before the fetch
     promise resolves, and then never re-renders once it does (a missing
     dependency in a `useEffect`/`useMemo`, or a stale closure)?
2. Do NOT weaken the entitlement gate itself (do not just hardcode Pro
   access) — fix the actual data/timing bug so the gate correctly reflects
   real entitlements.
3. Add a regression test: mock `useEntitlements` to return
   `canAccessKnowledgeGraph: true, isLoading: false` and assert
   `useEffectiveViewMode()` returns `effectiveViewMode: "pro"` after
   `setViewMode("pro")` is called. Check for an existing test file near
   `useEffectiveViewMode.ts` or `ViewModeToggle.tsx` and extend it rather
   than creating a parallel one.
4. If the root cause turns out to be a genuine entitlements-data bug (case a)
   rather than a timing/race bug (case b), do NOT attempt a database/billing
   fix yourself — stop, document the exact broken mapping you found (e.g.
   "tier X does not set flag Y in file Z, line N"), and report it as a
   BLOCKED/NEEDS-DECISION item instead of guessing at the billing logic.

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

This touches `web/components/**` and `web/lib/hooks/**` (and possibly
`web/app/api/billing/**` if root cause is (a)) — run: `qa-intel` (both
`--mode diff` and `--mode full`), `code-reviewer`, `simplify`,
`review-delta`, `review-duplication`, `contract-auditor`,
`react-best-practices`. If the investigation leads into
`web/app/api/billing/**`, ALSO run `owasp-top-10` and `race-condition-guard`
per the Security/Billing row of the decision tree — re-check this the moment
the touched-file set grows into that area, don't decide once at dispatch.

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```
Run every command's exit code directly (redirect to a file, `echo "EXIT: $?"`
with NO pipe in between) — never trust `$?` after piping through `tail`/
`grep`/`head`.

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Do NOT open a PR or push — commit locally on a new branch
`fix/pro-simple-toggle-stuck` (or, if BLOCKED on a billing-data root cause,
skip the branch and just report findings) and report back for review before
anything is pushed.
