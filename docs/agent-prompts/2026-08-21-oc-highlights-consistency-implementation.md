# Agent Dispatch Prompt — OC (opencode, glm-5.2:free, low effort) — Highlights/Chat/Digest Consistency IMPLEMENTATION

**Dispatch type: REAL CODE CHANGES + MIGRATION + PR. This is the implementation
phase, following two prior investigation/design-only dispatches. The design is
fully reviewed and approved — do not re-derive or second-guess the design
decisions below, implement them exactly as specified.**

The complete, reviewed design lives in
`docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
(your own prior work, in two rounds — read it in full before starting, it has
all field shapes, exact prompt text, and code snippets already written out).
This dispatch tells you WHAT to build, in WHAT ORDER, from THAT doc — follow
it literally, numbered step by numbered step.

---

## Model-tuning note for you, OC

You are a low-effort flash-tier model. This is a large, multi-file task —
execute the numbered steps below IN ORDER, one at a time, verifying each step
compiles/typechecks before moving to the next. Do not batch all file edits
and then check at the end — that makes failures hard to localize. After each
numbered step, run `pnpm --filter @hex-yt-intel/web exec tsc --noEmit` and
fix any new error before proceeding to the next step.

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action.

## 1. Context

hex-yt-intel / vIntel. Three prior dispatches this session (all yours):
1. Investigation + initial design proposal (highlights segment-length,
   digest/chat/highlights consistency, verbatim transcript).
2. Design revision adding the 2.B.6 reconciliation loop (closes the
   "digest shows ungrounded takeaways" gap).
3. THIS dispatch: build it.

Read `docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
in full. It contains, verbatim, ready to use: the exact new prompt text for
`highlights-extraction.ts` (§2.A.1), the exact parser validation logic
(§2.A.2), the exact playback clamp code (§2.A.3), the exact visual-fill code
(§2.A.4), the Settings Registry key table (§2.A.5), the exact reconciliation
system prompt + user message format (§2.B.6 Step 3), the exact
`HIGHLIGHTS_RECONCILIATION_CASCADE_FALLBACK` code (§2.B.6 Step 2), the exact
`buildVerbatimExcerpt()` function (§2.C.1), and the exact migration SQL
(§4's "Migration SQL" block + §2.C.2's `verbatim_excerpt` column). Use that
text directly — do not re-derive or paraphrase it.

## 2. Task — build in this exact order

**IMPORTANT — worktree isolation**: You are running in an ISOLATED git worktree
at `.claude/worktrees/highlights-consistency`, on branch
`fix/highlights-chat-digest-consistency` (already created and checked out —
do NOT run `git checkout -b` again, you're already on it). `pnpm install`
has already been run in this worktree. There is a SEPARATE OC dispatch
running concurrently in the main checkout (a legal-docs fix, unrelated
files) — you do not need to coordinate with it, your worktree is isolated,
just don't `cd` out of `.claude/worktrees/highlights-consistency` for any
git operation.

**Branch**: `fix/highlights-chat-digest-consistency` (already checked out in
your worktree).

### Step 1 — Settings Registry migration (§2.A.5)
New migration file adding `highlights.minSegmentDurationSeconds` (default 5,
min 2, max 15) and `highlights.maxSegmentDurationSeconds` (default 60, min
30, max 300) to `app_settings`, following the exact pattern of
`supabase/migrations/20260813222120_highlights_reel_settings_registry.sql`.
Apply via Supabase MCP `apply_migration`, then IMMEDIATELY run
`list_migrations` and rename your local file to match the server-recorded
version exactly (per ADR 018 in the project's CLAUDE.md — do not skip this,
it has caused real CI breakage before). Run
`pnpm exec supabase db push --dry-run` and confirm it reports the remote as
up to date.

### Step 2 — `analysis_highlights` schema migration (§2.C.2 + §4)
New migration: `alter table public.analysis_highlights add column if not
exists takeaway_idx smallint; add column if not exists verbatim_excerpt
text;` PLUS update `replace_analysis_highlights` RPC (exact SQL in §4's
"Migration SQL" block) to accept and insert both new fields from the JSON
payload. Same apply/rename/dry-run verification as Step 1. Verify grants:
`select grantee, privilege_type from information_schema.routine_privileges
where routine_name = 'replace_analysis_highlights'` — confirm no
unintended EXECUTE grant to `anon`/`authenticated` (this RPC should remain
`security definer`, service-role-only, matching its existing pattern before
your change — do not introduce a new grant gap).

### Step 3 — `web/lib/config/cascade.ts`
Add `HIGHLIGHTS_RECONCILIATION_CASCADE_FALLBACK` (exact code in design doc
§2.B.6 Step 2), add it to `CASCADE_FALLBACKS`, add
`resolveHighlightsReconciliationCascade()`. Typecheck.

### Step 4 — `web/lib/utils/highlights-settings.ts`
Add `minSegmentDurationSeconds`/`maxSegmentDurationSeconds` to
`HIGHLIGHTS_REGISTRY_FALLBACK`, following the existing pattern for
`segmentDurationSeconds`/`maxCount`/`maxOutputTokens` already there.
Typecheck.

### Step 5 — `web/lib/prompts/highlights-extraction.ts` (§2.A.1, §2.A.2, §2.B.2, §2.C.2)
All in one file, in this order:
1. Update `buildHighlightsExtractionSystemPrompt()`: redefine `end`
   semantics (exact new prompt text in §2.A.1), add `maxSegmentDurationSeconds`
   param injected into the prompt, add the takeaways-mapping instruction
   (§2.B.2's system prompt addition, with the `takeawayIdx` field
   instruction).
2. Update `buildHighlightsExtractionUserMessage()`: accept an optional
   `takeaways?: string[]` param (§2.B.2), prepend the `--- KEY TAKEAWAYS ---`
   section when provided.
3. Update `ExtractedHighlight` interface: add `takeawayIdx: number | null`
   and `verbatimExcerpt: string`.
4. Update `parseHighlightsExtraction()`: relax the `end` constraint per
   §2.A.2 exactly (`start` stays validated against `validSegmentStarts` —
   DO NOT relax that one, only `end`), add the new
   `minSegmentDurationSeconds`/`maxSegmentDurationSeconds` params and
   validation, parse `takeawayIdx` from the LLM response (nullable number).
   `verbatimExcerpt` is NOT parsed from the LLM — it's computed separately
   in Step 7 via `buildVerbatimExcerpt()`.
Typecheck after this file.

### Step 6 — New file `web/lib/prompts/highlights-reconciliation.ts` (§2.B.6 Step 3)
`buildHighlightsReconciliationSystemPrompt()`,
`buildHighlightsReconciliationUserMessage(takeaways, highlights)`,
`parseHighlightsReconciliation(rawText, takeawaysCount)` — exact prompt
text and parser contract (`'invalid'` vs `'ok'` distinction, same pattern
as `highlights-extraction.ts`) from §2.B.6 Step 3. Also add
`buildVerbatimExcerpt(start, end, segments)` here or as a small standalone
exported helper (§2.C.1's exact function) — your call on file placement,
just make sure it's exported and typed. Typecheck.

### Step 7 — `web/lib/usecases/GenerateExecutiveDigestUseCase.ts`
1. Pass `digest.takeaways` into `buildHighlightsExtractionUserMessage()`
   in `extractHighlights()` (§2.B.1-2.B.2).
2. Pass the new `minSegmentDurationSeconds`/`maxSegmentDurationSeconds`
   registry values into `parseHighlightsExtraction()` (already fetching
   the registry in this method — extend the existing `getRegistrySettings`
   call, don't add a second one).
3. Compute `verbatimExcerpt` per highlight via `buildVerbatimExcerpt()`
   using the already-fetched `segments` array (§2.C.1) before calling
   `saveHighlights()`.
4. After `saveHighlights()` succeeds, add the reconciliation step (§2.B.6
   Step 1, Step 6): call `resolveHighlightsReconciliationCascade()`, build
   the reconciliation prompt via Step 6's new functions, call `complete()`,
   parse with `parseHighlightsReconciliation()`. On `'ok'`, persist
   `reconciliation` into `executive_digest.reconciliation` via an UPDATE
   on the same analysis row (NOT saveExecutiveDigest again — a targeted
   jsonb field update, avoid clobbering other digest fields written
   concurrently). On `'invalid'` or any thrown error, `console.warn` and
   leave `reconciliation` unset — same `.catch()` fail-open pattern already
   used for `extractHighlights()` itself (§2.B.6 Step 6). Do NOT run
   reconciliation if `extractHighlights` itself returned no valid highlights
   (§2.B.6 Step 6's exact rule).
Typecheck after this file — this is the most complex single-file change,
re-read the whole modified method once done and check it against §2.B.6
Step 8's E2E data-flow trace before moving on.

### Step 8 — Types: `StoredExecutiveDigest` (wherever it's defined — grep for it)
Add `ReconciledTakeaway`, `ReconciliationResult` interfaces (exact shape in
§2.B.6 Step 5) and `reconciliation?: ReconciliationResult | null` field.
Typecheck.

### Step 9 — `web/lib/adapters/SupabaseAnalysisAdapter.ts`
1. `getAnalysisGrounding()`: add a query to `analysis_highlights` for the
   analysis (§2.B.3) — `idx, start_seconds, end_seconds, label,
   takeaway_idx`, max `highlights.maxCount` rows. Include the already-fetched
   `executive_digest.reconciliation` field (no new query needed for that
   part, per §2.B.6 Step 5 — just type/pass it through).
2. `saveHighlights()`: pass `takeawayIdx`/`verbatimExcerpt` in the RPC
   payload to `replace_analysis_highlights` (§2.C.4).
Typecheck.

### Step 10 — `web/lib/usecases/ProcessChatMessageUseCase.ts`
Insert a `--- HIGHLIGHTS REEL ---` section into the grounding string
assembly (§2.B.3 — placement: after `--- DIMENSION 0: EXECUTIVE DIGEST ---`,
before `--- TOP COMMENTS ---`), annotate digest takeaways with `grounded`
status from `reconciliation`, annotate highlights with which takeaway they
back. Exact format examples in §2.B.3 and §2.B.6 Step 5. Typecheck.

### Step 11 — `web/lib/hooks/useSegmentPlayback.ts` (§2.A.3)
Replace the fixed-`segmentDurationSeconds` advance clamp with
`Math.max(minSeg, Math.min(maxSeg, segment.end - segment.start))` — exact
code in §2.A.3. Update the stale comment on lines ~55-58 that currently says
"the clamp always uses each segment's own end" (§Tangent #1 from the design
doc — fix it now since you're editing this exact logic). Needs new
`minSegmentDurationSeconds`/`maxSegmentDurationSeconds` params threaded
through from both call sites (`HighlightsScrubber.tsx`,
`PublicHighlightsReel.tsx`). Typecheck.

### Step 12 — `web/components/dashboard/HighlightsTrack.tsx` (§2.A.4)
Update the visual fill width, end-bracket position, and tooltip time range
to use `end - start` clamped to min/max (exact code in §2.A.4), instead of
the current fixed `segmentDurationSeconds`. Fix the self-contradictory
comment at lines ~235-246 (Tangent #2) that currently describes the old
broken `end` semantics. Add `verbatimExcerpt?: string | null` and
`takeawayIdx?: number | null` to `HighlightsTrackHighlight` (§2.C.4).
Typecheck.

### Step 13 — `web/components/dashboard/HighlightsScrubber.tsx`
1. Fix `totalHighlightsSeconds` (§Tangent #3) to sum each highlight's own
   clamped `(end - start)` duration instead of `count * fixedDuration`.
2. Add `verbatimExcerpt?`/`takeawayIdx?` to the local `Highlight` interface
   (§2.C.4).
3. Pass `activeHighlight?.verbatimExcerpt ?? activeHighlight?.label` to
   `useHighlightTicker` (§2.C.4) instead of just `label`.
Typecheck.

### Step 14 — `web/lib/hooks/useHighlightTicker.ts` (§2.C.3)
Add optional `verbatimExcerpt?: string | null` param, prefer it over
`label` when non-empty (exact code in §2.C.3). Typecheck.

### Step 15 — `web/app/api/analyses/highlights/route.ts` (§2.C.4)
Map `verbatim_excerpt` → `verbatimExcerpt` and `takeaway_idx` →
`takeawayIdx` in the response shape. Typecheck.

### Step 16 — `web/app/share/[token]/PublicHighlightsReel.tsx` (Tangent #4)
Mirror Step 11's `useSegmentPlayback` min/max param wiring (this component
uses the same shared hook) and Step 12's visual-fill change if this
component renders its own track fill (check whether it reuses
`HighlightsTrack` or has its own — if it reuses `HighlightsTrack`, this may
already be covered by Step 12; verify, don't assume). Typecheck.

### Step 17 — Test files
Update `web/components/dashboard/HighlightsTrack.test.tsx` and any other
existing test that constructs a `Highlight`/`ExtractedHighlight` object —
they'll now need `takeawayIdx`/`verbatimExcerpt` fields or the new
`minSegmentDurationSeconds`/`maxSegmentDurationSeconds` props, depending on
what each test actually renders. Run the FULL suite (Step 18) to find every
break, don't guess which tests need updates.

### Step 18 — Full gate run + PR
Run ALL of section 9's gates. Fix everything red. Then:
1. `git push -u origin fix/highlights-chat-digest-consistency`
2. `gh pr create` — invoke the `/pr-review-workflow` skill for the PR body
   format and to trigger the external tool stack (Cubic/CodeRabbit/Snyk/
   DeepSource/CI/Vercel/CodeQL).
3. Do NOT merge. CC will wait for real external tool results and do the
   final verification/merge per the standing "no --admin-merge immediately"
   rule.

## 3. Goal / definition of done

A PR is open on `fix/highlights-chat-digest-consistency` implementing all
18 steps above, all gates green, ledger updated, PR description cites the
design doc and summarizes the change per `/pr-review-workflow`'s format.
NOT merged — that's CC's job after real external review lands.

## 4. Expected results

- 2 new migrations, applied + verified per ADR 018.
- 1 new file (`highlights-reconciliation.ts`).
- ~15 modified files per the design doc's Appendix table.
- All tests passing, tsc clean (web + worker), qa-intel `--ci --compare`
  clean, contract-auditor clean.
- Open PR, not merged.

## 5. Task-specific skills/tools/plugins/MCPs

- **`code-review-graph` MCP**: Step 0, before any file read, per this
  project's CLAUDE.md mandate.
- **`supabase-postgres-best-practices`**: applies to Steps 1-2 (migrations).
  The REVOKE/grant sub-check in §5's mandatory checklist applies to
  `replace_analysis_highlights` (Step 2) since you're modifying an existing
  `security definer` function.
- **`owasp-top-10`**: applies — this adds a new LLM call path
  (reconciliation) and a new external data flow into chat grounding. Check
  for prompt-injection surface (takeaways/highlights text is LLM-generated
  from the transcript, not raw user input, but verify the reconciliation
  prompt doesn't create a new injection vector via crafted video titles/
  transcript content feeding back into a privileged prompt).
- **`react-best-practices`**: applies to Steps 11-14 (hooks/components).
- **CORE**: `qa-intel` (diff + full), `contract-auditor`, `/simplify` —
  mandatory, run per `/pr-review-workflow`'s process, not skipped because
  this is a big diff.

## 6. Fixtures

Read the design doc (already stated above) plus:
`web/lib/prompts/highlights-extraction.ts` (current state, before your
edits), `web/lib/hooks/useSegmentPlayback.ts`, `web/components/dashboard/
HighlightsTrack.tsx`, `web/components/dashboard/HighlightsScrubber.tsx` —
all already read and cited with exact line numbers in the design doc, but
re-read the LIVE current versions yourself before editing (they may have
shifted since the design doc's citations if any other change landed on
main in between — check `git log --oneline -5` on each file first).

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
> partial fix under a "done" label.**

For THIS dispatch: tenet 2 means verify the E2E chain live where feasible —
e.g. run `extractHighlights()`'s new logic against a real analysis (if a
seeded fixture/test DB row is available) and confirm a real `analysis_
highlights` row has non-null `verbatim_excerpt`/`takeaway_idx`, and that
`executive_digest.reconciliation` is populated, via a live Supabase query —
not just "the code compiles and the unit test mocks return the right shape."
If no live E2E path is feasible in your environment, say so explicitly as a
deviation, don't claim it was done.

## 8. Report format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates (exact output) → Files changed. CC independently
> re-verifies every claim against real code and real system state before
> accepting — a report claiming "done" without this structure, or without
> E2E proof, will be rejected and sent back.

## 9. Gates — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS
pnpm tsx web/scripts/contract-auditor.ts
```

All must pass before opening the PR in Step 18.
