# Agent Dispatch Prompt — Chat citation links unclickable inside markdown tables

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

The chat assistant in this app (hex-yt-intel) answers questions with citations
formatted as a two-column Markdown table: `| Timestamp | Point |`, e.g.
`| 12:10–12:45 | Cites Sky News Arabia on Houthi-Iraqi coordination |`. These
timestamp cells used to be clickable — clicking one seeks the embedded YouTube
player to that time. A live user report (2026-09-07) confirms they are now
plain unclickable text.

Root cause, already confirmed via code investigation this session:
- `web/lib/utils/format.tsx:207-264` — `linkifyTimestamps()` runs correctly
  (called via `preprocessMarkdown` at `format.tsx:153`) and converts
  `00:48`/`01:16`-style text into markdown links `[⏱ 00:48](#t=48)`.
- `web/components/templates/console/ChatDock.tsx:121-131` — a custom
  `chatMarkdownComponents.link` override renders any `href` starting with
  `#t=` as a clickable `TimestampLink` component instead of a plain `<a>`.
- **The gap**: `ChatDock.tsx` around line 107-119 has a comment explicitly
  documenting that Astryx's `Markdown` component has "no table/list component
  override slots" — so when the linkified `[⏱ 00:48](#t=48)` markdown link
  lands inside a **table cell** (which is exactly where every citation link
  lives, since citations are rendered as table rows), Astryx's built-in table
  renderer displays it as plain unstyled text or a bare `<a>`, never routing
  through the `link` override that makes `TimestampLink` work. Outside tables
  (e.g. a link in a normal paragraph), the same linkified markdown renders
  correctly and is clickable.

So: the linkification data pipeline is intact. The bug is specifically that
Astryx's table renderer doesn't apply the app's custom link component to
links inside table cells.

## 2. Contract & Implementation Directives

**Contract**: every timestamp citation link `[⏱ HH:MM](#t=SECONDS)` — whether
it appears inside a Markdown table cell or in plain prose — must render as a
clickable element that calls the same seek behavior as `TimestampLink`
(check `web/components/templates/console/ChatDock.tsx` for how `TimestampLink`
triggers a seek — likely via `useVideoStore.setSeekTo` or similar; grep for
`TimestampLink` definition to confirm its exact seek mechanism before
touching anything).

**Implementation approach** (do this in order):
1. Read `web/components/templates/console/ChatDock.tsx` in full, especially
   the `chatMarkdownComponents` object and its `table`/`td`/`tr` overrides
   (if any exist at all — the comment suggests they don't).
2. Read `TimestampLink`'s own definition (likely in the same file or a
   nearby component file) to understand exactly what prop/click-handler it
   needs.
3. Find Astryx's `Markdown` component's actual override API (check
   `node_modules/@astryxdesign/core` or wherever it's imported from — grep
   `from '@astryxdesign` in `ChatDock.tsx`) — does it support a `td`/`table`
   override slot at all? If the comment is accurate and it doesn't, the fix
   is one of:
   - (a) Add a `td`/`table`-cell override IF Astryx's API actually supports
     one (re-verify the comment's claim directly against Astryx's source/
     types before assuming it's still true — libraries get updated).
   - (b) If genuinely no override slot exists, post-process the rendered
     table cell content: after Astryx renders the raw markdown, walk the
     resulting table cells and re-parse any `#t=` href patterns, replacing
     them with `TimestampLink` via a light DOM-scan/replace pass scoped only
     to this chat message container (do NOT do this globally — must not
     affect other markdown consumers in the app).
   - (c) Alternative: change `linkifyTimestamps()`'s table-cell case to NOT
     produce markdown link syntax at all, and instead render citation tables
     as a custom React component (not raw markdown passed to Astryx) that
     the app fully controls — this is a bigger change, only do this if (a)
     and (b) are both genuinely infeasible, and flag the tradeoff in your
     report rather than silently picking it.
4. Pick the smallest correct fix. Do not touch `linkifyTimestamps()`'s
   non-table linkification behavior (plain-prose links) — those already
   work correctly.
5. Add/update a test proving a citation table's timestamp cell is clickable
   and triggers the seek callback — check for an existing test file near
   `ChatDock.tsx` (e.g. `__tests__/ChatDock*.test.tsx`) and extend it rather
   than creating a parallel one.

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

This touches `web/components/**` — run: `qa-intel` (both `--mode diff` and
`--mode full`), `code-reviewer`, `simplify`, `review-delta`,
`review-duplication`, `contract-auditor`, `react-best-practices`,
`composition-patterns`, `web-design-guidelines`.

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
`grep`/`head`, that has caused false "clean" claims in this repo before.

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Do NOT open a PR or push — commit locally on a new branch
`fix/chat-citation-table-links` and report back with the branch name and diff
summary for review before anything is pushed.
