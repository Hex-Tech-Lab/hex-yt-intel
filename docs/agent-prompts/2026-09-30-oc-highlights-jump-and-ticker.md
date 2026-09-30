# Agent Dispatch Prompt — Highlights reel: manual jump doesn't play; caption ticker out of sync; late segment start

**Target Agent**: OC (`glm-preset/@preset/glm-53-flash-on-cheap`, CLAUDE.md "OC model standard")
**Effort Level**: medium
**Series**: R3b step 2 (ADR 037 Addendum A, private doc `docs/private/ADR_037_JEV_SEMANTIC_CHUNKING_VARIANCE_BOUNDARIES_2026-09-29.md` — read Addendum A in full). Dispatch ONE at a time, in order 2.1 → 2.5; each starts from `origin/main` after the previous one merged.

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
>
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

---

## HARD RULES

1. Work ONLY in worktree `/home/kellyb_dev/projects/hex-yt-intel-highlights` (branch `fix/highlights-jump-ticker`, created by CC from `origin/main`). Home dir `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files. If the same test fails twice for the same reason, STOP and report `[BLOCKED]`.
3. No live-DB writes, no migration apply, no deploys, no secrets printed. CC applies migrations (ADR 018).
4. qa-intel findings are NOT advisory (CI fails on them). Fix new-code findings; never baseline new code.
5. Commit when done (no push). Paste `git status --short` first: only the files named below.
6. Negative control for EVERY behavioural test you add: revert the fix → the test fails; paste the output. A test that passes without the fix proves nothing.

---

## 1. Context & Problem Statement

User report (2026-09-30, verbatim essentials), on the "Sabrina Romanov" video's highlights reel (16 highlights):
1. **Manual jump doesn't play.** Pressing a highlight's button to jump to #10 → nothing played for #10. Auto-advance #10 → #11 → #12 then worked. "Is it that it works when it's proceeding automatically but when I do a manual click of the button it doesn't actually kick in?"
2. **Caption ticker too fast, not in sync with the speech** ("makes me at least 50% slower… should be readable and coincide with the actual frames").
3. **Segments sometimes start a few seconds after the highlight's start.**

Code (verify, don't trust):
- `web/components/dashboard/HighlightsScrubber.tsx` — primitives ~L79–91 (`seekTo: setSeekTo`, "setSeekTo already flips isPlaying"), `useSegmentPlayback` call ~L108, ticker markup ~L451–495: the caption is a CSS animation `tickerRTL ${Math.max(6, activeDuration)}s linear infinite` (~L490) — a fixed-rate looping scroll with NO link to playback time (likely cause of 2).
- `web/lib/hooks/useSegmentPlayback.ts` — `playFrom` ~L181–203 (seek to `leadIn = start - contextLead`, `play()`, `setPlayingIdx`), `jumpTo` ~L212, poll ~L229–286: after a seek, the loop returns early until `|currentTime - pendingSeekTarget| <= SEEK_SETTLEMENT_TOLERANCE_SECONDS` (~L247). If a manual seek never "settles" (e.g. `currentPlaybackSeconds` stale because the player was paused, or `seekTo` store value unchanged so `VideoPlayerCard`'s effect never fires), the segment is stuck forever — candidate cause of 1.
- `web/store/useVideoStore.ts` ~L51 `setSeekTo` sets `{seekTo, pendingNav, isPlaying: true}`; `VideoPlayerCard` (find it) consumes `seekTo` and polls `currentPlaybackSeconds` every 250 ms.
- `web/lib/hooks/useHighlightTicker.ts` (+ test) — find how the ticker text/duration is derived; `HighlightsTrackView.tsx` renders the numbered jump buttons (find the handler).

## 2. Contract & Implementation Directives

1. Ledger `[IN_PROGRESS]`. `build-graph`; trace the jump button's onClick → `jumpTo` → `playFrom` → store → `VideoPlayerCard` → YouTube `seekTo`/`playVideo`, and the auto-advance path. Write both chains side by side and mark every difference.
2. **Bug 1 RCA first:** write a failing test in `web/lib/hooks/useSegmentPlayback.test.ts` (or a new file in `web/lib/__tests__/`) that reproduces "manual jump while playing/paused never starts the target segment" with fake primitives. Candidates to test: (a) seek never settles → stuck; (b) `seekTo` to the same numeric value as the last seek doesn't re-fire; (c) jump while `isPaused`; (d) jump while a previous `pendingSeekTarget` is still pending. Fix at the proven cause. Add a settlement TIMEOUT (registry key if a tunable is needed — no hardcoded tunables; follow `highlights.*` keys' pattern) so a seek that never settles can never freeze the reel: after the timeout, proceed from the actual current time and capture a Sentry breadcrumb.
3. **Bug 3:** measure: in the test harness, how far after `segment.start` does elapsed time begin (poll interval, settlement tolerance, contextLead)? Make playback start at `leadIn` exactly as far as the store allows; report what YouTube keyframe seeking can and cannot guarantee.
4. **Bug 2 (ticker):** replace the fixed-rate `linear infinite` CSS scroll with a ticker driven by playback time: the visible caption position = f(`elapsedInSegmentSeconds`, segment duration, text length), no looping, pauses when playback pauses, readable (default speed no faster than ~2.5 words/s; if the segment's text is longer than can be read in its duration, show the current sentence rather than scrolling faster — registry key for the words/s cap). Keep `prefers-reduced-motion` behaviour (static text).
5. Tests: each bug gets a test that fails on `origin/main` and passes with the fix (negative control pasted). Ticker: pure function test for the position mapping (0 → start, duration → end, paused → frozen).
6. Gates, qa-intel after `git add`, commit `fix(highlights): manual jump plays, ticker follows playback, no late start`, ledger `[DONE]`.

Out of scope: visual restyling (a separate system-wide radius change is coming), highlights generation.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Use `docs/agent-prompts/TEMPLATE.md` §3 verbatim (newest list). Re-match SELECT whenever the touched-file set grows. Write "not available in OC" for any skill you cannot invoke — never claim it ran.

---

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```
---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
