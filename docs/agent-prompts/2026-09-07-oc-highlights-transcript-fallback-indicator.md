# Agent Dispatch Prompt — Highlights transcript line silently falls back to paraphrase, no indicator

**Target Agent**: OC (OpenCode, glm-5.3-flash)
**Effort Level**: low

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

---

## 1. Context & Problem Statement

Live user report (2026-09-07): the "transcript line" shown under the Highlights
Reel (the caption-style text synced to the active highlight segment) sometimes
displays a paraphrased/summarized one-liner instead of the verbatim spoken
transcript, and the user is unsure whether this is intentional. Previously
this line showed the exact transcript text.

Root cause, already confirmed via code investigation this session — this is
NOT a wrong-data-source bug, it's a **silent fallback with no visual
indicator**:

- `web/components/dashboard/HighlightsScrubber.tsx:284` (verbatim caption)
  and `:298` (ticker) both do:
  ```tsx
  {activeSegment.verbatimExcerpt || activeSegment.label || 'No transcript excerpt available.'}
  ```
- `web/lib/hooks/useHighlightTicker.ts:39-42`:
  ```ts
  const text = verbatimExcerpt || label;
  ```
  where `label` is the LLM-synthesized one-liner and `verbatimExcerpt` is the
  real transcript-sourced text.
- `verbatimExcerpt` is populated by `buildVerbatimExcerpt()` in
  `web/lib/prompts/highlights-reconciliation.ts:100-110`, called from
  `web/lib/usecases/ExtractHighlightsUseCase.ts:241`, which filters actual
  transcript segments by the highlight's time window — genuinely sourced
  from raw transcript when it works.
- **The gap**: `verbatimExcerpt` can be `null`/empty for (a) older
  `analysis_highlights` rows that predate this column being populated, or
  (b) any highlight where `buildVerbatimExcerpt()` finds no transcript
  segments overlapping its time window (e.g. a transcript gap, or a
  highlight's timestamps not matching real segment boundaries closely
  enough). In both cases, all 3 read sites above silently fall back to
  `label` with **zero visual distinction** — the user has no way to tell
  they're looking at a paraphrase instead of the real transcript.

## 2. Contract & Implementation Directives

**Contract**: whenever the transcript-line display is showing `label`
(paraphrase) instead of `verbatimExcerpt` (real transcript), that must be
visually indicated to the user — do not silently pass off a paraphrase as
verbatim text. This is a UI-truthfulness fix, not a data-pipeline fix (the
`buildVerbatimExcerpt()` matching logic itself is out of scope for this
dispatch unless step 1 below finds something clearly wrong with it worth
a one-line fix — if it's a bigger fix, stop and report it separately rather
than scope-creeping this dispatch).

**Implementation approach**:
1. First, quantify the actual gap: for a handful of real `analysis_highlights`
   rows (check via a read-only query against the dev/staging DB if you have
   access, otherwise via existing test fixtures), what fraction have a null/
   empty `verbatimExcerpt`? This tells you whether this is rare-edge-case or
   common — report this number regardless of what you find.
2. In all 3 render sites (`HighlightsScrubber.tsx:284`, `:298`, and
   `useHighlightTicker.ts:39-42` and its consumer), when falling back to
   `label`, render a small, unobtrusive indicator (e.g. an italic style, or
   a tiny "(summarized)" tag / tooltip icon) so the user can tell the
   difference. Match the app's existing tooltip/badge conventions — look at
   `web/components/templates/_shared/primitives.tsx`'s `Tooltip` component
   (already used elsewhere in this codebase, e.g. `ChapterChip`) for the
   established pattern rather than inventing a new one.
3. Do NOT change which text is preferred (verbatim-first is correct) — only
   make the fallback visible when it happens.
4. Add/update a test proving: when `verbatimExcerpt` is null, the fallback
   indicator renders; when it's present, no indicator renders. Check for an
   existing test file near `HighlightsScrubber.tsx` and extend it.

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

This touches `web/components/**` and `web/lib/hooks/**` — run: `qa-intel`
(both `--mode diff` and `--mode full`), `code-reviewer`, `simplify`,
`review-delta`, `review-duplication`, `contract-auditor`,
`react-best-practices`, `web-design-guidelines`.

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```
Run every command's exit code directly (redirect to a file, `echo "EXIT: $?"`
with NO pipe in between) — never trust `$?` after piping through `tail`/
`grep`/`head`.

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Do NOT open a PR or push — commit locally on a new branch
`fix/highlights-transcript-fallback-indicator` and report back with the
branch name and diff summary for review before anything is pushed.
