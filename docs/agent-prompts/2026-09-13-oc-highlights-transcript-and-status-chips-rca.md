# OC Dispatch — RCA + fix: Highlights missing verbatim transcript, cut-off dimension content, "lack of info" hedging, inconsistent status chips

Built from `docs/agent-prompts/TEMPLATE.md`. Model: OC (opencode, GLM 5.3 Flash, low effort) — investigation AND execution, per user's explicit context-window-budget directive (do the RCA yourself, don't hand CC raw findings to re-derive).

## Ledger protocol (ALWAYS INCLUDE)
1. Read `.memory/AGENT_LEDGER.md` before touching any file.
2. Append `[IN_PROGRESS] OC <timestamp> — dispatch-oc-highlights-transcript-rca: <intent>, target files`.
3. Flip to `[DONE]` with a one-line summary when finished. Do not merge yourself — CC is the sink orchestrator.

## Environment note (learned from repeated prior dispatches)
You cannot read or write ANY path outside this worktree directory — not `/tmp`, not `~/.wrangler`, not the main checkout, not `docs/private/` (git-untracked, confidential, doesn't exist in any worktree). Any scratch file goes inside this worktree. Use Supabase MCP tools if configured in your env for DB queries; if not available to you, state clearly what CC needs to pull instead of guessing.

## Step 0 (ALWAYS INCLUDE)
Use `code-review-graph` MCP tools before Grep/Read where available.

## Context (FILL IN) — user-reported symptoms, verbatim, on a real production video

User shared two screenshots of the Synthesis Console for `https://www.youtube.com/watch?v=gKgWYFOhZx0` (a "Creator Demo" marketplace-search video, analysis shows "100% complete", 10 highlight keypoints, 6m49s/23m13s = 29% watched at time of screenshot). Four distinct symptoms reported:

1. **Highlights Reel shows the transcript-missing fallback for real content.** The keypoint at `[14:37 - 15:37]` displays a tooltip: *"No verbatim transcript excerpt is stored for this moment — showing the AI-generated summary instead"*, with the keypoint itself tagged `SUMMARIZED` (not verbatim). User says "many of the dims" show this — implying it's not a one-off, it's affecting most/all highlight keypoints on this analysis.
2. **Some dimension content appears cut off / truncated** in the Detailed Summary panel (user's own observation, not further specified — investigate which dimension(s) and how).
3. **Many content points note "lack of enough info"** — i.e. LLM-generated hedging/disclaimer text appearing within dimension content where it shouldn't need to (if the transcript was actually available to it).
4. **Status chips inconsistent with "100% complete."** Screenshot 2 shows the dimension status row: `Digest` (green), `Description` (green), `Channel Meta` (gray, not green), `Comments` (gray, not green), `Chapters N/A` (gray), `Highlights (10)` (green) — yet the page footer says "100% complete." User: "some chips are not green even though it says 100%."

## Task — full RCA first, then fix what's confirmed broken (not what's merely suspicious)

### Investigation order (don't skip straight to a fix — confirm root cause per symptom first)

1. **Find the actual analysis row** for video_id `gKgWYFOhZx0` in Supabase (`analyses` table). Get its real `created_at`, `dimension_count`, `billing_status`, `validation_report`, and whether a `transcripts` row still exists for this `video_id` (recall: transcripts purge after 72h retention — a recently-known real mechanism, see `.memory/AGENT_LEDGER.md`'s 2026-09-11 PR #310/#311 entries for the exact schema/behavior). If the transcript row is gone, symptom 1 may be **expected behavior for an old analysis** (verbatim excerpts can only be sourced from a live transcript at render time) rather than a bug — confirm this explicitly before concluding it's a bug. If the transcript row still EXISTS and the Highlights Reel still shows the fallback message, THAT is a real bug in how verbatim excerpts are being looked up/matched against the transcript.

2. **For symptom 1, if the transcript exists**: find the code that renders that Highlights Reel tooltip/fallback (search for the exact string `"No verbatim transcript excerpt is stored"` or similar) and the matching/lookup logic that decides whether a keypoint has a verbatim excerpt available. Check whether it's failing to match timestamps against transcript segments correctly (e.g. an off-by-something in timestamp alignment, a case where highlight timestamps don't correspond to any transcript segment boundary, or the lookup requiring an exact match instead of a nearest/range match).

3. **For symptom 2 (cut-off content)**: search the Detailed Summary rendering path and the dimension generation/persistence path for any hard truncation (`.slice()`, `.substring()`, a max-length guard, a token/character cap on dimension content) that could be cutting off legitimate content rather than a deliberate design limit. Cross-reference against known max-output-token settings (`analysis.llmCascade.*`, `digest.maxOutputTokens` per `ADR_017`/`digest_max_output_tokens` migrations) — is content actually being generated in full and then truncated on render, or is the LLM cascade itself hitting an output-token ceiling and stopping mid-thought? These have very different fixes.

4. **For symptom 3 ("lack of enough info" hedging)**: this is very likely connected to symptom 1/2's root cause — if the LLM is generating content with an incomplete or missing transcript (or a truncated one), hedging language is the expected symptom, not an independent bug. Confirm whether this is downstream of 1/2, or a genuinely separate issue (e.g. a persona/prompt issue where the LLM hedges even with full transcript access).

5. **For symptom 4 (status chips)**: find the component that renders the dimension status chips row (`Digest`, `Description`, `Channel Meta`, `Comments`, `Chapters`, `Highlights`) and the "N% complete" footer text, and determine whether they're computed from the SAME source of truth or two different ones that can drift (this is a known class of bug in this codebase — see `.memory/AGENT_LEDGER.md` and ADR history for prior chip/status-consistency incidents, e.g. the "Highlights status badge" open item noted in `project_thos_20260907_security_highlights_pr_merge.md`-style entries). `Channel Meta` and `Comments` being gray is architecturally plausible if this video has no channel-meta/comments data ever fetched for it (both are known-optional/best-effort dimensions per this repo's Law #1-4 and the `channel-meta dropped`/`comments fetch failed` Sentry capture points seen in earlier sessions) — check whether gray for those two specifically means "not fetched, expected" vs. "fetched but chip logic is wrong," and whether "100% complete" should even include those 2 non-core dimensions in its denominator or not. Report the actual contract (what SHOULD 100% mean) before deciding this is a bug vs. correct-but-confusing UI.

### Fix scope
Only fix what step 1-5 above CONFIRMS is a real bug with a clear root cause. If a symptom turns out to be expected behavior (e.g. old transcript purged), do not "fix" it — instead, if the UI/UX is genuinely confusing (e.g. a purged-transcript video always showing a scary-sounding fallback message with no indication this is normal/expected), propose a clearer message as a small, separate, clearly-labeled UX improvement — do not conflate it with a real bug fix in the same commit.

## Gates (ALWAYS INCLUDE)
qa-intel (`pnpm qa-intel:ci` and `--mode diff --base origin/main`, exit code checked un-piped), full vitest suite for touched files, `tsc --noEmit`. Full skill stack per `feedback_mandatory_skill_stack_every_pr` (fresh `ls ~/.claude/skills .claude/skills` enumeration — do not recall a stale list).

## Report format (ALWAYS INCLUDE)
For EACH of the 4 symptoms: state the confirmed root cause (or "not a bug, here's why" with evidence), what was fixed (if anything), and proof. Post final `[DONE]` to ledger with this per-symptom breakdown, hand back to CC — do not merge yourself.
