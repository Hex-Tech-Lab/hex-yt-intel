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
