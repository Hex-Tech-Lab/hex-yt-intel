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
