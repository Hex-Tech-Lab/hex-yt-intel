# Agent Dispatch Prompt — Shared Markdown Link-Renderer (/simplify finding)

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file; post `[IN_PROGRESS]` with
intent + target files as your first action; re-check the ledger after every
subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
actually happened as your last action.

## 1. Context

`hex-yt-intel` renders LLM-generated dimension/summary markdown content via
Astryx's `<Markdown>` component in two places:
`web/components/dashboard/SelectedDimensionReadout.tsx` (`readoutComponents.link`)
and `web/components/templates/console/ApexSummaryCard.tsx`
(`apexComponents.link`). Both define an identical `link` render-override --
including matching inline comments -- that routes `#t=<seconds>` hrefs
through `TimestampLink` (video-seek links) and applies `target="_blank"`
only to genuinely external `http(s)` links (a real bug fixed earlier
tonight in both places independently, since `ApexSummaryCard.tsx`'s version
was literally copy-pasted from `SelectedDimensionReadout.tsx`).

A mandatory `/simplify` review pass flagged this exact duplication (logged
in `docs/TECH_DEBT_LEDGER.md`, "2026-08-20 — Highlights-reel redesign:
/simplify findings deferred past merge", item 2) -- deferred past that PR's
merge, now being done as its own task.

## 2. Task

Extract the shared `link` component override (and the `heading`/`paragraph`/
`code`/`inlineCode`/`blockquote`/`hr` overrides too, if `ApexSummaryCard.tsx`
turns out to need the same full set -- check what it currently uses vs.
`SelectedDimensionReadout.tsx`'s full `readoutComponents` object; do not
assume they need identical full component sets, verify by reading both
files) into one shared module, e.g.
`web/components/markdown/dimensionMarkdownComponents.tsx` or a
`createMarkdownComponents()` factory in `web/lib/utils/format.tsx` (this
project's existing home for markdown-processing utilities like
`preprocessMarkdown`/`linkifyTimestamps` -- check whether colocating there
or in a new `web/components/markdown/` module fits this codebase's existing
conventions better, and follow whichever pattern is more consistent with
how this repo already organizes shared UI-adjacent logic).

Both `SelectedDimensionReadout.tsx` and `ApexSummaryCard.tsx` should import
and use the shared version afterward, with their own file-local
`readoutComponents`/`apexComponents` definitions removed (or reduced to
only whatever styling genuinely differs between the two -- read both
current implementations carefully; `SelectedDimensionReadout.tsx`'s has a
`HEADING_CLASS` map and several other overrides that `ApexSummaryCard.tsx`
may not currently replicate -- do not force-unify things that are
legitimately different, only the parts that are actually duplicated).

## 3. Goal / definition of done

- The `link` override's `#t=` -> `TimestampLink` routing and the
  external-link `target="_blank"` guard exist in exactly ONE place, used by
  both components.
- No visual or behavioral change to either component -- this is a
  deduplication refactor, not a redesign.
- If the two components' full component-override sets turn out to diverge
  meaningfully beyond just `link`, only extract what's genuinely shared;
  don't force an artificial unification that would make one component's
  styling wrong to satisfy the other.

## 4. Expected results

- New shared module (exact location per your judgment call in section 2,
  explain your choice in the report).
- Modified: `web/components/dashboard/SelectedDimensionReadout.tsx`,
  `web/components/templates/console/ApexSummaryCard.tsx`.
- `docs/TECH_DEBT_LEDGER.md`'s corresponding entry (item 2) updated to mark
  this resolved (with commit reference) once verified.

## 5. Task-specific skills/tools/MCPs

- `react-best-practices` if the extraction changes how these components
  memoize or re-render (e.g. make sure the shared components object isn't
  recreated on every render if it doesn't need to be -- it currently isn't,
  in either file, since it's defined at module scope; keep it that way in
  the extracted version too).
- No database/migration involved.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Before touching any code, run `code-review-graph`'s
`build_or_update_graph_tool`, then `get_review_context_tool` scoped to
`web/components/dashboard/SelectedDimensionReadout.tsx` and
`web/components/templates/console/ApexSummaryCard.tsx`, before reading
whole files.

**Branch**: start fresh from `main` (all 3 tonight's PRs are merged). Create
your own branch, e.g. `refactor/shared-markdown-link-renderer`.

**This task's files do NOT overlap with the parallel
`refactor/shared-segment-playback-hook` task** (that one touches
`HighlightsScrubber.tsx`/`PublicHighlightsReel.tsx`/`useHighlightTicker.ts`/
`DashboardContainer.tsx`) -- confirm this stays true; if your investigation
finds a real reason to touch any of those files, stop and flag it rather
than proceeding, since another agent may be concurrently editing them.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** State the shared component's
   exact prop/export shape before writing it. Check both call sites against
   that contract after.
2. **E2E cycle complete.** Render both components with real markdown
   content containing a `#t=` link and an external `http(s)` link (a
   Playwright-driven isolated repro, matching the pattern already used
   earlier tonight for this exact bug -- read the git history/commit
   messages around the original external-link fix for the established
   repro approach) and confirm both still behave identically to before your
   change.
3. **Tangent hunt.** While reading both files, note whether any OTHER
   duplicated logic exists between them beyond the `link` override --
   report even if not fixed this pass.

## 8. Report format — [ALWAYS INCLUDE]

RCA → Contract → Fix → E2E proof (live-rendered proof, not just "looks
right in the diff") → Tangents found → Deviations flagged (if any) → Skills
run + findings → Gates (exact output) → Files changed → branch name for CC
to review.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm tsx web/scripts/contract-auditor.ts
```

Do NOT open a PR or merge -- push the branch and report back to CC (the
dispatching session) for 10x verification before anything lands.
