# Critical Lessons Learned

## Lesson 1: Cloudflare Naming is Fragile
**Problem**: Created 4 workers when we wanted 1
**Root Cause**: wrangler.toml [env.production] name field creates NEW worker, not updates existing
**Fix**: Remove separate name field; use parent name only
**Prevention**: Always verify Cloudflare dashboard after deploy, not just CLI output

## Lesson 2: Document All Platform References
**Problem**: Subdomain references scattered (kellybakri vs hex-tech-lab)
**Fix**: Centralize all references; grep for old values before deployment
**Tool**: grep -r "kellybakri" . --include="*.md" --include="*.json" --include="*.ts"

## Lesson 3: Trust User Domain Knowledge
**Problem**: I suggested Frankfurt (wrong); user knew submarine cables matter
**Fix**: Act as true SME; ask probing questions; defer to user expertise
**Applied**: Switched to Paris based on user's infrastructure knowledge

## Lesson 4: Verify in Actual Platform, Not CLI
**Problem**: CC said deployment succeeded; dashboard showed defaults
**Lesson**: CLI output ≠ actual live state
**Fix**: Always check Cloudflare dashboard after wrangler deploy

## Lesson 5: Memory Must Be Persisted to Disk
**Problem**: VSCode memory files not on disk; lost on context compaction
**Fix**: Create .memory/ folder with markdown files
**Tool**: Include in .gitignore if sensitive; commit if public

## Lesson 6: Sync Git ↔ Platform ↔ Code
**Problem**: wrangler.toml in Git ≠ live Cloudflare config
**Fix**: After every deployment, commit the exact live config
**Rule**: If it's in Git, it must match live; if not, document why

## Lesson 7: The Quota Fortress Pattern
**Problem**: Concurrent requests could bypass monthly quota checks if handled in stateless edge workers (a Supabase JWT proves identity but NOT remaining quota).
**Fix**: Keep quota enforcement in Vercel via the **Upstash Redis Lua atomic increment** (not Postgres) before authorizing high-cost LLM streams.
**Benefit**: Prevents "double-spend" race conditions across distributed edge nodes.

## Lesson 8: Cryptographic Isolation (S2S HMAC)
**Problem**: Saving data from the browser is unreliable; edge workers shouldn't hold DB service keys.
**Fix**: Worker signs final payload with HMAC; Vercel verifies (`verifyContentSig`) and persists using the service key (which stays on Vercel).
**Benefit**: Tamper-proof persistence + zero DB key exposure in public workers. (Caveat: a mid-stream client disconnect still loses that run — `waitUntil`'s 30s grace can't finish a ~58s generation.)

## Lesson 9: Service-Client Routes Need Their Own Ownership Check — RLS Gives Zero Protection There
**Problem**: `POST /api/chat/conversations` wrote a client-supplied `analysisId` via `getSupabaseServiceClient()` (RLS bypassed by design, needed for legitimate S2S writes) with no explicit ownership check — any user could bind a chat to another user's private analysis (IDOR).
**Fix**: Add the check in application code (`verifyOwnership({analysisId, userId})`) at the write boundary, not relying on RLS.
**Prevention rule**: Any route using the service client that accepts a client-supplied foreign-key-like ID must have an explicit, code-level ownership check — RLS is not in the request path for that client and cannot save you. This was swept for the one instance found (chat conversations); **it has not been swept repo-wide** — treat every other service-client route accepting a foreign ID as unaudited until checked.

## Lesson 10: For IDOR-Class Bugs, Fix Both the Write Boundary and the Read Boundary
**Problem**: Denying the bad write (ownership check at conversation creation) protects future state but does nothing for state that might already be wrong (pre-existing bad bindings, or a bug the write-side fix doesn't anticipate).
**Fix**: Also scope the read (`getAnalysisGrounding` by `userId`) so the read boundary independently refuses to benefit from a bad binding, even if one exists. Cheap to add, covers a different failure timeline than the write-side fix alone.
**Rule**: For any "user A can read/act on user B's resource via a supplied ID" bug, fix creation AND consumption, not just one.

## Lesson 11: A Clean Structural Fix Beats a Suppression, Even for a Heuristic False Positive
**Problem**: qa-intel flagged a HIGH ("timeout abort does not settle error state") on code that was, on inspection, actually correct (the abort was caught and handled).
**Fix**: Rewrote using `AbortSignal.timeout(ms)` instead of manual `setTimeout(() => controller.abort())` + `clearTimeout` bookkeeping — not to appease the linter, but because it is objectively simpler and structurally can't trigger that class of heuristic again.
**Rule**: When a static-analysis false positive has an available fix that is *also* a genuine simplification, take it. Reserve suppression comments for cases with no such fix.

## Lesson 12: Check `git log origin/main..origin/<designated-branch>` Before Assuming a Clean Slate
**Problem**: The harness-designated branch for a session already carried two unmerged commits for an unrelated feature (from prior work on the same branch name). Committing new unrelated work on top would have produced a mixed-concern, unreviewable PR.
**Fix**: Diffed the designated branch against `origin/main` first; found the divergence; cut a fresh dedicated branch for the new work instead, leaving the pre-existing unmerged commits exactly as found.
**Rule**: Never assume a designated/reused branch name is empty. Check ahead of first commit, every session.

## Lesson 13: OC Must Follow the 6-Section Report Template — Every Task
**Problem**: OC's PR status scrape (PR #199) reported findings as a flat table of tools and badges (CodeRabbit ✅, Cubic 💬, DeepSource Grade D) but failed every structural requirement in CLAUDE.md §2's mandatory 6-section template: no RCA (badges reported without investigation), no Contract (no stated expectation of correctness), no E2E verification (tsc --noEmit alone is not sufficient), no Skills run (qa-intel/contract-auditor/simplify were never invoked), no Tangent hunt (Cubic's 2 P2 issues were tallied as a count but their actual content — the start/end vs startTime/endTime param-name mismatch causing a genuine bug — was never read), and the wrong report format (tables instead of RCA→Contract→Fix→Tangents→Skills→Gates→Files).
**Root Cause**: OC assumed "report findings" meant a structured summary of tool outputs, not the project's mandated 6-section investigation format. The template was in CLAUDE.md but OC's context didn't include it (AGENTS.md exists, so CLAUDE.md is silently skipped by opencode's precedence rules — fixed by creating opencode.json with `instructions: ["CLAUDE.md"]`).
**Fix**: Every OC output must follow the 6-section format: RCA (separate, visible step, verified independently) → Contract → Fix → Tangents found (fixed or logged) → Skills run + findings → Gates (tsc/vitest/qa-intel/contract-auditor) → Files changed. No shortcut. Exclusion-by-silence is not acceptable — every elective skill exclusion must state which and why.
**Prevention**: The 6-section template is now in every session's context via opencode.json. Run the skill tool fresh each time to enumerate available skills — don't recall from memory. Before submitting any report, checklist-verify against the 6 sections.

## Lesson 14: Fix Tasks Must Stay Separate and Complete — Don't Bury Under Investigation
**Problem**: A prompt contained both a multi-skill investigation request and a concrete bug fix (custom time-range param mismatch + 24h clamp). The fix was correctly implemented and verified (tsc clean, 6/6 E2E tests passed, qa-intel/contract-auditor/owasp-top-10 all ran), but the fix report was merged into a broader "multi-skill investigation report" section instead of standing as its own complete 6-section output. The explicit test-coverage instruction (vitest) was dropped entirely.
**Root Cause**: When a prompt has two distinct tasks (investigate + fix), the fix must not be treated as a subsection of the investigation. The fix's 6-section report (RCA → Contract → Fix → Tangents → Skills → Gates → Files) must be a complete, standalone document, not nested inside a larger meta-report where it can be missed.
**Fix**: When a prompt contains both investigation and fix tasks, produce two separate complete reports. The fix report follows the 6-section template independently. The investigation report is supplementary. Never merge them.
**Prevention**: Before responding, scan the prompt for conjunctive task structures. If both "investigate" and "fix" are present, count it as two deliverables. Produce each as a complete, standalone output. Checklist: does the fix report have its own RCA, Contract, Fix description, Tangents, Skills run, Gates, and Files changed — or is it relying on an investigation section to cover those?

## Lesson 15: `.matchAll()` Requires Global Regex — and Test Coverage Must Be Real
**Problem**: Workstream A's entity-time-seek.ts fallback used `dimensionContent.matchAll(TIMESTAMP_RE)` where `TIMESTAMP_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/` (no `g` flag). `matchAll()` throws `TypeError` at runtime on non-global regexes — the fix would have crashed in exactly the scenario it was designed to handle (dimension-content fallback). The report also claimed "test coverage" that didn't exist.
**Root Cause**: (1) Assumed `matchAll()` works on any regex without checking the `g` flag requirement. (2) Reported "coverage added" as a gating checkbox without actually writing the test file.
**Fix**: Use `g` flag on regex when calling `.matchAll()`, or use `match()` with a global regex. Write actual tests, not just report them.
**Prevention**: Any regex used with `.matchAll()` must have the `g` flag. Test files must exist and pass before being claimed in a report. Do not check "tests added" without a real file.
