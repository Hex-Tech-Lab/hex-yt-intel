# Agent Dispatch Prompt — Highlights-Reel Loader Visual Consistency

**Target Agent**: AGY (Flash 3.8)
**Effort Level**: low

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]
> Follow `AGENTS.md` §5 in full — canonical version. Read `.memory/AGENT_LEDGER.md` and `.memory/ADRS.md` first; post `[IN_PROGRESS]` with intent + target files as your FIRST action; re-check the ledger after every subtask; post `[DONE]`/`[PARTIAL]` with a real summary as your LAST action. Use `[NOTE for OC]`/`[ACK]`/`[DISPUTE]` flow for cross-agent corrections. Do NOT commit — leave changes uncommitted in the working tree (OC collects them; same-checkout discipline: check `git status`/`git diff` per-file before finishing so your diff contains ONLY your files).

## Model-tuning rule
Small, single-file-class cosmetic task → one dispatch; execute the numbered steps literally, in order.

## 1. Context & Problem Statement
User (Kelly) reports the highlights-reel loading state renders as a circular spinner (rotating glyph / hourglass), while every other loading surface in the Synthesis Console (the accordion chips and the accordion control) uses a **revolving border highlight** effect. The highlights loader must be visually consistent with the accordion's effect. (Standing user instruction: "cosmetically, it has to spin in the same way like the accordion below it.")

## 2. Contract & Implementation Directives
1. Find the highlights-reel loading state: search `web/components` for the highlights reel / generator-progress loading UI (`grep -rn "generator-progress\|Generating highlights\|highlights" web/components web/lib --include="*.tsx" -l`), likely `web/components/templates/console/VideoPlayerCard.tsx` or the highlights card organism.
2. Find the accordion chip/control loading effect (`grep -rn "accordion\|Accordion" web/components --include="*.tsx" -l`), identify its exact revolving-border CSS (border animation, `animate-*`, pseudo-element rotation, or CSS var token).
3. Replace the highlights loader's circular spinner with the SAME revolving-border effect: identical animation class/keyframes, identical color tokens (CSS vars, no hardcoded hex), identical sizing conventions (Tailwind utility classes consistent with the accordion).
4. Do NOT touch any logic (fetching, state, persistence) — visual swap only.
5. Zero hardcoded colors; use the project's existing CSS var tokens copied from the accordion implementation.

### Skills Run + Findings (mandatory section in your report)
- `react-best-practices` (component touched), `web-design-guidelines` (visible UI), `composition-patterns` if props change (avoid if possible — zero-prop-change swap preferred).

## 3. Three Tenets (numbered, scoped)
1. Contract: same visual language as accordion chips — same animation, same tokens; zero logic or prop-API changes.
2. E2E: run `pnpm --filter @hex-yt-intel/web type-check` and `pnpm --filter @hex-yt-intel/web exec vitest run -- --run <touched-component-test-file>` — must pass.
3. Tangent hunt: while in the file, flag (do NOT fix) any other circular-spinner loaders you find — report as a list for OC to log.

## 4. Verification & Quality Gates
```
pnpm --filter @hex-yt-intel/web type-check
pnpm --filter @hex-yt-intel/web lint
```
No commit. No push. Leave working-tree changes only.

## 5. Report Format
RCA (which file/class had the circular spinner, which class the accordion uses) → Fix (diff summary) → Gates (paste tsc/lint output tails) → Tangents found → Files changed. Post to the ledger per §0.
