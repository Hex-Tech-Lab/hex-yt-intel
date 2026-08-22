# Agent Dispatch — PR #267 Remediation (highlights-chat-digest-consistency)

Built from `docs/agent-prompts/TEMPLATE.md`. CC (Claude Code) is the sink
orchestrator and will independently re-verify every claim against real code
and real gate output before accepting this report. You are OpenCode
(openrouter/meta/muse-spark-1.2-contributor), executing in the git worktree
at `.claude/worktrees/highlights-consistency` on branch
`fix/highlights-chat-digest-consistency` (HEAD `d77f56f1`).

## 0. Ledger protocol — [ALWAYS INCLUDE]

> Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version. Read `.memory/AGENT_LEDGER.md` AND
> `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary as your
> last action; use `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` for cross-agent
> corrections. CC has already posted a `[SINK: PR #267 Remediation]` entry —
> append your own `[IN_PROGRESS]` sub-task line beneath it, do not edit CC's.

## 1. Context

hex-yt-intel is a YouTube intelligence platform (Next.js App Router web app +
Cloudflare Worker). PR #267 ("fix(highlights): reconcile digest takeaways
with highlights and transcript grounding") adds: (a) a post-extraction LLM
reconciliation pass mapping executive-digest takeaways to extracted highlights,
(b) verbatim transcript excerpts + `takeawayIdx` threaded through the stack,
(c) Settings-Registry-driven min/max segment-duration clamps replacing the old
fixed `segmentDurationSeconds`, (d) a `--- HIGHLIGHTS REEL ---` chat-grounding
section, (e) two Supabase migrations.

CI is UNSTABLE: the **Lint** job fails because `verify-quality-engine.ts --ci
--compare` finds 5 new issues in `highlights-reconciliation.ts`; **CodeFactor**
fails on `row: any`; **Pipeline Status** is the aggregate failure. CodeRabbit
posted 21 actionable inline comments (state: CHANGES_REQUESTED) — several are
data-loss / false-grounding / incomplete-core-feature severity. Web type-check
is clean; unit tests 103 files / 1259 passed / 16 skipped (verified locally by
CC). The worker `tsc -p tsconfig.typecheck.json` shows 5 pre-existing errors in
`web/lib/prompts/factory.ts` + `web/lib/types/dimension.ts` (missing
`@lib/...` alias resolution) that are NOT in this PR's diff and pass in CI —
they are a local worktree-install artifact; ignore them, do not "fix" them.

All line numbers below were verified by CC against HEAD `d77f56f1` on
2026-08-23. CodeRabbit's proposed diffs were checked against the real code and
are accurate; reuse them.

## 2. Task

Execute the phases below IN ORDER. Each step is literal. Do NOT paraphrase
contracts. Make minimal changes. After each phase, run the gates in §9 before
moving on.

### Phase A — CI unblock (must make Lint + CodeFactor green)

**A1. `web/lib/prompts/highlights-reconciliation.ts` — fix the 5 quality-engine
issues (this is THE Lint blocker):**
- L59: `.map((t, i) => …)` → `.map((takeaway, index) => …)` (use `index+1` and
  `takeaway` in the template).
- L63: `.map((h, i) => …)` → `.map((highlight, index) => …)` (use `index`,
  `highlight.start`, `highlight.end`, `highlight.label`, `highlight.takeawayIdx`).
- L82-86: the `catch {` (empty) → `catch (parseError) { console.warn('[highlights-reconciliation] model response matched a JSON-array shape but failed to parse:', parseError instanceof Error ? parseError.message : String(parseError));` then the existing `return { status: 'invalid' };`.
- L122-123: `.filter((s) => …).map((s) => …)` → `.filter((segment) => …).map((segment) => …)` (use `segment.start`, `segment.text`).

**A2. `web/lib/adapters/SupabaseAnalysisAdapter.ts` — replace `row: any`
(CodeFactor, lines 633 + 642).** This is bundled with B5 (error handling) — do
them together in Phase B. The `any` removal: type the map callback row as the
generated Supabase `Database['public']['Tables']['analysis_highlights']['Row']`
type if available via the existing import; otherwise define a local
`type HighlightRow = { idx: number; start_seconds: number; end_seconds: number; label: string; takeaway_idx: number | null; verbatim_excerpt: string | null }`
and annotate `(row: HighlightRow)`.

**A3. `web/app/api/analyses/highlights/route.ts` — replace `row: any` (line 41)
(CodeFactor).** Bundled with B7 (streaming) in Phase B. Same local-type
approach as A2 for the `(data ?? []).map((row: ...) => ...)`.

### Phase B — Data integrity / correctness (merge-blocking)

**B1. `supabase/migrations/20260821120100_analysis_highlights_takeaway_idx_verbatim_excerpt.sql`
— NULL `p_reconciliation` guard (HIGHEST SEVERITY: data loss).** `jsonb_set` is
strict: a SQL NULL `p_reconciliation` makes `jsonb_set(...)` return NULL, so the
`UPDATE` sets the entire `executive_digest` column to NULL — destroying
snapshot/overview/takeaways/detailedSummary for the row. In the
`set_executive_digest_reconciliation` function body (lines 69-77), add an early
guard immediately after `begin`:
```sql
  -- jsonb_set is strict: a NULL p_reconciliation would set the entire
  -- executive_digest column to NULL and destroy the digest payload.
  if p_reconciliation is null then
    return;
  end if;
```
Do NOT change the `security invoker` or the `revoke` line. Do NOT add a
`grant execute to service_role` — the dispatch docs speculated about one, but
service_role bypasses function EXECUTE privileges entirely in PostgREST/Supabase
(RLS + `SECURITY INVOKER` runs as the service role which is not subject to the
function EXECUTE grant), and adding it is unnecessary and out of scope. Leave
the security model exactly as-is.

**B2. `web/lib/prompts/highlights-extraction.ts` — clamp instead of skip
(107-124) + bound `takeawayIdx` (117).** The PR's migration, `highlights-settings.ts`,
and the inline comment all say durations are *clamped* into [min,max], but the
code `continue`s (drops the highlight AND its `takeawayIdx`, so reconciliation
marks that takeaway ungrounded). Replace the duration check (lines 107-112) with
a clamp and use `clampedEnd` in the pushed object (line 124):
```ts
    // Duration clamp: old data with "end = next segment start" could produce
    // very long spans, and a model can return a sub-floor point. Clamp the
    // duration into [min, max] instead of discarding the highlight.
    const duration = end - start;
    const clampedEnd = duration < minSegmentDurationSeconds
      ? start + minSegmentDurationSeconds
      : duration > maxSegmentDurationSeconds
        ? start + maxSegmentDurationSeconds
        : end;
```
Then line 124: `out.push({ start, end: clampedEnd, label: trimmedLabel, takeawayIdx: parsedTakeawayIdx, verbatimExcerpt: '' });`

Bound `takeawayIdx`: add a `takeawaysCount = 0` parameter to
`parseHighlightsExtraction` (signature, ~line 75). Change the `takeawayIdx`
check (line 117) to require `takeawayIdx < takeawaysCount`:
```ts
    if (typeof takeawayIdx === 'number' && Number.isInteger(takeawayIdx) && takeawayIdx >= 0 && takeawayIdx < takeawaysCount) {
      parsedTakeawayIdx = takeawayIdx;
    }
```
Update the call site in `GenerateExecutiveDigestUseCase.ts` (line 230) to pass
`params.takeaways.length` as the new last arg.

**B3. `web/lib/prompts/highlights-reconciliation.ts` — validate each
`takeawayIdx` is a unique integer in [0, takeawaysCount) (89-110).** Today only
`out.length !== takeawaysCount` is checked, so `[0,0,0]` for a 3-takeaway digest
passes. Add a `seenIdx` Set; require `Number.isInteger` + range + uniqueness; sort
by idx at the end. Use CodeRabbit's proposed block (verified accurate):
```ts
  const out: ReconciledTakeaway[] = [];
  const seenIdx = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { takeawayIdx, grounded, backingHighlightIdx } = item as Record<string, unknown>;
    if (typeof takeawayIdx !== 'number' || !Number.isInteger(takeawayIdx)) continue;
    if (takeawayIdx < 0 || takeawayIdx >= takeawaysCount) continue;
    if (seenIdx.has(takeawayIdx)) continue;
    if (typeof grounded !== 'boolean') continue;
    let parsedBackingIdx: number | null = null;
    if (typeof backingHighlightIdx === 'number' && Number.isFinite(backingHighlightIdx)) {
      parsedBackingIdx = backingHighlightIdx;
    }
    seenIdx.add(takeawayIdx);
    out.push({ idx: takeawayIdx, grounded, backingHighlightIdx: parsedBackingIdx });
  }
  if (out.length !== takeawaysCount) return { status: 'invalid' };
  out.sort((left, right) => left.idx - right.idx);
  return { status: 'ok', reconciliation: { takeaways: out } };
```
Also optionally range-check `backingHighlightIdx` against the highlights count
if cheaply available — but only if you can thread `highlightsCount` without a
signature change risk; otherwise leave it (the `grounded:false` path already
nulls it). If you skip this, note it as a deviation.

**B4. `web/lib/ports/ExecutiveDigestPorts.ts` + `highlights-reconciliation.ts`
— dedupe the reconciliation types; type `saveReconciliation`.** `ReconciledTakeaway`
+ `ReconciliationResult` are declared identically in BOTH
`ExecutiveDigestPorts.ts` (78-89) and `highlights-reconciliation.ts` (13-23).
Keep the declarations in `ExecutiveDigestPorts.ts` (the port is the canonical
owner). In `highlights-reconciliation.ts`, DELETE the local `interface
ReconciledTakeaway`/`ReconciliationResult` (lines 13-23) and replace with a
re-export: `import type { ReconciledTakeaway, ReconciliationResult } from '@/lib/ports/ExecutiveDigestPorts'; export type { ReconciledTakeaway, ReconciliationResult };`
(adjust so downstream imports from `./highlights-reconciliation` still resolve).
Change `ExecutiveDigestPorts.ts:74` `reconciliation: unknown` → `reconciliation: ReconciliationResult`.

**B5. `web/lib/adapters/SupabaseAnalysisAdapter.ts` — check the PostgREST
`error`; add Sentry; universal catch (626-647).** PostgREST resolves
`{ data, error }`, it does NOT reject — so the `catch` never runs on a query
failure and the `--- HIGHLIGHTS REEL ---` section is silently dropped with no
Sentry event. Apply (this also fixes the A2 CodeFactor `any`):
```ts
      try {
        const { data: hlData, error: hlQueryError } = await service
           .from('analysis_highlights')
           .select('idx, start_seconds, end_seconds, label, takeaway_idx, verbatim_excerpt')
           .eq('analysis_id', params.analysisId)
           .order('idx', { ascending: true });
        if (hlQueryError) throw hlQueryError;
        if (hlData && hlData.length > 0) {
          highlights = hlData.map((row: HighlightRow) => ({
            idx: row.idx,
            start: row.start_seconds,
            end: row.end_seconds,
            label: row.label,
            takeawayIdx: row.takeaway_idx ?? null,
            verbatimExcerpt: row.verbatim_excerpt ?? null,
          }));
        }
      } catch (hlError: unknown) {
        console.warn('[SupabaseAnalysisAdapter] analysis_highlights query failed:', hlError instanceof Error ? hlError.message : String(hlError));
        Sentry.captureException(hlError, { tags: { method: 'getAnalysisGrounding.highlights' }, extra: { analysisId: params.analysisId } });
      }
```
Add the local `type HighlightRow` (see A2) near the top of the file or inline.
Ensure `Sentry` is already imported in this file (it is — grep `Sentry` to
confirm; if not, import from `@sentry/next` matching the existing pattern in
this file). Add `.limit(<maxCount>)` is NOT required — PostgREST RLS + the
owner scope bound this; skip if no configured maxCount is readily available
(note as deviation if skipped).

**B6. Persistence contracts — keep the highlight fields.**
`SupabaseAnalysisAdapter.getAnalysisGrounding` returns `highlights`, but
`SupabasePersistenceAdapter.getAnalysisGrounding` (line 84) and
`ChatPersistencePort.getAnalysisGrounding` (line 50) declare return types that
OMIT `highlights` (and `executiveDigest` already leaks through `any`). And
`SupabasePersistenceAdapter.saveHighlights` (line 114) types `highlights` as
`Array<{ idx; start; end; label }>` — dropping `takeawayIdx`/`verbatimExcerpt`
that `GenerateExecutiveDigestUseCase` passes (line 252-259).
- Update `ChatPersistencePort.getAnalysisGrounding` (line 50) and
  `SupabasePersistenceAdapter.getAnalysisGrounding` (line 84) return types to
  include `highlights?: Array<{ idx: number; start: number; end: number; label: string; takeawayIdx: number | null; verbatimExcerpt: string | null }> | null`
  (match the shape `SupabaseAnalysisAdapter` already returns — read its return
  block ~655-665 for the exact field set, including `executiveDigest`, and
  mirror it). Keep delegation `return SupabaseAnalysisAdapter.getAnalysisGrounding(params)` unchanged.
- Update `SupabasePersistenceAdapter.saveHighlights` (line 114) `highlights`
  param type to `Array<{ idx: number; start: number; end: number; label: string; takeawayIdx?: number | null; verbatimExcerpt?: string }>`
  (match `AnalysisPersistencePort.saveHighlights` at line 66 which ALREADY has
  these fields — the persistence adapter was the one that dropped them).
- Update `SupabaseAnalysisAdapter.saveHighlights` to actually persist
  `takeaway_idx` and `verbatim_excerpt` columns in the RPC payload (read the
  current `saveHighlights` body; if it already passes them through, just confirm).
- `ProcessChatMessageUseCase` calls `getAnalysisGrounding` via the chat
  persistence port — after this fix `groundingResult.highlights` is typed and
  reachable (it already reads `groundingResult.highlights` at line 378 via
  `any`-typed `groundingResult`; tighten the `groundingResult` type if it is
  currently `any` — search for `let groundingResult` and use the port's return
  type).

**B7. `web/app/api/analyses/highlights/route.ts` — stream the response (Law #3)
+ typed row (A3).** All `web/app/api/**/route.ts` analytical handlers MUST
stream. Wrap the final JSON in a `ReadableStream`: create the stream BEFORE the
Supabase query + settings lookup is awaited is NOT required — the simpler
correct pattern is to do the awaits, then emit the serialized JSON through a
`ReadableStream` and return it with `Content-Type: application/json`. Replace
the final `return NextResponse.json({...})` (lines 40-51) with:
```ts
  const body = JSON.stringify({
    highlights: (data ?? []).map((row: HighlightRow) => ({
      idx: row.idx, start: row.start_seconds, end: row.end_seconds,
      label: row.label, verbatimExcerpt: row.verbatim_excerpt ?? null,
      takeawayIdx: row.takeaway_idx ?? null,
    })),
    segmentDurationSeconds: clampHighlightsSetting(settings['highlights.segmentDurationSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.segmentDurationSeconds'], 3, 30),
    contextLeadSeconds: clampHighlightsSetting(settings['highlights.contextLeadSeconds'], HIGHLIGHTS_REGISTRY_FALLBACK['highlights.contextLeadSeconds'], 0, 10),
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
```
Define `type HighlightRow` locally (same as A2). Keep the `error` check at
lines 30-33. NOTE: CodeRabbit flagged streaming here; CC assesses this is a
real Law #3 requirement for this `route.ts` (it is an analytical GET that
awaits Supabase + settings). Implement it. If the route is genuinely trivial
and you believe streaming adds no value, STOP and flag it as a dispute — do
NOT silently skip.

**B8. `web/lib/usecases/ProcessChatMessageUseCase.ts` — false-grounding +
verbatimExcerpt in chat (364-384).**
- Line 368: `const grounded = rec ? rec.grounded : true;` → `const grounded = reconciliation === null ? true : (rec?.grounded ?? false);`
  When reconciliation EXISTS but `takeaways[i]` is missing, the takeaway must be
  ungrounded, NOT silently grounded. Fail-open applies ONLY when reconciliation
  is absent (old rows / failed call).
- Lines 380-383: the `HIGHLIGHTS REEL` map drops `verbatimExcerpt`. Include it
  with a clear delimiter so the model receives transcript evidence. Change the
  highlight type annotation to include `verbatimExcerpt: string | null` and
  render:
  ```ts
  return `[${formatTimestamp(highlight.start)}–${formatTimestamp(highlight.end)}] ${highlight.label}${takeawayLabel}${highlight.verbatimExcerpt ? ` | excerpt: "${highlight.verbatimExcerpt}"` : ''}`;
  ```

**B9. `web/lib/usecases/GenerateExecutiveDigestUseCase.ts` — check
`saveHighlights()` result + run reconciliation for empty-valid results (250-277).**
- Capture the save result (line 250): `const saved = await
  this.persistence.saveHighlights({...});`. Skip reconciliation when `saved === false`:
  ```ts
    if (!saved) {
      console.warn(`[digest-usecase] saveHighlights failed for ${params.analysisId}; skipping reconciliation`);
      return;
    }
  ```
- Change the reconciliation gate (line 268) from
  `if (highlightsWithExcerpts.length > 0 && params.takeaways.length > 0)` to
  `if (params.takeaways.length > 0)` — a valid `'ok'` result with ZERO highlights
  must still reconcile (every takeaway → grounded:false). The `'invalid'` case
  already returns early at line 238, so reaching here means the result was valid.
  Note: `reconcileHighlights` currently types `highlights` non-empty in its user
  message builder — verify `buildHighlightsReconciliationUserMessage` handles an
  empty `highlights` array gracefully (it does — `.map` on `[]` yields `''`);
  if the prompt would confuse the model with an empty highlights block, that is
  acceptable (the model returns all `grounded:false`).

**B10. `web/app/share/[token]/PublicHighlightsReel.tsx` — sum clamped
durations (120-123).** Replace
`const totalHighlightsSeconds = Math.min(100, ...)` base from
`highlights.length * segmentDurationSeconds` (line 121) with a sum of each
highlight's real clamped duration, falling back to `segmentDurationSeconds`
when `end` is null/invalid:
```ts
  const totalHighlightsSeconds = highlights.reduce((sum, h) => {
    const dur = (Number.isFinite(h.end) && h.end > h.start) ? (h.end - h.start) : segmentDurationSeconds;
    return sum + Math.min(maxSegmentDurationSeconds ?? 60, Math.max(minSegmentDurationSeconds ?? 5, dur));
  }, 0);
```
If `minSegmentDurationSeconds`/`maxSegmentDurationSeconds` aren't in scope,
import them from `highlights-settings` (the component already receives
`segmentDurationSeconds`; add the two clamps to the props from the parent
`share/[token]` page, OR import `HIGHLIGHTS_REGISTRY_FALLBACK` defaults
directly). Keep the existing `Math.min(100, …)` percent cap that follows.

### Phase C — Variable-duration playback (USER-APPROVED: implement end-to-end)

`useSegmentPlayback` accepts `segments: {start, end}[]` and `segmentDurationSeconds`
(fallback), but at line 264 it advances on `leadIn + segmentDurationRef.current`
(fixed) — ignoring each segment's real `end`. The hook's own doc comment (lines
53-56) wrongly claims it uses `end`. Fix the cascade:

**C1. `web/lib/hooks/useSegmentPlayback.ts:264` — advance on real `end`.**
```ts
      // Variable-duration: advance when playback reaches the segment's real
      // end. Fall back to the fixed segmentDurationSeconds only when the
      // segment has no usable end (legacy/null data).
      const segmentEnd = (Number.isFinite(segment.end) && segment.end > segment.start)
        ? segment.end
        : leadIn + segmentDurationRef.current;
      if (currentTime >= segmentEnd - ADVANCE_LEAD_SECONDS) {
        playFrom(idx + 1);
      }
```
Update the stale comment at lines 258-263 to match (it currently says the
per-highlight span is "a display-total concern only" — that is now false).

**C2. Ticker real duration — callers pass `(end - start)`, no signature change.**
`useHighlightTicker`'s `segmentDurationSeconds` param (line 38) is a generic
reveal window. In both callers, pass the ACTIVE highlight's real duration
instead of the fixed `segmentDurationSeconds`:
- `PublicHighlightsReel.tsx:113`: replace the 3rd arg
  `segmentDurationSeconds` with `Math.max(1, (activeHighlight.end && activeHighlight.end > activeHighlight.start) ? (activeHighlight.end - activeHighlight.start) : segmentDurationSeconds)`.
- `HighlightsScrubber.tsx:137`: the same — find the `useHighlightTicker(...)`
  call and pass the active highlight's real duration (compute from
  `activeHighlight` which is already in scope at line 132).
Verify `activeHighlight` is non-null before reading `.end` (guard with the
existing `playingIdx !== null` + optional chaining).

**C3. Track width — `HighlightsScrubber.tsx:165-172`.** The comment block claims
`useSegmentPlayback` ignores `highlight.end` (now false). The track width at
line ~172 uses `data.highlights.length * data.segmentDurationSeconds`. Change
it to sum each highlight's clamped `(end - start)` (fallback to
`segmentDurationSeconds`), same reduce pattern as B10. Update the stale
comment.

**C4. Tests — update `useSegmentPlayback.test.ts` + add regression tests.**
The existing tests assert advance at fixed `segmentDurationSeconds`. Update
them to assert advance at the real `segment.end` when provided, and keep a
legacy case asserting the `segmentDurationSeconds` fallback when `end` is
null. Add cases: (a) short highlight (end-start = 5s), (b) long highlight
(end-start = 60s), (c) legacy row (end null → fallback), (d) end < start
(treated as no usable end → fallback).

### Phase D — Tests + docs

**D1. `web/lib/hooks/useHighlightTicker.ts` — add excerpt-selection regression
tests** (new test file `useHighlightTicker.test.ts`): non-empty `verbatimExcerpt`
overrides `label`; null/empty `verbatimExcerpt` falls back to `label`;
`elapsedSeconds` null → empty reveal.

**D2. Parser/reconciliation tests** — add focused tests in the existing test
pattern for: (a) `parseHighlightsExtraction` clamps sub-min and over-max
durations (not drops), (b) `takeawayIdx` out-of-range → null, (c)
`parseHighlightsReconciliation` rejects duplicate/missing/out-of-range
takeawayIdx, (d) NULL `p_reconciliation` path is SQL (note in report; a
SQL-level test is optional but cite the migration guard).

**D3. `docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
— fix the malformed skills table (~822-831).** Header has 3 columns, rows have
2. Add the missing 3rd cell to every row (or reduce header to 2). This is the
only doc-only lint fix in scope; do NOT edit other prose claims in that file
or the implementation.md — they are historical dispatch records.

### Out of scope (DO NOT do; note as deferred)
- B11 (move `reconciliation maxTokens:500` to Settings Registry + new
  migration): DEFERRED to a follow-up to avoid a 3rd migration's ADR-018 risk
  on this dispatch. Cheap no-migration part IS in scope: in
  `GenerateExecutiveDigestUseCase.ts` `reconcileHighlights`, drop the unused
  `userId?: string` param (line 290) and its `userId: undefined` pass (line
  273). Leave `maxTokens: 500` but change to `Math.max(500, params.takeaways.length * 150)`
  with a `// TODO: move to Settings Registry (highlights.reconciliationMaxOutputTokens) — deferred from PR #267` comment.
- Digest-display UI grounding indicator (CR on design-proposal.md:547):
  deferred — no digest-display component changed in this PR; the three-surface
  claim is narrowed by the PR description, not by code here. Note as follow-up.
- The 5 eslint warnings (HighlightsScrubber `stop` dep, VideoPlayerCard
  `mountPlayer`, WordCloud `wordsLayout`, two unused-var test warnings) are
  pre-existing on main and non-fatal; DO NOT fix them in this PR (out of scope,
  would expand the diff). EXCEPT: if your C1/C3 changes to
  `HighlightsScrubber.tsx` naturally resolve the `stop` exhaustive-deps warning,
  that's fine — but don't go out of your way.

## 3. Goal / definition of done

- `pnpm --filter @hex-yt-intel/web exec tsc --noEmit` — clean (exit 0).
- `pnpm --filter @hex-yt-intel/web exec vitest run` — green, no regressions
  (≥1259 passed), with the NEW tests from D1/D2/C4 passing.
- `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` — exit 0 (NO
  new issues vs baseline). This is the gate that currently fails CI Lint.
- `pnpm tsx web/scripts/contract-auditor.ts` — 0 critical, no NEW warnings.
- CodeFactor-relevant `any` types removed from `SupabaseAnalysisAdapter.ts` and
  `highlights/route.ts`.
- `useSegmentPlayback` advances on `segment.end` (fallback to fixed) and the
  existing tests assert the new behavior.
- A different agent can read the diff and confirm each of B1-B10, C1-C4 landed.

## 4. Expected results

Changed files (expected): `highlights-reconciliation.ts`,
`highlights-extraction.ts`, `ExecutiveDigestPorts.ts`,
`SupabaseAnalysisAdapter.ts`, `SupabasePersistenceAdapter.ts`,
`ChatPersistencePort.ts`, `highlights/route.ts`, `ProcessChatMessageUseCase.ts`,
`GenerateExecutiveDigestUseCase.ts`, `PublicHighlightsReel.tsx`,
`HighlightsScrubber.tsx`, `useSegmentPlayback.ts`, `useHighlightTicker.ts`
(callers only), the migration SQL (B1), new test files (D1, and additions to
`useSegmentPlayback.test.ts` + parser test files), and the design-proposal.md
table fix (D3). No new migration files (B11 deferred). Report must list every
file actually changed with a one-line summary.

## 5. Task-specific skills/tools/plugins/MCPs

- **code-review-graph** MCP (Step 0, §6) — `get_impact_radius_tool` on
  `useSegmentPlayback.ts` and `ProcessChatMessageUseCase.ts` before editing.
- **Supabase MCP** — for B1, you are editing a migration FILE only (do NOT
  `apply_migration` — the migration is already committed and applied on the
  preview branch per the Supabase bot comment; editing a committed migration
  file requires re-running it. Verify with `list_migrations` whether
  `20260821120100` is already recorded remotely; if it IS, the NULL-guard fix
  must be delivered as a NEW follow-up migration file
  `supabase/migrations/<new-timestamp>_set_executive_digest_reconciliation_null_guard.sql`
  that re-creates the function with the guard (idempotent `create or replace`).
  If it is NOT yet applied, edit the existing file in place. Report which path
  you took and why. This is an ADR-018 decision — get it right.)
- SELECT skills: `supabase` + `supabase-postgres-best-practices` (B1, B5, B6 —
  PostgREST `{data,error}` + `SECURITY INVOKER` + jsonb strictness),
  `react-best-practices` (C1-C3 — hook effect deps), `code-reviewer`/`/simplify`
  (final pass).

## 6. Fixtures — [ALWAYS INCLUDE]

Before touching code, run the project's `code-review-graph` MCP tools
(`build_or_update_graph_tool` first, then `get_review_context_tool` /
`get_impact_radius_tool` scoped to `useSegmentPlayback.ts`,
`ProcessChatMessageUseCase.ts`, `SupabaseAnalysisAdapter.ts`). This project's
CLAUDE.md mandates this as Step 0. Start from HEAD `d77f56f1` on branch
`fix/highlights-chat-digest-consistency` (the worktree). Baseline gate state
(verified by CC 2026-08-23): web tsc clean; vitest 103/1259/16skip green;
quality-engine RED (5 issues in highlights-reconciliation.ts); worker tsc has
pre-existing unrelated errors (ignore).

## 7. The three tenets — [ALWAYS INCLUDE]

> 1. **Contract definition + enforcement.** State the exact input→output
>    contract for what you're building BEFORE writing it. After writing it,
>    check the diff against that stated contract — not "does it compile," but
>    "does this actually fire on the real path it claims to fix."
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.** A
>    passing unit test proving a function's isolated output is correct is NOT
>    sufficient evidence — trace the real caller chain with actual proof.
> 3. **Tangent hunt as you walk the workflow.** While touching each file,
>    check adjacent call sites and control-flow branches for the same class
>    of gap. Report tangents found even if not fixed this pass.
>
> **If you cannot complete a full cycle, or find a design gap mid-task, STOP
> and report the specific deviation and why, rather than shipping a partial
> fix under a "done" label.**

For THIS task, the highest-risk chains to prove E2E: (a) a NULL
`p_reconciliation` reaching the RPC must NOT null the digest (B1) — cite the
guard; (b) a failed `analysis_highlights` read must hit Sentry, not silently
drop the section (B5); (c) a short/long/legacy highlight must advance at its
real `end` with fallback (C1) — cite the test asserting each case; (d)
reconciliation with a missing takeaway must render ungrounded, not grounded
(B8).

## 8. Report format — [ALWAYS INCLUDE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run +
> findings → Gates (tsc/vitest/qa-intel `--ci --compare`/contract-auditor
> results, exact output) → Files changed. CC independently re-verifies every
> claim against real code and real system state before accepting — a report
> claiming "done" without this structure, or without E2E proof, will be
> rejected and sent back.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean (ignore the known @lib/ alias artifact in factory.ts/dimension.ts — not in this PR's diff)
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS — must exit 0
pnpm tsx web/scripts/contract-auditor.ts
```

Run from the worktree root
(`/home/kellyb_dev/projects/hex-yt-intel/.claude/worktrees/highlights-consistency`).
Commit with `pnpm`-only tooling. Do NOT push — CC pushes after verification.
