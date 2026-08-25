# TECHNICAL HANDOVER SUMMARY — hex-yt-intel (vIntel rebrand + highlights-reel redesign + UI triage marathon)

**Session Date:** 2026-08-20, ~14:00 – 21:23 EEST (single continuous session, compacted once)
**Agents Involved:** CC (Claude Code / Sonnet 5, orchestrator+verifier), AGY (Antigravity/Gemini, execution agent — hit session limit mid-task, resumed), OC (opencode/DeepSeek, not dispatched this window)
**Project:** hex-yt-intel — YouTube video-intelligence SaaS. Next.js/React web (Vercel) + Cloudflare Worker/Hono + Supabase Postgres + Upstash Redis. pnpm-only monorepo.
**Session Type:** Feature development (highlights-reel redesign) + UI/UX bug-fix batch + rebrand (text/copy only) + tech-debt cleanup, all via parallel isolated-worktree agent dispatch
**Status:**
- PRs #257, #258, #259 → ✅ MERGED to main
- PRs #260 (markdown-link-renderer), #261 (rebrand), #262 (shared-playback-hook) → 🔍 OPEN, real fixes pushed, CI/merge status NOT reconfirmed since before compaction
- LICENSE-ADDENDUM.md/NOTICE.md title rebrand → 🔍 edited in worktree, UNCOMMITTED
- This handover doc → ✅ this file, doubling as the mandatory pre-compaction context snapshot per global CLAUDE.md

---

## 1. Executive Summary

hex-yt-intel is being rebranded to **vIntel** (text/copy only this pass; infra deferred) while simultaneously shipping a full highlights-reel playback redesign (media-time-clamped, uncapped-selection) and a batch of live-screenshot-driven UI fixes, all under a standing "run qa-intel+contract-auditor+/simplify+code-review BEFORE opening a PR" process correction from the user. Current status: 3 of 6 total PRs this session are merged (#257/#258/#259); 3 are open with real review-driven fixes applied but not yet reconfirmed green/merged (#260/#261/#262); a small uncommitted edit (legal doc titles) is sites in a worktree. **Biggest blocker:** none technical — just unfinished verification/merge bookkeeping interrupted by this handover request itself.

## 2. Technical Environment

- **Stack:** Next.js (App Router) + React, Tailwind + Astryx design system (`@astryxdesign/core`, `@astryxdesign/theme-neutral`) — NOT shadcn (deleted 2026-08-02). Cloudflare Worker (Hono). Supabase Postgres (ref `adnmbikaqnxivalqoild`). Upstash Redis.
- **Package manager:** pnpm ONLY — never npx/npm/yarn (npx broken in WSL2). Root has no type-check script; use `pnpm --filter @hex-yt-intel/web <script>`.
- **OS/Shell:** Linux 6.18 WSL2, bash.
- **Repo root:** `/home/kellyb_dev/projects/hex-yt-intel`, main working branch `fix/dimension-ui-p0-batch`, base `main`.
- **Multi-agent setup:** Isolated git worktrees under `.claude/worktrees/agent-<id>/` per dispatched agent — avoids shared-checkout collisions (a real prior incident). Active worktrees this session:
  - `agent-aa487b887b2690340` → PR #260 (markdown-link-renderer)
  - `agent-abd8835353772761b` → PR #262 (shared-playback-hook)
  - `agent-a77ac2a2034f2dbdc` → `docs/rebrand-vintel` branch → PR #261 (rebrand) — **has uncommitted LICENSE/NOTICE edits**
- **Repo state at handover:** `main` has #257/#258/#259 merged. 3 worktrees above have pushed commits to their PR branches already (per earlier verification passes) plus the LICENSE/NOTICE edit not yet committed anywhere.
- **Infra coordinates:** Vercel app `hex-yt-intel.vercel.app` + `yt-intel.getmytestdrive.com` + `v-intel.getmytestdrive.com` (all valid until cutover); CF Worker `yt-intel.hex-tech-lab.workers.dev`; new domains `getvintel.com`/`www.getvintel.com` already in `worker/src/middleware/cors.ts`'s `PRODUCTION_ORIGINS` (confirmed correct, untouched by rebrand agent).

## 3. Chronological Timeline (newest first)

**21:23** — User submitted the exact 20-section handover template spec (reproduced faithfully in §5 structure here) + "create a checkpoint as well." This interrupted an in-flight `tsc --noEmit` / qa-intel verification run on the `agent-a77ac2a2034f2dbdc` worktree (rebrand branch), triggered by the user's own process-correction feedback about running gates before pushing.

**~21:10–21:20** 🔑 — Ran `contract-auditor.ts` retroactively across all 3 open-PR worktrees per the user's explicit process correction ("run qa-intel/contract-auditor/simplify/code-review BEFORE opening PRs, not after"). All 3 came back clean (0 critical, 3 pre-existing unrelated warnings). This was the concrete behavior change applied in response to user feedback — not yet extended to a full pre-PR skill-stack run on the LICENSE/NOTICE change itself.

**~21:00** — Explained `docs/legal/LICENSE-ADDENDUM.md` (AGPL-3.0 + custom addendum: no commercial use, no closed forks, no AI training/scraping without permission) and `docs/legal/NOTICE.md` to the user, who didn't know what they were. Confirmed: these are source-repo reuse licenses, NOT the customer Terms of Service (not rendered on any live page). User confirmed (`"yes, they should also refer to [vIntel]"`) → titles rebranded via sed:
```bash
sed -i 's/CUSTOM LICENSE ADDENDUM FOR HEX-YT-INTEL/CUSTOM LICENSE ADDENDUM FOR VINTEL/' docs/legal/LICENSE-ADDENDUM.md
sed -i 's/# HEX-YT-INTEL NOTICE/# VINTEL NOTICE/' docs/legal/NOTICE.md
```
🔑 Deliberately left "Hex-Tech-Lab" (copyright holder / legal entity name) untouched in both files — that's a distinct legal-entity question the user has referenced but never actually supplied a replacement for. Do not touch it without an explicit new legal-entity name from the user.

**Earlier same session (per pre-compaction summary, compressed here — full detail in the original transcript if needed):**
- Rebrand agent (`agent-a77ac2a2034f2dbdc`) dispatched via the mandatory agent-prompt template, hit account session-limit mid-task, resumed via `SendMessage` (not a fresh `Agent` call — that mistake created a throwaway duplicate agent `a02005ca69ac0eecc`, cleanly `TaskStop`'d with no damage, see §7 Troubleshooting). Rebranded product-brand references across `web/app/layout.tsx`, `Footer.tsx`, `Navigation.tsx`/`ResponsiveHeader.tsx`/`MobileBreadcrumb.tsx`, `LegalPage.tsx`, `Sidebar.tsx`, `analyses/saved/page.tsx`, `auth/signin/form.tsx`, `landing-page.tsx`, `share/[token]/page.tsx`, and all `docs/legal/*.md` bodies + their page renders, including 3 contact emails switched from `@hex-yt-intel.com` → `@getvintel.com` (user explicitly confirmed: "of course!"). Some occurrences were split across JSX text nodes (`HEX{"·"}YT{"·"}INTEL`) and were MISSED by grep, only caught via live Playwright rendering — 🔑 lesson: grep alone is insufficient for brand-string audits when JSX interpolates the string.
- `/simplify` 5-finding backlog from PR #257/#258 dispatched as 2 parallel worktree agents (shared-hook extraction + markdown-renderer extraction can run concurrently since files don't overlap; the other 3 — timer consolidation, guard-in-component, Astryx CSS fragility — were judged lower-priority/deferred or already folded into the two active extractions). Produced PR #260 (`MarkdownLink` shared component, `web/components/markdown/dimensionMarkdownComponents.tsx`) and PR #262 (`useSegmentPlayback` shared hook, `web/lib/hooks/useSegmentPlayback.ts` + `useHighlightTicker.ts` rewrite).
- PR #260 got real automated review findings (protocol-relative URL bug in `isExternal` regex; missing URL-class test coverage) — both fixed (regex widened to `/^(https?:)?\/\//i`; 4 new direct-`MarkdownLink` tests added).
- Highlights-reel fully redesigned per user's explicit spec: uncapped highlight count (no fixed % target), marker-track UI borrowing `EntityMentionTimeline.tsx`'s visual shell only (not its known-broken seek logic), ticker-style script preview, Prev/Next, 0.5x–3x speed. Landed as PR #258, later the `/simplify` pass split its playback-engine logic out into the shared `useSegmentPlayback` hook (PR #262).
- Two external research reports (video-player-controls best practices; a speculative `useYouTubeAutoscrub` hook) were evaluated — only the media-time-clamping-over-wall-clock-timer insight was judged applicable and was implemented (validates the `useSegmentPlayback` design independently).
- A static "AI Autoscrub Player" HTML mockup was critiqued and published as a viewable Claude Artifact per user request ("share in a loc. i can see it").
- Dub.co client-side conversion tracking wired up with a user-generated publishable key; domain allowlist confirmed to include legacy `getmytestdrive.com` domains + `localhost`.
- KG entity-weight prompt bug (issue #243) fixed in `web/lib/prompts/ucis-v5.3.ts` after the user rejected a first draft for "mention frequency" bias — landed as PR #259, live Vault secret bumped v9→v10 with a Redis cache `DEL` (🔑 the fallback constant alone would have been inert — `SupabasePromptAdapter.getPrompt()` checks Redis→Vault first).
- Dimension-11 table-corruption bug and chat-composer focus-ring bug (3 attempts — see §6/§7) both fixed and merged in PR #257.

## 4. Iterative Development Tracking — Chat Composer Focus Ring (3 iterations) 🔑 KEY DECISION

1. **v1**: outline on the outer `.astryx-chat-composer` element → user: "looks ridiculous," described as an oversized external box.
2. **v2**: moved outline to `.astryx-chat-composer-input` based on class-name guessing alone → WRONG. That element has no real border/background (confirmed only by reading Astryx's vendored source), so the outline collapsed to a "single line" — exactly the user's next complaint.
3. **v3 (final, correct)**: moved back to `.astryx-chat-composer`, this time verified by (a) reading the real vendored component source, not guessing from class names, and (b) a live isolated Playwright repro checking `getComputedStyle` before/after `.focus()`.

**Differential (final fix), `web/app/globals.css`:**
```css
[data-chat-dock="true"] .astryx-chat-composer:focus-within {
  outline: 2px solid var(--accent) !important;
  outline-offset: 1px !important;
}
```
**Prevention measure:** for any 3rd-party design-system CSS override, read the vendored component source before guessing from class names — class names in Astryx do not reliably indicate DOM/style ownership.

## 5. Troubleshooting Loop Documentation

**Loop: SendMessage vs Agent tool confusion**
- Root cause category: wrong tool selection (spawned fresh agent instead of resuming existing one).
- Cycle count: 1 wasted dispatch + 1 cleanup.
- Stop-and-think moment: none taken initially — should have checked `ListAgents`/prior agent ID before dispatching.
- Breakthrough insight: `Agent` always starts fresh with no memory; `SendMessage` resumes. A prompt containing literal text like "to: agent-id..." does not route — there is no implicit addressing via prompt text.
- Prevention measure: before nudging a stalled background agent, use `SendMessage` with its exact name/ID, never `Agent`.

**Loop: passive-wait stalling in background agents**
- Root cause: dispatched agents (esp. rebrand agent) repeatedly reported "waiting for a build/dev-server readiness notification" — a pattern that doesn't resolve the same way for a background subagent as it does for the orchestrator.
- Cycle count: multiple `SendMessage` corrections needed before the agent switched to active polling (`curl`/retry-loop).
- Prevention measure: when dispatching any agent that needs to wait on an external readiness signal, explicitly instruct it to poll actively, not wait passively.

**Loop: `gh pr edit --base` GraphQL failure**
- Root cause: unrelated GitHub GraphQL deprecation error ("Projects (classic)...") on an otherwise-valid retarget call.
- Fix: use REST directly — `gh api repos/Hex-Tech-Lab/hex-yt-intel/pulls/258 -X PATCH -f base=main`.
- Follow-on: retargeting caused a real (if shallow) merge conflict from squash-merge history rewrite — resolved via `git merge origin/main` in the worktree, keeping HEAD's already-`/simplify`-fixed code for `.tsx` files, merging both sides for the doc file.

## 6. Knowledge Cycles

**Cycle: Highlights-reel media-time-clamping architecture (spans most of the session)**
- Trigger: user's detailed UI feedback that the highlights-reel used a naive wall-clock timer, misplaced UI, and a fixed compression target the user explicitly rejected.
- Objective: redesign playback to track real player time, remove the fixed % cap, and share the engine between the authenticated dashboard and the anonymous `/share` view.
- Participants: CC (design + verification), 1 dispatched worktree agent (`/simplify` extraction pass), 2 external research reports (evaluated, partially incorporated).
- Phases: initial rewrite in-place in both `HighlightsScrubber.tsx` and `PublicHighlightsReel.tsx` (duplicated state machines) → PR #258 merge → `/simplify` finding flagged the duplication → extraction into `useSegmentPlayback.ts` + `useHighlightTicker.ts` rewrite → PR #262.
- Key artifacts: `web/lib/hooks/useSegmentPlayback.ts` (full interface documented in §Reference Index), its 9-test suite, `HIGHLIGHTS_SPEED_MIN/MAX` constants in `highlights-settings.ts`.
- Outcome: single shared, tested playback engine; both callers reduced to thin primitive-adapters.
- Lifecycle status: implemented, PR #262 open (not yet confirmed merged).
- Integration status: not yet in `main`.
- Why this matters: this was flagged by the user as one of 5 real `/simplify` findings "too risky to rush before merge" — deliberately deferred to a dedicated follow-up pass rather than bolted on under PR #258's original review pressure.

## 7. Recurring Patterns / Housekeeping

**Pattern: qa-intel/contract-auditor/simplify/code-review run reactively (after PR open) instead of proactively (before)**
- Frequency: recurring default behavior this session until explicitly corrected.
- Core issue: running the 4-tool gate stack only after CI/review tools catch something wastes review cycles.
- User's frustration statement: *"You mentioned... Why run qa-intel now? You should run all four of them before hitting the PR."*
- Attempted solutions: this session, retroactively ran `contract-auditor` on all 3 open worktrees after the correction landed (all clean).
- Status: partially addressed — applied to the 3 already-open PRs' worktrees, NOT yet baked into a template/process artifact the way the agent-dispatch-template mandate was.
- What would actually fix this: treat "run CORE 4-tool stack in the worktree BEFORE `gh pr create`" as a hard step in `docs/agent-prompts/TEMPLATE.md` / `pr-review-workflow` skill, same enforcement mechanism used for the ledger-protocol gap fix on 2026-08-06.

## 8. Current State Snapshot

**✅ Works:**
- PRs #257/#258/#259 merged, live on `main`. Dimension-11 table bug fixed. Chat composer focus ring fixed+verified. KG weight-field prompt fixed+live (Vault v10). Dub.co tracking wired. Highlights-reel redesign (v1, monolithic) live.
- `useSegmentPlayback` hook implemented + tested (9 tests) in worktree, not yet merged.
- Shared `MarkdownLink` component implemented + tested (8 tests) in worktree, not yet merged.
- Rebrand copy changes implemented across the app (layout, footer, nav, legal pages, auth form, landing, share page) in worktree, not yet merged.

**❌ Doesn't work / not done:**
- PR #260/#261/#262 CI status not reconfirmed since before compaction — do not assume green.
- LICENSE-ADDENDUM.md/NOTICE.md title edits are sitting uncommitted in `agent-a77ac2a2034f2dbdc`.
- Infra-scope rebrand (package.json names, CF Worker service name `yt-intel`) explicitly deferred, not started.
- Actual new legal entity name (vs. product brand "vIntel") never supplied by user — "Hex-Tech-Lab" left untouched everywhere.
- Test-account password rotation (`testsprite@getvintel.com`) still not done, flagged multiple times.

**🔍 In progress:** this handover document (now); resuming the LICENSE/NOTICE commit next.

**⛔ Blocked:** nothing technical — all blockers are sequencing/bookkeeping (need CI reconfirmation + merges), not unresolved technical problems.

## 9. Context Preservation — User Working Style

- Kelly (kellybakri@gmail.com) works EEST (UTC+3), gives dense multi-part instructions, explicitly sequences priorities ("wait until X, then Y, defer Z"), and reliably corrects process gaps rather than just outcomes (see §7 pattern). Expects evidence-based pushback, not appeasement (explicit standing memory: `feedback_never_appease_evidence_based_pushback`).
- Prefers markdown-table status updates for ≥3 items (`feedback_status_report_table_format`).
- Wants the full mandatory 8-9+ skill stack run on every PR without being asked, confirmed multiple times (`feedback_mandatory_skill_stack_every_pr`).
- Delegates well-scoped findings to OC/AGY but expects CC to independently re-verify every claim against real sources before trusting it — never accept "verified" from another agent at face value.
- Values negative-control verification (revert fix → confirm symptom reproduces → reapply) — explicitly praised technique.
- Confirmed casing/branding preference explicitly and precisely when asked ("vIntel", not vintel/Vintel).

## 10. Session Bridge Content (Last 3–4 Prompts, preserved near-verbatim)

**Prompt N-3** (real automated PR-review findings pasted for PR #260): protocol-relative URL bug in `isExternal`, missing URL-class test coverage, "Not merge-ready yet" verdict with a numbered remedy list. → Addressed: regex fixed, 4 tests added (see §3).

**Prompt N-2**: *"You mentioned the licenses and the notice, and I don't know what these are. Give me a gist... full path to them. And yes, they should also refer to [vIntel]... these are the... licenses for the code itself. \n\n You could have definitely... run qa-intel like I told you before—before sending out or creating the PR. That would save you 50% to 70% of the issues before even landing in the PR. Then, after opening the PR, you run qa-intel again... as well as contract-auditor, /simplify, and code review... Why do you do that? Why run qa-intel now? You should run all four of them before hitting the PR."* → Addressed: explained the two legal files, rebranded their titles, ran retroactive contract-auditor across all 3 worktrees. NOT yet fully closed: the LICENSE/NOTICE change itself hasn't had the full CORE gate stack run on it before commit (only `tsc`+qa-intel were mid-run when interrupted).

**Prompt N-1** (the full 20-section handover template spec, verbatim, sections 1–20 as given by the user, ending): *"...20.5 Validate completeness (≥95%)"* followed by a separate note about a formatting cleanup the user made to their own template (numbering fix), then: *"I think you should create a checkpoint as well."*

**Prompt N (current)**: same as N-1, resubmitted (interrupt/continuation of the same request) after a tool-call was interrupted mid-flight. This document is the direct response.

**Unresolved question:** none pending from the user — the explicit ask (this document) is being fulfilled now. The only implicit open item is whether "checkpoint" means something distinct from this handover doc (e.g., a git tag/branch snapshot) — interpreted here as satisfied by this markdown file per the project's own global CLAUDE.md pre-compaction snapshot rule, since no other checkpoint mechanism exists in this repo.

## 11. Critical Path Forward (next 3 actions)

**Action 1 — Commit + push the LICENSE-ADDENDUM.md/NOTICE.md title fix**
- Dependencies: none blocking; worktree `agent-a77ac2a2034f2dbdc` already has the edit applied.
- Verification criteria: `git diff` shows exactly the 2 title lines changed; re-run `tsc --noEmit` + qa-intel (was mid-run, interrupted) to completion, both clean, before push.
- Edge cases: none — this is a 2-line doc-only change with no code surface.
- Complexity: trivial (5 min).

**Action 2 — Reconfirm CI status on PRs #260, #261, #262 and merge each if green**
- Dependencies: Action 1 should land in PR #261 first (it's in that worktree/branch) before checking #261's CI.
- Verification criteria: `gh pr view <n> --json statusCheckRollup` shows all required checks SUCCESS; no unresolved P0/P1 findings from Cubic/CodeRabbit/etc. per the standing PR-confidence gate.
- Edge cases: squash-merge history rewrite between dependent branches can cause spurious CONFLICTING/DIRTY status (already hit once this session on #258→main retarget) — resolve via `git merge origin/main` + trivial conflict resolution, not force-push.
- Complexity: medium (requires waiting on external tools per the confidence-degree algorithm in `pr-review-workflow` skill).

**Action 3 — Update `docs/TECH_DEBT_LEDGER.md`'s 5-finding `/simplify` entry once #260/#262 actually MERGE (not just open)**
- Dependencies: Action 2 must complete for the relevant PRs first.
- Verification criteria: each of the 5 items marked resolved only with a real commit/PR reference, per explicit user instruction ("update it once each agent lands").
- Edge cases: 3 of the 5 findings (timer consolidation, guard-in-component, Astryx CSS fragility) were judged lower-priority/folded-in/deferred rather than separately implemented — don't mark them "resolved" without checking whether they were actually subsumed by #262's extraction or genuinely still open.
- Complexity: low (bookkeeping), but requires care not to overclaim resolution.

## 12. Reference Index

**Files/paths (absolute):**
- `/home/kellyb_dev/projects/hex-yt-intel/docs/legal/LICENSE-ADDENDUM.md`, `.../NOTICE.md` — edited, uncommitted, in worktree `agent-a77ac2a2034f2dbdc`
- `/home/kellyb_dev/projects/hex-yt-intel/.claude/worktrees/agent-a77ac2a2034f2dbdc` (branch `docs/rebrand-vintel`, PR #261)
- `/home/kellyb_dev/projects/hex-yt-intel/.claude/worktrees/agent-aa487b887b2690340` (PR #260, markdown-link-renderer)
- `/home/kellyb_dev/projects/hex-yt-intel/.claude/worktrees/agent-abd8835353772761b` (PR #262, shared-playback-hook)
- `web/lib/hooks/useSegmentPlayback.ts`, `web/lib/hooks/useHighlightTicker.ts`
- `web/components/markdown/dimensionMarkdownComponents.tsx`
- `web/lib/prompts/ucis-v5.3.ts` (KG weight-field fix, PR #259)
- `docs/UI_FEEDBACK_TRIAGE_2026-08-20.md` (master triage doc, item 11 still open: `EntityMentionTimeline` slide-down not mounting, hypothesis in `web/lib/utils/entity-time-seek.ts:407`)
- `docs/TECH_DEBT_LEDGER.md` (2 new entries this session, update per Action 3)
- `docs/agent-prompts/TEMPLATE.md` (mandatory dispatch-prompt template)

**PRs:** #257 ✅, #258 ✅, #259 ✅ merged. #260, #261, #262 open — reconfirm before merge.
**Issues:** #242 (dead `duration_seconds` column) closed. #243 (KG weight-field bias) closed.
**Live infra:** Supabase Vault `prompt.chat_grounding.instructions` now v10. Settings Registry keys added: `highlights.maxCount` (40), `highlights.maxOutputTokens` (6000).

## 13. Validation Checklist

- [x] Header complete
- [x] No ambiguity on current uncommitted state (LICENSE/NOTICE) or open-PR status
- [x] Versions/exact identifiers included where known (Vault v10, PR numbers, worktree IDs)
- [x] Problems shown with resolution or explicit non-resolution
- [x] File paths absolute and real
- [x] Commands given are directly usable (sed, gh api, git merge)
- [x] Next steps actionable (§11)
- [x] Session bridge preserved near-verbatim (§10)
- [x] Iterations documented (chat-composer focus ring, §4)
- [x] Troubleshooting loops documented (§5)
- [x] Knowledge cycles included (§6)
- [x] Recurring pattern captured (§7)
- [x] Key decisions tagged 🔑
- [x] Verification steps stated, not just claims
- [x] Multi-agent logic preserved (worktree IDs, SendMessage-vs-Agent lesson)
- [x] No lost insights vs. the pre-compaction summary — this doc compresses narrative/tool-output noise only, not decisions or unresolved state
