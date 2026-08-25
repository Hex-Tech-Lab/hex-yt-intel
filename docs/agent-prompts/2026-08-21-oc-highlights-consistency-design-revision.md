# Agent Dispatch Prompt — OC (opencode, glm-5.2:free, low effort) — Highlights/Chat/Digest Consistency Design Revision

**Dispatch type: REVISE AN EXISTING DESIGN DOCUMENT ONLY. NO CODE CHANGES.**
This is a follow-up to your own prior dispatch. You already produced
`docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
(read it first — it is your own prior work, not someone else's). CC (the
orchestrator) and the user reviewed it together and found it genuinely
solid on sections A and most of B/C, with one real architectural gap in B
that needs closing before this goes to implementation. This dispatch is
that revision — not a rewrite from scratch.

---

## Model-tuning note for you, OC

Execute the numbered steps below literally. Where this prompt says "keep
X unchanged," do not re-derive or second-guess it — it was already
verified correct. Where it says "revise Y," produce the specific new
content described, not a vague restatement of the problem.

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
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

## 1. Context

Same codebase/feature as your prior dispatch (hex-yt-intel / vIntel; Highlights
Reel, executive digest Dimension 0, chat grounding). Read your own prior design
doc in full before proceeding — this prompt assumes you have it in front of you
and only describes the DELTA, not the whole picture again.

**What CC/the user found reviewing your proposal, verified against real code
(not opinion):**

1. **Section 2.A.2 (relaxing the `end` constraint while keeping `start`
   hard-validated) is correct and stays exactly as you designed it.** CC
   independently confirmed `start` is the only field ever used to seek the
   player (`useSegmentPlayback.ts`'s `playFrom()` only reads `segment.start`,
   never `segment.end`, for seeking) — so relaxing `end`'s validation while
   keeping `start` anchored to a real transcript segment start does NOT
   reintroduce a hallucinated-seek-target risk. No change needed here.

2. **Section 2.A.6 (rejecting KG/D8 as a segment-boundary signal) is correct
   and stays.** Additionally verified: the 5 stream bundles
   (`STREAM_BUNDLES` in `web/lib/config/synthesis.ts`) are dispatched via a
   single `Promise.all(streamFetches.map(...))` in
   `web/hooks/useSSEStream.ts:485-489` — genuinely unlimited concurrency, no
   queue, no concurrency cap, all 5 fire simultaneously. There is no
   "dispatch order" lever in this architecture at all (a "run D8 first"
   idea was raised and independently disproven this way). This further
   supports your existing decision not to build a dependency on D8's
   timing — no change needed here either.

3. **Real gap: Section 2.B (`Digest-first, highlights reference digest`)
   only closes the consistency loop in ONE direction.** Your design makes
   highlights *conform to* the digest (via `takeawayIdx`), and makes chat
   *aware of* both. But nothing ever checks the digest's OWN displayed
   takeaways against what highlights extraction actually managed to ground
   in real transcript time. Concrete failure case: digest's LLM call
   invents 5 takeaways; highlights extraction (given those takeaways as
   context) only finds real transcript grounding for 3 of them, skips 2 per
   your own prompt instruction ("If a takeaway has no clear transcript
   location, skip it"). Today's design still DISPLAYS all 5 digest
   takeaways unchanged — 2 of them now silently ungrounded. That's the
   exact "three touchpoints tell different stories" problem the user
   originally reported, just moved one level up instead of fixed. This
   needs a closed loop: **one reconciled "key moments" object that the
   digest display, the Highlights Reel, and chat grounding all render
   from** — not two of three deriving from the third.

## 2. Task — revise Section 2.B and add a new Section 2.B.6

Do NOT restructure sections 2.A or 2.C — they stay as written (confirmed
correct above). Revise ONLY section "2.B — Three-Way Consistency" as follows:

### 2.B.6 (NEW) — Post-extraction reconciliation, closing the loop

After highlights extraction completes and produces its `takeawayIdx`
mappings (your existing 2.B.2), add one more step: a **reconciliation
pass** that produces the single object all three touchpoints render from.

**Explicit design decisions already made by CC/the user — implement these
exactly, do not re-derive or pick a different option:**

- **Never drop an unmapped digest takeaway. Mark it instead.** Add a
  `grounded: boolean` field to each digest takeaway (or equivalent — you
  decide the exact shape, but the semantic must be "is this takeaway
  backed by a real highlight" not "delete it"). Reasoning to cite in your
  revision (don't just assert it): `dimension-remediation.ts` and
  `aux-remediation.ts` (confirmed via direct grep, zero matches) NEVER
  regenerate digest or highlights — only the 11 core dimensions. There is
  no self-healing pass that would ever retroactively fix a dropped
  takeaway. Dropping is permanent, unrecoverable data loss with no future
  remediation path. This mirrors the EXISTING pattern already in
  `highlights-extraction.ts` (the `'invalid' !== empty` distinction —
  quote it in your revision) — this codebase already has a hard-won rule
  against exactly this class of silent loss.

- **The reconciliation step is a genuine LLM call, not code-only string
  matching.** Semantic judgment ("does this highlight's content actually
  support this takeaway's claim") is a precision task, not a bulk-generation
  task — a naive string/keyword match would produce false negatives
  (marking a genuinely-grounded takeaway as ungrounded because the wording
  differs) and false positives. Design this as a small, cheap LLM call:
  input is just the digest's takeaways array + the finalized highlights
  list (both already short, structured text — not the full transcript),
  output is the `grounded` flag per takeaway (+ optionally which highlight
  index backs it, for the same `takeawayIdx` cross-reference already in
  2.B.2). Keep this call SEPARATE from the highlights-extraction call
  itself (different model, different cost profile — see below), not merged
  into it.

- **Model: Claude Haiku 4.5, NOT GPT-OSS-120B, via a NEW dedicated cascade
  registry key.** Real, verified facts to cite in your revision: (a)
  `web/lib/config/cascade.ts` shows `cascade.digest` (used by BOTH digest
  generation AND highlights extraction today) is GPT-OSS-120B with **zero
  escalation** — the only pipeline stage with no fallback-to-quality path at
  all, unlike `cascade.analysis` (Haiku 4.5 → Sonnet 5) or `cascade.chat`
  (GPT-OSS → Gemini Flash). (b) This repo's own extensive parity-test
  research (`docs/research/2026-08-18-full-parity-final-scores.md`,
  real n=8-video testing across all 5 dimension bundles) found GPT-OSS-120B's
  factual coverage stalls at 41-62% of Haiku 4.5's, across every bundle,
  never reaching parity despite multiple documented fix attempts — this is
  precisely the failure mode that would hurt worst in a factual-grounding
  judgment task. (c) The reconciliation call is small (a handful of
  takeaways against a handful of highlights, not full-document synthesis),
  so Haiku's higher per-token cost is negligible at this scale — the
  cost-discipline argument for defaulting to the cheaper model doesn't
  apply here. Per this codebase's own established pattern ("each helper
  function gets its own cascade" — see `cascade.digest`'s and
  `cascade.entityExtraction`'s own dedicated-cascade rationale comments in
  `cascade.ts`), propose a NEW registry key
  (e.g. `cascade.highlightsReconciliation`), seeded with the SAME
  Haiku-4.5-primary → Sonnet-5-escalation shape as `ANALYSIS_CASCADE_FALLBACK`
  — do not literally alias `cascade.analysis`, and do not put this on
  `cascade.digest`.

- **Final object shape**: propose a concrete shape for the reconciled "key
  moments" result — you decide the exact fields, but it must let: the
  digest display show takeaways with their `grounded` status, the
  Highlights Reel render the highlights list unchanged (already grounded
  by construction), and chat grounding reference takeaways + highlights +
  the grounding link between them, all from ONE persisted object/read path
  rather than three independent queries that could drift.

- **Standalone highlights**: a highlight that didn't map to any takeaway
  but was still judged noteworthy by the highlights-extraction call stays
  in the highlights list as-is (this already happens per your existing
  2.B.2 `takeawayIdx: null` case) — no change needed to that part, just
  confirm it composes correctly with the new reconciliation step.

### Explicitly OUT of scope for this revision (already decided, do not propose)

- **Do NOT propose making dimension-remediation regenerate digest/highlights
  after backfilling a missing core dimension.** This was discussed and
  explicitly deferred as separate work — logged as
  `docs/TECH_DEBT_LEDGER.md` item #19 (medium priority). It requires
  relaxing `GenerateExecutiveDigestUseCase`'s current strict "generate once,
  ever" idempotency plus a new integration point — real work, but not this
  dispatch. If you find yourself designing this, stop — it's out of scope.
- **Do NOT propose reordering `STREAM_BUNDLES` or any "dispatch D8 first"
  mechanism.** Already disproven (see context section 2 above) — there is
  no dispatch-order lever in this architecture at all.
- **Do NOT propose changing `cascade.digest`'s model or adding escalation to
  it.** The digest generation model choice itself stays GPT-OSS-120B for now
  (explicit user decision — the GPT-OSS parity gap is a real, separately
  tracked research thread, not something to fix as a side effect of this
  task). Only the NEW reconciliation call gets Haiku.

## 3. Goal / definition of done

An updated version of
`docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
(edit the SAME file in place — do not create a new file this time) where:
- Section 2.B gains the new 2.B.6 subsection described above, with concrete
  field-level detail (interface shapes, migration SQL for any new column,
  the new cascade registry key's seeded fallback values) at the same level
  of specificity as your existing 2.A/2.C sections.
- Section 3 (Cost & Latency Impact) gets a new row for the reconciliation
  LLM call — this one, unlike A/B/C's other changes, IS a new LLM call, so
  estimate its real token cost (takeaways array + highlights list as input,
  a small structured output) honestly, don't undercount it as "zero" the
  way the other sections correctly did.
- Section 4 (Migration & Rollout) addresses what happens to EXISTING
  highlights/digests that predate this reconciliation step — same
  graceful-degradation principle as before (no backfill required, but state
  explicitly what an old row's `grounded` field defaults to and why).
- The Appendix's implementation-dispatch file checklist gets updated with
  the new file(s)/migration this adds.

## 4. Expected results

- `docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
  edited in place with the above additions/changes. Sections 2.A and 2.C
  stay byte-for-byte as they are (verify with a diff before finishing that
  you didn't accidentally rewrite them).
- NO changes to any file under `web/`, `worker/`, or `supabase/migrations/`.
- A ledger entry per section 0.
- A report per section 8 below.

## 5. Task-specific skills/tools/plugins/MCPs

Same as your prior dispatch: `qa-intel`/`contract-auditor`/`/simplify` are
**not applicable** (no code changes) — state this explicitly, don't fabricate
a run. `code-review-graph` MCP: not needed this time, you already have full
context from your prior investigation pass — re-reading your own prior file
plus this prompt should be sufficient; only re-read source files if you
genuinely need to re-verify a specific claim. `supabase-postgres-best-practices`:
still applies if you propose a new column for the `grounded` flag — follow
the same nullable-column, no-backfill, table-level-RLS pattern you already
used correctly for `takeaway_idx`/`verbatim_excerpt`.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Before touching any code, run the project's
`code-review-graph` MCP tools if you need to re-verify anything — but for
this revision dispatch, your own prior investigation file IS the fixture;
don't re-run the full investigation from scratch.

**Task-specific**: Re-read your own
`docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
in full before editing it. If any claim in section 1 above (about `start`
never being used for seeking, or the stream-dispatch concurrency) seems
inconsistent with something you find, flag it as a deviation (section 6 of
the report) rather than silently trusting either source.

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
> partial fix under a "done" label.** A clearly flagged incomplete item is
> fine; a silently incomplete one reported as done is not — this project's
> history has multiple confirmed incidents of exactly that pattern.

For THIS dispatch: tenet 1 = state the reconciliation step's exact
input→output contract before describing it; tenet 2 = trace how the
reconciled object would actually reach all three render sites (digest
display component, Highlights Reel component, chat grounding assembly) —
name the real files/functions for each, don't just assert "all three read
from it"; tenet 3 = while revising, note if the new reconciliation step
creates any NEW tangent (e.g. a caching/staleness concern, a new failure
mode if the reconciliation call itself fails) beyond what's already listed
in your prior doc's section 5.

## 8. Report format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates (tsc/vitest/qa-intel `--ci --compare`/contract-auditor
> results, exact output) → Files changed. CC independently re-verifies every
> claim against real code and real system state before accepting — a report
> claiming "done" without this structure, or without E2E proof, will be
> rejected and sent back.

For THIS dispatch: RCA = the gap described in context section 3 above
(already established, cite it, don't re-derive); Contract = the new
2.B.6 section's input→output shape; Fix = N/A (design doc only, say so);
E2E proof = N/A (say so); Tangents/Deviations/Skills = as described above;
Gates = N/A (say so); Files changed = the one edited design-doc file.

## 9. Gates — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS — the bare default run has different exit-code behavior and will give a false pass
pnpm tsx web/scripts/contract-auditor.ts
```

Not applicable — no code changes in this dispatch. State this explicitly
rather than running them or claiming a pass.
