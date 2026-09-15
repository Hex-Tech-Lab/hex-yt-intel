# 10x Re-Audit — Lane A: Code Quality / Correctness / Duplication
Scope: `ba94b9bf..HEAD` (129 touched TS/TSX files). Skills invoked: `qa-intel --mode=full` (AST rule engine, filtered to touched files — this project's standing rule is never trust one mode alone, so full mode was run and cross-filtered to the diff rather than relying on `--mode=diff`, which returned zero files because the working tree is clean against `origin/main`), `review-delta` methodology (blast-radius reasoning applied manually since the code-review-graph MCP tools weren't available as direct tool calls in this fork), `review-duplication` methodology. REPORT ONLY, no fixes applied.

## Method note
`qa-intel --mode=diff` found nothing to scan because there's no uncommitted diff — the window's changes are already committed to `main`. Ran `--mode=full` (1,497 raw findings repo-wide) and cross-filtered to the 129 files actually touched in `ba94b9bf..HEAD`, which is the methodologically correct way to isolate "what did this window's work introduce" from full-repo baseline noise.

## Findings (touched files only): 1 critical, 2 high, 57 medium, 299 low

### CRITICAL

**1. Hardcoded owner bypass — overly broad email regex grants founder tier**
`web/lib/usecases/GetUserEntitlementsUseCase.ts:53-54`
```ts
const HARDCODED_OWNER_IDS = ['da4381c6-f774-4c99-8f04-2c1c9e27d1fb'];
const HARDCODED_OWNER_EMAIL_PATTERNS = [/kelly/i, /admin@getmytestdrive\.com/i, /admin@v-intel\.app/i, /owner@hex-tech-lab/i];
```
Introduced/touched in this window (`32175b5b`, `41101bde`, `6ed7c492` — the entitlements-hardening chain). Two separate issues, not just "hardcoded ID":
- **Correctness/security**: `/kelly/i` matches *any* email containing "kelly" anywhere — `kelly.smith@randomcompany.com`, `notkelly@evil.com`'s subdomain trick, or a future real user named Kelly all get silently granted `founder`/`is_unlimited: true`/full KG export. This isn't a "test bypass," it's a production entitlements rule matching on substring, not exact address or domain.
- **Maintainability**: this duplicates the *already-present* env-var-driven path two blocks below (`FOUNDER_USER_IDS`/`ADMIN_FOUNDER_EMAILS`) — the file has both a hardcoded bypass AND the proper registry-driven mechanism it should have used exclusively. This is the CredentialLeakRule's exact target pattern (hardcoded test/admin IDs) landing in a security-relevant billing/entitlements file, not test code.

**Failure scenario**: A user named Kelly signs up with a real personal account unrelated to the site owner → gets unlimited/founder entitlements for free, silently, with no log line (no Sentry breadcrumb on this branch). Or: the regex list is copy-pasted into a fork/staging repo and never scoped down.

**Fix direction**: delete the two hardcoded arrays; move both values into `FOUNDER_USER_IDS`/`ADMIN_FOUNDER_EMAILS` env vars (exact-match, not regex substring) that the file already reads three lines later — the registry-driven path is already correct, the hardcoded shortcut is pure redundant risk.

### HIGH

**2. Empty catch swallows auth failures**
`web/app/auth/signin/form.tsx` — 4 separate findings (1 empty catch + 3 catch-without-logging) in this file, touched this window. Sign-in failures (OAuth redirect errors, session exchange failures) can fail silently with no user feedback and no Sentry visibility — directly relevant to the vIntel rebrand's OAuth redirect-URI work referenced in `hex-yt-intel-oauth-whitelisting` skill; a redirect mismatch here would currently fail invisibly.

**3. Billing checkout route inserts without schema validation**
`web/app/api/billing/checkout/route.ts` — DB write without Zod validation before persist, in the Paddle billing chain that shipped this window (`2b5d497d` phases 1-3). This is the exact `SchemaContractRule` pattern that caught the `totalChunks` 400 cascade per this project's own rule-origins table — same class of bug, different route, in a payments-adjacent path where a malformed insert is higher-stakes than most.

## Medium-severity clusters worth flagging (not itemizing all 57)
- **"Complexity: Monolithic File"** hit 9 touched files including `worker/src/routes/analysis.ts`, `web/components/containers/DashboardContainer.tsx`, `web/hooks/useSSEStream.ts`, `web/lib/adapters/SupabaseAnalysisAdapter.ts` — several of these are exactly the hot-path files (analysis route, SSE stream, dashboard) that the highlights-reel and KG remediation chains this window kept editing. Growing complexity in files already flagged pre-existing (ComplexityRule has fired on `DashboardContainer` before per the rule-origins table) means the 500-LOC decomposition debt is compounding, not shrinking, across this window's heavy edits.
- **"Catch block without error logging"** clusters in `ChatDock.tsx`, `useSSEStream.ts`, `analysis.ts`, `GenerateExecutiveDigestUseCase.ts` — recurring pattern across exactly the surfaces (chat streaming, digest generation) this project's own incident history (Law #2, the 90s-ceiling bug) shows silent failure is costliest.
- **`worker/src/services/LLMCascade.ts`**: flagged both Monolithic-File and catch-without-logging. This is the same file the master audit's checklist cross-match (§1e.1) flags as having a hardcoded-provider-order SSOT bypass — worth a combined follow-up, not two separate tickets.

## Duplication check (review-duplication methodology)
Manually cross-referenced `GetUserEntitlementsUseCase.ts`'s hardcoded bypass against the env-var mechanism in the same file (see Critical #1) — this is the clearest duplication finding: two competing mechanisms for the same concern (owner/founder grant) coexisting, one insecure. No other clear reinvented-utility pattern surfaced in the touched-file diff within this pass's time budget; a full duplication sweep would need the codebase-investigator sub-agent pattern the skill recommends, which wasn't dispatched separately in this lane to stay within scope.

## Cross-reference with master report
The master audit (`docs/AUDIT_REPORT_2026-09-05.md`) already flagged `LLMCascade.ts` for the SSOT bypass and marked code quality "good" based on typecheck/TODO/incident-pattern checks — it did not run qa-intel's AST rules against this window's diff. This lane's finding is genuinely new: the master report's "no action needed" verdict on code quality should be narrowed — typecheck/build hygiene is fine, but a real critical-severity entitlements bug shipped in this window undetected by typecheck (it's a logic bug, not a type error).

## Summary
- **1 critical** (entitlements regex bypass — real security/business-logic bug, not noise)
- **2 high** (auth silent-fail, billing route missing validation)
- **57 medium** (complexity + observability debt concentrated in hot-path files)
- **299 low** (mostly single-letter variable names in test files — not worth itemizing, low signal)

**Top 3 issues**: (1) `GetUserEntitlementsUseCase.ts` hardcoded owner-email regex bypass — critical, fix is a 10-minute deletion since the correct mechanism already exists in the same file; (2) sign-in form silent failure paths — high, hides OAuth issues right when the repo just did an OAuth-adjacent rebrand; (3) `LLMCascade.ts` compounding complexity + catch-logging gaps on top of its already-known SSOT bypass — should be one consolidated fix, not three separate findings.
