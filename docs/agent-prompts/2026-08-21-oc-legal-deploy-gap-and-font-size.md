# Agent Dispatch Prompt — OC (opencode, glm-5.2:free, low effort) — Legal Pages: Missing Deployment + Font-Size Inconsistency

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

## Note: this is a re-dispatch (prior run was killed mid-task for an unrelated reason, no work was lost — it made zero commits). One tooling fact already discovered, don't rediscover it: `require('playwright')` does NOT resolve in this pnpm workspace from a plain `node -e` script — only `@playwright/test`'s named export works: `const { chromium } = require('@playwright/test'); const browser = await chromium.launch();`. Use that import path directly for any live-browser measurement script.

## 1. Context

hex-yt-intel / vIntel. Tonight's session fixed real content/spacing bugs in
three legal docs (`docs/legal/privacy-policy.md`, `sub-processors.md`,
`terms-of-service.md`) and their shared renderer
(`web/components/templates/LegalPage.tsx`), across 3 commits on `main`:
`a8b55056`, `515c186c` (unrelated highlights-reel fix, same push train),
`c2906ab8` (the terms-of-service content fix — "Firewall" rename + clause
2.1-2.4 paragraph spacing).

**Confirmed real bug (already root-caused by CC this session, verify
independently, don't re-derive from scratch)**: `c2906ab8` never triggered a
Vercel deployment. Proof already gathered:
- `gh api repos/Hex-Tech-Lab/hex-yt-intel/deployments` shows deployment
  records for `515c186c` and `a8b55056` (and everything before), but **none**
  for `c2906ab8` — confirmed via direct GitHub API call, not Vercel's own
  dashboard alone.
- Live production (`https://hex-yt-intel.vercel.app/terms-and-conditions`,
  also mirrored on `v-intel.getmytestdrive.com`/`yt-intel.getmytestdrive.com`)
  is still serving the OLD terms-of-service content (old "Necessary Rights
  Firewall" heading, clauses 2.1-2.4 collapsed into one dense paragraph,
  "Last Updated: June 9, 2026") — confirmed via live Playwright screenshot,
  not just curl.
- This is the SECOND time in this repo's history a legal-doc fix silently
  failed to reach production — an earlier commit `65557079` ("force-apply
  visual spacing," from a previous session) also never visibly landed.

**Second, separate, unconfirmed report**: the user says Terms of Service's
body text font size looks correct, but Privacy Policy and/or Sub-processors
look smaller. CC did one partial live measurement before handing off: on
`privacy-policy`, `.legal-p`'s computed `font-size` is `16px`. CC did NOT yet
measure the same on `terms-and-conditions` or `sub-processors` before this
handoff — you need to do that measurement yourself, on all three pages, with
real `getComputedStyle` calls (not assumption), before concluding whether
there's a real difference or the user's perception is being driven by
something else (e.g. `sub-processors`' tables intentionally use a smaller
13px font per `LegalPage.tsx`'s own CSS — that could be what's actually being
perceived, not a bug).

## 2. Task

**Part A — Get the missing deployment live.**
1. Confirm current state: `git log --oneline origin/main -3` and
   `gh api repos/Hex-Tech-Lab/hex-yt-intel/deployments --jq '.[0:3]'` to
   reconfirm the gap still exists (don't assume it's still true minutes
   later — re-check).
2. The safe fix is a real, additional commit that touches the repo (an empty
   commit is NOT an option — this project's git-safety norms disfavor
   no-op commits; instead, bundle it with Part B's real fix below, so the
   push has real content and naturally re-triggers the GitHub→Vercel
   webhook).
3. After pushing, poll `gh api repos/Hex-Tech-Lab/hex-yt-intel/deployments`
   (or the Vercel MCP `list_deployments` tool if available to you) until a
   new deployment record appears for your new commit SHA, then confirm its
   `state` reaches `READY` with `target: production` before declaring done.
   Do not declare this fixed just because the push succeeded — the whole
   point is that a successful push previously did NOT deploy.
4. If, after a real wait (a few minutes), still no deployment record
   appears for the new commit, STOP and report this as a genuine platform/
   webhook problem needing the user's direct Vercel dashboard access — do
   not guess at a workaround beyond a normal push.

**Part B — Investigate and fix (or rule out) the font-size report.**
1. Live-measure `getComputedStyle(...).fontSize` for the real body-text
   element on all three pages: `.legal-p` on `terms-and-conditions`,
   `.legal-p` on `privacy-policy`, and the equivalent real text element on
   `sub-processors` (note: `sub-processors.md` is almost entirely tables —
   check both `.legal-p` if any exists there AND `.legal-prose td`/`th`,
   since `LegalPage.tsx`'s CSS intentionally sets tables to a smaller 13px —
   figure out whether the user's "smaller" perception is this intentional
   table sizing being misread as a bug, or a real unintended difference in
   the actual paragraph text size).
2. If there IS a real, unintended difference in paragraph/body text size
   between pages sharing the exact same `LegalPage.tsx` component and CSS,
   find the actual mechanism (all three pages render through the same
   component — a real difference would be surprising and worth understanding
   precisely, not just patching blindly).
3. If it turns out to be the intentional 13px table-text sizing being
   perceived as "smaller," report that clearly as the finding — do not
   invent a fix for something that isn't actually a bug. If the user still
   wants table text to visually match body text size after you explain this,
   that's a product decision for the user, not something to decide
   unilaterally — report back and let CC/the user decide, don't just bump
   the table font-size yourself.

## 3. Goal / definition of done

- A new commit on `main` that: (a) fixes or clarifies the font-size question
  from Part B, and (b) as a side effect of being a real push, re-triggers a
  Vercel deployment.
- Confirmed via `gh api .../deployments` AND a live Playwright screenshot of
  `https://hex-yt-intel.vercel.app/terms-and-conditions` that the new
  terms-of-service content (not "Necessary Rights Firewall", "Last Updated:
  2026-08-21", clauses 2.1-2.4 visibly separated) is actually live in
  production — not just that a deployment exists, but that the RIGHT
  content renders.

## 4. Expected results

- Real diagnosis of the font-size question (fix if real, clear explanation
  if not a bug) committed and pushed.
- A new Vercel production deployment confirmed READY for the new commit.
- Live screenshot evidence (not just curl) that terms-and-conditions now
  shows the fixed content in production.
- Ledger entries per protocol.

## 5. Task-specific skills/tools/plugins/MCPs

- `web-design-guidelines`: this touches user-visible legal-page typography —
  applicable.
- No backend/security-relevant skills apply (no auth, no DB, no new API
  surface). `qa-intel`/`contract-auditor`/`/simplify` apply normally to
  whatever code diff you produce (if any — this may be markdown/CSS only).
- You likely need `gh` CLI (already available) for the deployment-record
  checks. If a Vercel MCP is available to you, prefer its `list_deployments`
  tool over guessing from the GitHub side alone.

## 6. Fixtures

Read `web/components/templates/LegalPage.tsx` in full (all three pages'
shared renderer) before making any font-size change. Read
`docs/legal/terms-of-service.md`, `privacy-policy.md`, `sub-processors.md`
to see the actual current committed content (already correct on disk for
all three — this is a DEPLOYMENT gap, not a content gap, for Part A).

## 7. The three tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
>    contract for what you're building BEFORE writing it. After writing it,
>    check the diff against that stated contract — not "does it compile,"
>    but "does this actually fire on the real path it claims to fix."
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
>    passing unit test proving a function's isolated output is correct is
>    NOT sufficient evidence the fix works — trace the real caller chain
>    with actual proof (a live DB query showing a row landed, a real HTTP
>    round-trip, not a mock standing in for the whole chain).
> 3. **Tangent hunt as you walk the workflow.** While touching each file,
>    check adjacent call sites and control-flow branches for the same class
>    of gap. Report tangents found even if not fixed this pass.
>
> **If you cannot complete a full cycle, or find a design gap mid-task,
> STOP and report the specific deviation and why, rather than shipping a
> partial fix under a "done" label.** A clearly flagged incomplete item is
> fine; a silently incomplete one reported as done is not.

For THIS task, tenet 2 is the whole point: "pushed a commit" is NOT proof of
done — "confirmed a new production deployment exists AND serves the right
content, via live screenshot" is the only acceptable proof.

## 8. Report format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates → Files changed. CC independently re-verifies every
> claim against real code and real system state before accepting.

## 9. Gates — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```

Run these if you touch any `.tsx`/`.ts` file (e.g. `LegalPage.tsx`). If your
fix is markdown-only, state that explicitly and skip.
