---
Filename: $file
Location: docs/specs/$file
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:11:06 EEST
Purpose: Architectural specification document
---
Filename: AUTONOMY_SPEC.md
Location: /docs/specs/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: AUTONOMY SPEC
---

# Autonomous System — Chunks 9-12 Review Loop Spec
## Created: 2026-05-16 | Target: All four chunks run-to-completion

---

## System Contract (The Rules)

Every **15 minutes** (set via external timer: `sleep 900` in a background bash job), the loop below runs.

### What the Loop Checks (in order)

```
tick()
  ├─ 1. CHANGES: git log --since="15 minutes ago" --oneline
  │     → What changed in each worktree? Any new commits?
  │
  ├─ 2. TYPE-CHECK: pnpm type-check (in each worktree with new commits)
  │     → If 0 errors → GREEN; if errors → WRITE fixes or mark BLOCKED
  │
  ├─ 3. BUILD: pnpm build
  │     → If SUCCESS → proceed; if FAIL → mark BLOCKED
  │
  ├─ 4. PR STATUS: gh pr view <N> --json mergeStateStatus,statusCheckRollup
  │     → CLEAN + all green → APPROVE for merge
  │     → FAILED check → log error, wait for next tick if fix in progress
  │
  ├─ 5. DOC UPDATE: If PR merged → update MEMORY.md + CLAUDE.md + handover doc
  │
  └─ 6. SLEEP 900 seconds, then loop again
```

### Agent Completion Signals

Each agent writes a `CHUNK{N}_COMPLETE.md` in its worktree root when done.  
The loop looks for completion files to gate PR creation:

```
GATE: CHUNK9_COMPLETE.md exists → can open PR for pr9
GATE: CHUNK10_COMPLETE.md exists → can open PR for pr10
GATE: CHUNK11_COMPLETE.md exists → can open PR for pr11
GATE: CHUNK12_COMPLETE.md exists → verification report ready (no code merge)
```

### Completed Chunks Gate

| Chunk | Completion Signal | Branch | PR Number |
|-------|-------------------|--------|-----------|
| 8+ (existing) | pr8f-ui-navigation-updates already merged | ✅ DONE | PR #12 merged |
| 9 | `CHUNK9_COMPLETE.md` | pr9-chunk9-pdf-share | → create |
| 10 | `CHUNK10_COMPLETE.md` | pr10-stripe-integration | → create |
| 11 | `CHUNK11_COMPLETE.md` | pr11-queue-cache-tests | → create |
| 12 | `CHUNK12_COMPLETE.md` | pr12-vercel-deploy | → review only (no PR) |

---

## Phase 0 Pre-work (Already Done)

These tasks have been cleared before spawning the autonomous agents:

- [x] Read `docs/IMPLEMENTATION_PLAN_v2.0_FINAL.md` for chunk scope  
- [x] Confirm branch status: `pr10-rate-limiting` exists (2 commits ahead of main, same content as pr9 main work)  
- [x] Confirm `CHUNK9/10/11/12_COMPLETE.md` do NOT exist yet (agents haven't finished)  
- [x] Agent Manager spawned 4 worktrees concurrently  
- [x] PR #13 (pr9-billing-rate-limit) created, reviewed, merged to main  

---

## Chunk Scope (Agent Prompts Summary)

### Chunk 9 — PDF Export + Share (`pr9-chunk9-pdf-share`)
- **Files to create**: `web/app/api/export/pdf/route.ts`, `web/lib/export/MarkdownToPdf.ts`, `CHUNK9_COMPLETE.md`
- **Wire**: Download buttons in `page.tsx` replace `'Coming soon'` toast handlers  
- **Route deps**: `/api/export/markdown` (text/md), `/api/export/pdf` (application/pdf)
- **Optional**: Add `CHUNK9_COMPLETE.md` when done with status flags.

### Chunk 10 — Stripe Integration (`pr10-stripe-integration`)
- **Files to create**: `web/app/api/webhooks/stripe/route.ts`, `app/pricing/page.tsx` enhancements, `CHUNK10_COMPLETE.md`
- **Update**: `web/app/api/analyses/route.ts` add quota enforcement  
- **Env vars required**: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PRICING_TABLE_ID`, `NEXT_PUBLIC_STRIPE_WEBHOOK_SECRET`
- **Track**: Usage via `incrementQuotaCounter` + `checkQuota` from `@/lib/rate-limit`

### Chunk 11 — Rate-limit Integration + Tests (`pr11-queue-cache-tests`)
- **Files to create**: `web/app/api/rate-limit-status/route.ts`, tests in `web/tests/`
- **Integrate**: `applyRateLimit` from `@/lib/rate-limit` into `analyses/route.ts` and `analyses/search/route.ts`
- **Pattern**: `getUserTier` + `applyRateLimit` → return 429/403 as needed

### Chunk 12 — Deploy Verification (`pr12-vercel-deploy`)
- **No code changes** (read-only)  
- **Audit**: Vercel env vars, Redis status, all routes accessible  
- **Report to**: `CHUNK12_COMPLETE.md`  
- **If bugs found**: create `pr12-deploy-fixes` branch with patches

---

## Known Issues (Agents Must Fix Before Closing)

| ID | Severity | Description | In Chunk |
|----|----------|-------------|----------|
| A | HIGH | `rate-limit.ts` not imported in `analyses/route.ts` — no real enforcement, just lib | Chunk 11 |
| B | HIGH | PDF export route missing — download button shows 'Coming soon' toast | Chunk 9 |
| C | MEDIUM | Stripe webhook route absent → subscription events silently ignored | Chunk 10 |
| D | MEDIUM | Quota enforcement not wired — `checkQuota` not called in INSERT path | Chunk 10/11 |
| E | MEDIUM | Redis async functions in `rate-limit.ts` await without try/catch per call | Chunk 11 |
| F | MEDIUM | `CHUNK9/10/11/12_COMPLETE.md` files don't exist yet | All |
| G | LOW | `CLAUDE.md` stale paths (hex-yt-intel-key.json) — noted but out of scope | Doc |

---

## Review Loop Script (bash)

```bash
#!/usr/bin/env bash
# review-loop.sh — run every 15 minutes via cron / systemd timer / background job

REPO="/home/kellyb_dev/projects/hex-yt-intel"
INTERVAL=900  # 15 minutes

log() { echo "[$(date -Iseconds)] $*"; }

while true; do
  log "=== TICK START ==="

  for branch in pr9-chunk9-pdf-share pr10-stripe-integration pr11-queue-cache-tests pr12-vercel-deploy; do
    log "--- $branch ---"

    # 1. Changes
    cd "$REPO" && git checkout "$branch" 2>/dev/null && \
      commits=$(git log --oneline --since="15 minutes ago" | wc -l) && \
      log "  [1] New commits (15 min): $commits"

    # 2. Pre-gate: Completion file
    if [ -f "$REPO/CHUNK${branch#pr[0-9]}_COMPLETE.md" ]; then
      log "  [0] Complete file found — proceed to PR creation"
      # 3. Type-check + Build + Lint (same as Phase 1)
      # 4. PR creation commands go here
    fi
  done

  log "=== TICK END — sleeping $INTERVAL seconds ==="
  sleep $INTERVAL
done
```

> **Start**: Run `review-loop.sh` manual stage before you exit the session.  
> **When loop is run**: it replaces any stale or pending items from the main branch; and updates `rw/RESUMING.md` and `docs/HANDOVER.md` with a 15-minute cadence.  
> **If items remain pending**: write a `*.sha` file into the original branch to continue from the status quo when the loop resets.

---

## Review Quality Checklist (45 seconds per ticket)

When a chunk completes, run these checks locally before opening a PR:

```
pnpm type-check        # Must be 0 errors
pnpm build             # Must be SUCCESS
pnpm lint              # Must be clean or only warnings
git status             # Clean, zero untracked junk
git diff origin/main   # All expected diffs present, nothing unwanted
```

Open PR only if BOTH build gates pass. If a gate fails → add `CHUNK{N}_BLOCKED.md` with error diff + next action.

---

## Agent Output Contract (Enforced)

Every `CHUNK{N}_COMPLETE.md` must contain:

```markdown
---
name: chunk_{N}_complete
status: complete | blocked
chunk: 9 | 10 | 11 | 12
---

## Commits
- `<sha>` <subject>

## Files Changed
- `path/to/file` — <what changed>

## Gates
- [x] pnpm type-check = 0 errors
- [x] pnpm build = SUCCESS
- [x] pnpm lint = CLEAN

## Blockers (if any)
- <description> | <resolution needed>

## Quotas
- Free tier: X req/min enforced? Y/N
- Pro tier: X req/min enforced? Y/N
- Redis: available? Y/N

## Next Action
- Open PR →DONE
- Pending review →YES/NO
- Monitored →YES/NO
```

---

## Reviewer Sign-Off Before Merge to main

Before `gh pr merge` is called, confirm:

1. ✅ All 3 gates pass in CI (GitHub Actions + Vercel)
2. ✅ Vercel preview deployment is READY (not building, not error)
3. ✅ Runtime logs: 0 ERROR entries in last 50 lines
4. ✅ `CHUNK{N}_COMPLETE.md` present with all gates checked off
5. ✅ No unexpected diffs (diff against main shows only intended files)

If any check fails → write `CHUNK{N}_BLOCKED.md` and wait for next tick.
