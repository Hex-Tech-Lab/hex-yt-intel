# UI/UX Feedback Triage — 2026-08-20 (Cairo)

Raw feedback from live screenshots this session. Not yet actioned — awaiting sequencing decision. Grouped by launch-blocking severity, not by arrival order.

## P0 — Real bugs, block launch

1. ✅ **FIXED (commit 60da21f6, PR #257).** Dimension 11 (Commercial Yield) table — last column fully broken. Root cause confirmed against live Supabase data: the LLM's table had a 3-column header but 4-column data rows; `preprocessMarkdown`'s repair logic rewrote the delimiter to match the (wrong, short) header instead of the real data width, leaving an unlabeled 4th column with no `table-layout:fixed` width that collapsed to near-zero and wrapped one character per line. Fixed in `web/lib/utils/format.tsx` to derive column count from the widest row and pad the header instead. Live-verified by re-rendering the actual corrupted content through the fix.
2. **Dimension 8 (Semantic Foundation) numbered list — double-digit bullets wrap.** Once item numbers hit 10+, the bullet number and the dot get pushed onto their own line, dot dangling before the text starts on the next line. Numbered-list column needs to reserve width for 2-digit indices (this is the common case since the pipeline asks for 15-20 items).
3. **Chat composer focus ring wraps the wrong element.** `:focus-within` currently highlights an outer container box, not the rounded input itself — looks broken/ridiculous per two screenshots. Fix: move the focus ring to the actual rounded-rect input element. While in there, reduce the border-radius slightly to match the rest of the design system (user: "a little less rounding").
4. **Timestamp mentions in dimension text aren't visually marked as links.** Currently plain text, indistinguishable from surrounding prose — user can't tell it's clickable. Needs an accent color (blue/accent) + underline + a colored icon, consistent with a prior working version that apparently regressed. Needs to be located across all dimension renderers, not just one.

## P1 — Real feature gap, not just polish

5. **Highlights reel placement wrong.** Currently rendered underneath Executive Summary / Video Intelligence Context. Must move to directly under the video player.
6. **Highlights reel over-compresses content.** Current run: 9 keypoints, 1m30s of 15m39s (~10%). User's explicit instruction: there is **no fixed target percentage** — highlight selection must be a best-effort capture of every genuinely important point the video contains, even if that's 40 points needing 60% of runtime. Don't cap toward an arbitrary 10-20% budget.
7. **Highlights reel ↔ chat "key points" answers disagree.** Asking chat "give me the most important key points with timestamps" returned only 5 points, independent of and inconsistent with the highlights reel's 9. These need a shared source of truth (or at minimum, a documented reason they can differ) — right now they're two isolated islands giving contradictory answers to the same underlying question.
8. **Highlights reel UI regressed from an earlier, better version.** User explicitly recalls a previous player with marker/timeline UI (yellow markers on a scrubber) that has since been removed/replaced. Needs to be found (git history) and restored/built forward, not reinvented from scratch. Target design per user's description:
   - Static preview of next 5-10 words of script before playing; ticker-style reveal of the script text while that segment plays.
   - "Segment N / Total" indicator (e.g. "3/27").
   - Prev/Next controls to jump between highlight segments.
   - Playback speed control (0.5x-3x).
   - Top-right keypoint count / total-duration / percent indicator (already correct, keep as-is).
   - Yellow markers on the underlying video scrubber/timeline showing where each highlight segment falls.

## P2 — Deferred, explicit user instruction

9. **KG / WordCloud / MindMap rendering issues** (monochrome purple, oversized/overlapping text in Mind Map nodes, KG legend shows 5 entity-type colors but graph renders in one color). Root cause candidate: content is being classified almost entirely as `object` type (visible in KG legend swatch matching WordCloud's purple), which is itself the deeper problem — user's real complaint is that entity typing (person/org/location/event/object) is not the valuable signal; it's a distraction from what should actually be highlighted. User explicitly said **not now** — "once you have the time" — but flagged as launch-relevant eventually and previously considered dropping KG entirely if not fixed. Also noted: renders correctly roughly 1-in-2 times, inconsistent across identical reloads — a real intermittent/race bug on top of the coloring issue, not just a style problem.
   - **Sub-finding, 2026-08-20:** the KG is also surfacing the 11 dimension section headers themselves as graph nodes — literally "APEX INTELLIGENCE (concept)", "PROVENANCE, METADATA & VIRALITY PROFILE (concept)", "CONTENT ARCHITECTURE & FIRST PRINCIPLES (concept)", etc., all 11 dimension titles, each tagged `(concept)`. These are structural section headings from the analysis output, not real extracted entities — likely the KG/entity extraction pass (or its client-side TF-IDF fallback, ADR 023) is treating dimension heading text as candidate entity spans instead of excluding headings from the extraction source text. Grouped with item 9, still parked, but this is a concrete, scoped sub-bug (probably a filter/exclusion-list fix at the extraction boundary) worth tackling first whenever KG work resumes — likely cheaper than the coloring issue and may reduce the "everything is `object`" noise too, since heading phrases would otherwise get dumped into the least-specific type bucket.
10. **Highlights-reel chapter-transition polish (explicitly deferred by user as a later marketing feature, not this pass):** brief fade-to-black + logo/watermark bump between highlight segments (~1s black, ~1s fade-in) for brand presence when content is shared/recorded. User suggested a possible round toggle button near the speed control to opt in/out. Log only — do not build without explicit go-ahead.

## Not yet investigated

- Whether items 4 (timestamp-link styling) and 7 (chat/highlights consistency) share a root cause with each other or with the TestSprite-discovered `Invalid appUrl callback destination` local-dev gap — unrelated on current evidence, no shared code path found.

---

**Recommended sequencing (my read, not yet confirmed with user):** P0 items 1-4 first (small, isolated CSS/rendering fixes, each independently testable, no design decisions needed). Item 5 (reposition highlights reel) is a one-line layout move, bundle with P0. Items 6-8 (highlights reel redesign + cap removal + chat/reel consistency) are a real multi-file feature project — needs its own scoped PR, likely its own design pass, and touches the segment-selection algorithm (not just UI). Item 9 stays parked per explicit instruction.
