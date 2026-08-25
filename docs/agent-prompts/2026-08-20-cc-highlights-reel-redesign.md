# Agent Dispatch Prompt — Highlights Reel Redesign

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file; post `[IN_PROGRESS]` with
intent + target files as your first action; re-check the ledger after every
subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
actually happened as your last action.

## 1. Context

`hex-yt-intel` is a YouTube video-intelligence SaaS (Next.js/React web on
Vercel + Cloudflare Worker + Supabase). The "highlights reel" feature lets a
user auto-play just the important segments of an analyzed video instead of
watching the whole thing.

Live user feedback (2026-08-20, full triage in
`docs/UI_FEEDBACK_TRIAGE_2026-08-20.md`, items 6-8) rejected the current
implementation as broken in three ways:

1. **Arbitrary compression cap.** `HighlightsScrubber.tsx`'s extraction
   backend (`GenerateExecutiveDigestUseCase`, wired through
   `analysis_highlights` table + Settings Registry keys
   `highlights.segmentDurationSeconds`/`highlights.contextLeadSeconds`)
   currently produces a reel capped around 10-20% of video length regardless
   of how much genuinely important content the video contains. User's
   explicit instruction: **there is no fixed target percentage** — capture
   every genuinely important point, even if that's 40 points needing 60% of
   the runtime for a dense video.
2. **No marker/scrubber UI, no ticker text, no segment nav, no speed
   control.** The current `HighlightsScrubber.tsx` is just a Play/Stop
   button with a text counter — no visual timeline, no way to jump between
   highlights, no preview of what's about to play.
3. **Highlights reel and chat give inconsistent answers to the same
   question.** Asking the Synthesis Chat "give me the most important key
   points with timestamps" returns a *different* count/set of points than
   the highlights reel shows. These should draw from the same underlying
   extraction, or the chat should explicitly reference the same highlights
   data — not two isolated, disagreeing sources.

There is **no prior "better" highlights-reel UI to restore** — verified via
full `git log --all` history search, confirmed with the user. The real
precedent to build on is `EntityMentionTimeline.tsx`
(`web/components/templates/console/EntityMentionTimeline.tsx`, ADR 025, PR
#224) — a scrubber-with-markers component (colored dot markers on a track,
active-segment highlight window, Prev/Next nav, "#N of M" counter, a
slide-down mount animation under the video player).

**CRITICAL CORRECTION (live user report, same session, do not skip):**
`EntityMentionTimeline`'s *seek/mention-identification logic* is currently
broken in production — clicking an entity jumps the video to wrong/
repeated locations, a known unresolved issue this project has been
tracking. Separately, and apparently more recently, the component's
*visual shell itself* (the animated slide-down scrubber bar under the
video) has stopped appearing at all, even though seeking still fires (to
wrong targets) when an entity is clicked — this is a distinct, undiagnosed
regression, not yet root-caused.

**Because of this, only reuse `EntityMentionTimeline.tsx`'s UI/animation
shell code (the track markup, marker rendering, active-window highlight,
Prev/Next button chrome, the mount/slide-down animation) — never its
mention-identification or seek-target logic.** The highlights reel must
seek using its own timestamps from `analysis_highlights` /
`/api/analyses/highlights` (already correct, already used by
`HighlightsScrubber.tsx` today) exclusively. Do not import, call, or model
your seek logic on anything in `entity-time-seek.ts` or the
`RankedEntityMention`/mention-ranking pipeline. If you're unsure whether a
piece of `EntityMentionTimeline.tsx` is "shell" or "seek logic," treat it as
seek logic and reimplement the visual pattern fresh rather than reusing the
code directly.

Also log, but do NOT attempt to fix in this task (separate, undiagnosed
regression, needs its own investigation): `EntityMentionTimeline`'s
slide-down UI no longer mounts/renders on entity click in current
production, despite the underlying `setSeekTo` firing. Add this as a new
entry to `docs/UI_FEEDBACK_TRIAGE_2026-08-20.md` under a new "Regressions
found during highlights-reel work" section when you find it, with whatever
you can determine about why it doesn't mount (e.g. a condition on
`timelineEntityData` in `DashboardContainer.tsx` never becoming truthy, a
prop mismatch, silent error) — but do not spend more than a quick
diagnostic pass on it; it is out of scope to fix here.

## 2. Task

Redesign the highlights reel as a new scrubber-based player, adapting
`EntityMentionTimeline.tsx`'s real, working track/marker/nav pattern, laid
over `HighlightsScrubber.tsx`'s existing data-fetch and playback-sequencing
logic (`/api/analyses/highlights`, `useVideoStore.setSeekTo`). Concretely:

1. **Uncap highlight selection.** Find and remove/relax the fixed
   percentage-of-runtime cap in the highlights extraction path (likely in
   the digest-generation prompt/logic that populates `analysis_highlights`,
   or a client-side clamp in `HighlightsScrubber.tsx` — confirm which by
   reading `GenerateExecutiveDigestUseCase` and the `highlights.*` Settings
   Registry keys before assuming). Selection should be driven by "how many
   points does this video actually have," not a hardcoded ceiling. This may
   be a prompt-engineering change (LLM extraction instructions), a
   Settings-Registry tunable change, or both — investigate before patching,
   per the three tenets below. No hardcoded magic numbers — any new tunable
   goes in the Settings Registry, per this project's standing rule (see
   `AGENTS.md`).
2. **Build the new player UI**, replacing `HighlightsScrubber.tsx`'s
   Play/Stop button with (adapting `EntityMentionTimeline.tsx`'s pattern):
   - A horizontal marker track showing every highlight segment's position
     on the video timeline (reuse the dot-marker + active-window-highlight
     pattern).
   - Prev/Next controls to jump between highlight segments (reuse the
     Prev/Next + "#N of M" counter pattern).
   - A static preview of the next segment's first 5-10 words of script
     before it plays, then a ticker-style reveal of that script text while
     the segment is actively playing. (New — no existing precedent; the
     script text per segment should come from the same source that names
     each highlight's `label`, check what other text is available on the
     `Highlight`/`analysis_highlights` row.)
   - Playback speed control (0.5x-3x) applied to the underlying video
     player via the existing `useVideoStore` seek/play bus.
   - Keep the existing top-right "N keypoints · duration · %" indicator —
     user explicitly said this part is already correct.
   - Public `/share/[token]` variant (`PublicHighlightsReel.tsx`) needs the
     same treatment, adapted to its own player adapter
     (`YouTubePlayerAdapter`, not `useVideoStore` — it has no Zustand store
     since anonymous viewers never touch the dashboard).
3. **Reconcile chat/reel consistency.** Find where the Synthesis Chat
   answers "most important key points" questions (grep `ChatDock.tsx` /
   chat grounding routes) and make it reference the same
   `analysis_highlights` data as the reel, OR document precisely why they
   should legitimately differ (e.g. chat answers on-demand from full
   dimension content vs. reel is a fixed pre-extracted set) — don't leave
   them silently disagreeing with no stated reason. Flag this as a
   deviation if a full reconciliation is out of scope for this pass; a
   documented reason beats a silent gap.
4. Explicitly **out of scope for this task** (do not touch): the
   fade-to-black/logo-watermark chapter-transition polish (user deferred
   this as a later marketing feature) and the KG/WordCloud/MindMap coloring
   work (item 9 in the triage doc, separately parked).

## 3. Goal / definition of done

- A real analysis with more highlight-worthy content than the old ~10-20%
  cap allowed produces a highlights reel with more than the old ceiling's
  worth of segments (verify via a live run, not just reading the prompt
  change).
- The new player visibly shows a marker track, lets a user jump
  Prev/Next between segments, shows ticker-style script text while
  playing, and has a working speed control — verified in a real browser
  (Playwright), not just "the code looks right."
- Both the authenticated dashboard version and the public `/share/[token]`
  version work.
- Chat's key-points answer and the reel either draw from the same source
  or the discrepancy is explicitly documented in the PR description.

## 4. Expected results

- Modified: `web/components/dashboard/HighlightsScrubber.tsx`,
  `web/app/share/[token]/PublicHighlightsReel.tsx`, the
  extraction/cap logic (exact file TBD by investigation), possibly a new
  Settings Registry migration if the cap becomes a tunable that isn't one
  yet.
- New: likely a shared marker-track sub-component if the pattern is
  extracted for reuse between the authed and public variants (your call —
  don't force an abstraction if the two variants diverge enough that a
  shared component would need heavy prop branching).
- A PR opened via `gh pr create`, running the full `/pr-review-workflow`
  skill (CORE: qa-intel diff+full, contract-auditor, `/simplify` 4-agent
  pass, code-reviewer; SELECT: react-best-practices since this is a
  React/hooks-heavy change, web-design-guidelines since it's user-visible
  UI, owasp-top-10 only if the chat-reconciliation step touches an API
  route). Wait for real external tool checks (Cubic/CodeRabbit/Snyk/CI)
  before merging — do not `--admin` merge immediately.

## 5. Task-specific skills/tools/MCPs

- `code-review-graph` MCP (Step 0, mandatory — see Fixtures below).
- `react-best-practices` — this is a hooks-heavy, real-time-playback
  component (timers, video-seek sync); check for stale-closure/dependency
  bugs, the same class of bug `EntityMentionTimeline.tsx`'s own commit
  history shows were caught in review there (counter/marker desync,
  stale-seek races — read that file's inline comments, they document real
  past bugs in this exact pattern).
- `web-design-guidelines` — user-visible UI change.
- Supabase MCP if the `analysis_highlights` schema or Settings Registry
  needs a migration for the uncapped-selection tunable.
- `/pr-review-workflow` skill for the full review cycle once the diff is
  ready.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Before touching any code, run `code-review-graph`'s
`build_or_update_graph_tool`, then `get_review_context_tool`/
`get_impact_radius_tool` scoped to `HighlightsScrubber.tsx`,
`EntityMentionTimeline.tsx`, `PublicHighlightsReel.tsx`, and the
digest-generation use case, before reading whole files.

**Branch**: start from `fix/dimension-ui-p0-batch` (NOT `main`) — that
branch already contains the highlights-reel repositioning (moved under the
video player) from a prior task in this same session; branching from `main`
would miss that placement fix and you'd be building the new player in the
wrong spot. Create your own branch off it, e.g.
`feat/highlights-reel-redesign`.

**Existing pattern to follow — VISUAL SHELL ONLY**: `EntityMentionTimeline.tsx`
in full — read it before writing any new marker-track code, but per the
CRITICAL CORRECTION in section 1, only port its rendering/animation/marker
JSX and CSS, never its seek-target/mention-ranking logic. Its inline
comments describing prior bugs (stale-seek guard, chronological-vs-rank
ordering) are useful context for what NOT to reproduce, not a pattern to
copy.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the exact
   props/data-shape contract for the new player component before writing
   it. After writing it, check the diff against that stated contract.
2. **E2E cycle complete.** A passing unit test is not sufficient — verify
   with a real browser (Playwright) against a real or realistic seeded
   analysis showing the marker track, Prev/Next, ticker text, and speed
   control actually working, plus a live check that the uncapped selection
   actually produces more segments for a dense video (not just that the
   cap constant changed).
3. **Tangent hunt.** While touching the extraction/cap logic, check for
   other hardcoded percentage/count caps nearby that should also be
   Settings-Registry-driven. Report tangents found even if not fixed.

**If you cannot complete a full cycle, or find a design gap mid-task, STOP
and report the specific deviation and why, rather than shipping a partial
fix under a "done" label.**

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (cite actual command/query/screenshot
output, not "tests pass") → Tangents found → Deviations flagged (if any) →
Skills run + findings → Gates (tsc/vitest/qa-intel `--ci --compare`/
contract-auditor results, exact output) → Files changed → PR URL and current
review-tool status.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```
