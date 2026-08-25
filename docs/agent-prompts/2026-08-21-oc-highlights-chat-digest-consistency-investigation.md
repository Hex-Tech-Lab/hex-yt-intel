# Agent Dispatch Prompt — OC (opencode, glm-5.2:free, low effort) — Highlights/Chat/Digest Consistency Investigation + Design Proposal

**Dispatch type: INVESTIGATION + WRITTEN DESIGN PROPOSAL ONLY. NO CODE CHANGES.**
This is deliberately scoped narrower than the full fix. The eventual fix touches
an LLM extraction prompt whose output feeds directly into what paying users see
(Highlights Reel, chat answers, digest key takeaways) — CC (the orchestrator)
will review your proposal, likely revise it, and only THEN dispatch a second,
separate OC task to implement the reviewed design. Do not skip ahead and start
editing `web/lib/prompts/highlights-extraction.ts` or any other production file
in this dispatch. If you finish early, re-read your own proposal for gaps
instead of starting implementation.

---

## Model-tuning note for you, OC

You are running as a low-effort flash-tier model. Execute the numbered steps
below literally and in order. Do not summarize a step as "covered" because you
handled a related step — each numbered item below needs its own explicit,
visible output in your final report. If a step doesn't apply, say so explicitly
rather than omitting it.

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

Since this dispatch makes NO code changes, your `[IN_PROGRESS]`/`[DONE]` ledger
entries should say so explicitly ("investigation + design doc only, no
production files touched") so the next agent (the implementation dispatch)
knows this pass didn't already claim the files.

## 1. Context

**Codebase**: hex-yt-intel / vIntel — a YouTube video-intelligence SaaS. Users
paste a YouTube URL; the backend (Cloudflare Worker, streaming LLM cascade)
produces an 11-dimension analysis, an executive digest (Dimension 0), a
Highlights Reel (timestamped keypoints for a video scrubber), and a chat
interface that answers questions grounded in the analysis.

**What triggered this task**: a live user report (2026-08-21, via voice
dictation, transcribed and pasted into the session) about the Highlights Reel
feature, which was just redesigned and had several real bugs fixed this same
session (pause/resume, nav wraparound, label collision, control-height parity
— all already fixed, verified, and merged; not your concern). The REMAINING,
unfixed part of that report is what this dispatch investigates:

> "...the segment is looking correct. But the segment length looks the same
> for all summaries, as if it's sort of a capped cut-off... this should be
> variable, and it should be really based on the point being discussed, with
> a capping of course... it should cover the minimum amount of the topic...
> and include all the keywords that are meaningful from that excerpt... Now,
> you have to remember that this is part of what you feed to the chat box,
> because the chat box should not be coming up with a different highlight or
> key points if asked. Now, you have to also reflect that against the key
> takeaways that's part of dimension zero multi-part summary... there are
> three touchpoints, they're all about the same thing, yet they are not
> mapped. And they cannot not be mapped, they have to be mapped because
> otherwise you're telling the user a different story each time... it needs
> to be orchestrated in a way that actually ties the three together."

And a second, related complaint:

> "...the transcript is actually a rendition, it's not the actual transcript
> ...we should capture that these components... verbatim and persistent
> verbatim. We shouldn't really assimilate or synthesize what's being said,
> because it's a transcript."

CC (the orchestrator, this session) already did a first-pass root-cause read
of the relevant source and confirmed the following FACTS — verify them
yourself (don't just trust this list; the three tenets below require you to
re-check), but they are the accurate starting point, not a guess:

- **Highlights Reel segment length is a single fixed constant today**
  (`segmentDurationSeconds`, a Settings Registry value, currently applied
  identically to every highlight regardless of content — this IS the reported
  "capped cut-off, same length for all" bug). See
  `web/lib/hooks/useSegmentPlayback.ts` (the actual playback-advance clamp)
  and `web/components/dashboard/HighlightsTrack.tsx` (the visual segment
  fill/end-bracket, both already fixed tonight to use this same constant
  consistently with what plays — that part is DONE, not your task).
- **`web/lib/prompts/highlights-extraction.ts`** is the LLM prompt/parser that
  actually decides highlight `start`/`end`/`label`. Its prompt currently tells
  the model `end` = "the start of the next selected segment" — a definition
  that has nothing to do with how long the actual point being discussed runs.
  `parseHighlightsExtraction()` hard-enforces this (rejects any `end` that
  isn't itself a real transcript-segment start). This is a SEPARATE,
  standalone LLM call from the executive digest — read
  `web/lib/usecases/GenerateExecutiveDigestUseCase.ts`'s `extractHighlights()`
  method (private, called from `execute()`) to see exactly how/when it runs.
  It has NO access to and makes NO comparison against the digest's own
  "takeaways" content — they are independently generated, which is the direct
  cause of the "three touchpoints, not mapped" complaint.
- **`label` (on each highlight) is an LLM-synthesized one-sentence
  description, not verbatim transcript text.** The Highlights Reel's
  scrolling ticker (`useHighlightTicker.ts`, consumed by
  `HighlightsScrubber.tsx`) reveals this `label` word-by-word as if it were
  a transcript excerpt — it is not. This is the "rendition, not the actual
  transcript" bug. The RAW transcript segments (with real `start`/`text`)
  DO exist and ARE available at extraction time
  (`this.persistence.getTranscriptSegments(videoId)`,
  `buildHighlightsExtractionUserMessage()` receives them) — they are just
  never captured/persisted as a distinct field on the highlight; only the
  LLM's synthesized `label` is saved (`saveHighlights()` call in
  `GenerateExecutiveDigestUseCase.ts`).
- The chat interface's grounding path (how it answers "what were the key
  points") is a SEPARATE code path again — you need to find and read it
  yourself (see fixture note below); CC has not yet traced this one in
  detail this session.
- Dimension 0 / executive digest "takeaways" — also a separate generation
  path in the same use case file, independent of highlights extraction.

## 2. Task

Investigate and design (do NOT implement) a concrete, buildable plan that:

**A. Makes highlight segment length variable, content-driven, with a sane
cap** — instead of one fixed duration for every highlight, each highlight's
real span should be determined by how long the actual point being discussed
runs in the source transcript, bounded by a reasonable min/max so it never
balloons to minutes. Investigate whether reusing the knowledge-graph
extraction machinery (grep for how `kg_entities`/knowledge-graph keyword
extraction works in this codebase — ADR 023 references it) could help
identify where a "point" naturally starts/ends or its key terms, or whether
that's over-engineering for this specific problem — form your own
recommendation, don't assume the answer.

**B. Makes the Highlights Reel, the chat's answers about key points, and
Dimension 0's "takeaways" consistent with each other** — investigate exactly
how each of the three is generated today (you already have Highlights Reel's
path from section 1 above; trace the chat grounding path and the digest
takeaways path yourself), and propose a concrete mechanism so they can't
diverge — e.g. one shared "key moments" extraction that all three consume,
vs. one being generated first and the other two referencing it, vs. some
other design. State tradeoffs, don't just pick the first idea.

**C. Enables verbatim transcript excerpts** on each highlight (for the
ticker to show real spoken words, not an LLM paraphrase) — investigate
whether this can be derived WITHOUT a new LLM call (e.g., slicing the
original transcript `segments` array, which is already available at
extraction time, between the highlight's real start and end) versus whether
it needs new LLM output. Recommend the cheaper option if it's actually
sufficient; don't default to "ask the LLM for more" without checking whether
the data already exists to do this for free.

## 3. Goal / definition of done

A written design document (see Expected Results) that:
- States the EXACT current behavior for A, B, and C (cite real file:line,
  not paraphrase) as the "before" baseline.
- Proposes a concrete "after" design for each of A, B, C — specific enough
  that a different engineer (or a follow-up OC dispatch) could implement it
  without re-deriving intent. Include: what changes in the extraction
  prompt text (if anything), what changes in the parser/validation contract,
  what new DB columns/migration (if any) are needed on the highlights table,
  what changes (if any) in the chat grounding route and the digest takeaways
  generation, and what changes in the display-layer components that already
  exist (name them).
- Explicitly calls out COST and LATENCY impact of each proposed change (this
  project runs on a per-request LLM cascade with real $ cost per call — see
  ADR 019 for the existing cost-discipline pattern in this codebase). If your
  design adds a new LLM call, say so explicitly and estimate rough token
  cost; if it avoids one, say that explicitly too.
- Explicitly flags migration/rollout concerns for EXISTING highlight rows
  already in the database under the old contract (they will have the old
  `end` semantics and no verbatim-excerpt field) — does old data need a
  backfill, or is "new analyses only" acceptable? State your recommendation
  and why.
- Is saved to `docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
  (a NEW file — do not overwrite this dispatch prompt file).

## 4. Expected results

- One new file: `docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md`
  containing the design document described above.
- NO changes to any file under `web/`, `worker/`, or `supabase/migrations/`.
- A ledger entry per the protocol in section 0.
- A report per section 8 below, posted as your final output.

## 5. Task-specific skills/tools/plugins/MCPs

Beyond CORE (qa-intel, contract-auditor, `/simplify`) and the three tenets
(section 7) — for THIS task, since it is investigation/design-only with zero
code changes, qa-intel/contract-auditor/`/simplify` have nothing to run
against (no diff exists). State this explicitly in your report rather than
fabricating a "ran and found nothing" result — "not applicable, no code
changes in this dispatch" is the correct, honest answer.

What DOES apply to this task specifically:
- **`code-review-graph` MCP tools** (see section 6, Step 0) — use
  `semantic_search_nodes_tool`/`query_graph_tool` to actually FIND the chat
  grounding route and the knowledge-graph extraction code yourself, rather
  than guessing file paths. This is a research task; the graph is the right
  tool for "where does X happen" questions.
- **`supabase-postgres-best-practices`**: your design proposal will likely
  recommend a new DB column or table shape (verbatim excerpt storage,
  possibly a shared "key moments" table) — even though you are not writing
  the migration in this dispatch, sketch the proposed schema with this
  skill's indexing/RLS conventions in mind so the follow-up implementation
  dispatch isn't starting from zero.
- Do NOT invoke `owasp-top-10`, `react-best-practices`, or
  `web-design-guidelines` — this task touches no auth/security surface, no
  React component, and no UI markup.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Before touching any code, run the project's
`code-review-graph` MCP tools (`build_or_update_graph_tool` first, then
`get_review_context_tool`/`get_impact_radius_tool`/`semantic_search_nodes_tool`
scoped to the files this task touches) — this project's CLAUDE.md mandates
this as Step 0, before Grep/Glob/Read, for token efficiency and blast-radius
awareness. Never skip straight to file reads.

**Task-specific starting points** (you must still verify these yourself,
they are pointers not a substitute for reading the real code):
- `web/lib/prompts/highlights-extraction.ts` — the highlights extraction
  prompt + parser (already summarized accurately in section 1 above).
- `web/lib/usecases/GenerateExecutiveDigestUseCase.ts` — where highlights
  extraction AND digest/takeaways generation both live, in the same
  `execute()` flow but as independent sub-steps. Read the WHOLE file, not
  just `extractHighlights()` — you need to see how takeaways/digest content
  is generated too, for section B of the task.
- Chat grounding: search for how the chat route answers questions "grounded"
  in an analysis (ADR 008/009/014 in the project's CLAUDE.md reference chat
  grounding security/ownership rules — those ADRs tell you WHERE to look,
  not what to change). Use `semantic_search_nodes_tool` with a query like
  "chat grounding analysis context" rather than guessing a file path.
  Cite the real file(s) you find in your report.
- Knowledge graph extraction (for section A's "could this help identify a
  point's boundaries/keywords" question): ADR 023 in the project's CLAUDE.md
  references `useKnowledgeGraph.ts`'s client-side TF-IDF fallback and
  `kg_entities`/`kg_relations` — but also check for any SERVER-side
  knowledge-graph extraction step in the analysis pipeline (search, don't
  assume there is or isn't one).
- Settings Registry pattern (for section A's "sane cap" — this project never
  hardcodes a tunable, see the standing memory rule "no hardcoded magic
  numbers" and ADR 019's cost-discipline example): if your design proposes
  a min/max segment-length cap, it should be Settings-Registry-shaped
  (like `highlights.maxCount`/`highlights.maxOutputTokens` already are in
  `web/lib/usecases/GenerateExecutiveDigestUseCase.ts`), not a bare literal.

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

**For THIS specific dispatch** (investigation/design only, no code): tenet 1
becomes "state the exact current behavior (the 'before' contract) with real
file:line citations before proposing any 'after'"; tenet 2 becomes "trace the
REAL current code path end to end for all three touchpoints (Highlights Reel,
chat, digest) — don't stop at the first file you find for each"; tenet 3
still applies literally — while reading each file, note anything else you
notice that's relevant (e.g. another place `label` is treated as verbatim
text, another fixed-duration assumption, etc.) even if outside the three
sections A/B/C.

## 8. Report format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (cite actual command/query output, not
> "tests pass") → Tangents found → Deviations flagged (if any) → Skills run
> + findings → Gates (tsc/vitest/qa-intel `--ci --compare`/contract-auditor
> results, exact output) → Files changed. CC independently re-verifies every
> claim against real code and real system state before accepting — a report
> claiming "done" without this structure, or without E2E proof, will be
> rejected and sent back.

**For THIS dispatch**, map the format literally as: RCA = the "before"
behavior for A/B/C with file:line citations; Contract = the proposed "after"
design for A/B/C; Fix = N/A (no code written, say so); E2E proof = N/A (no
code written, say so) — but your RCA citations must be REAL, re-verify every
file:line reference against the actual current file content, not memory;
Tangents found = anything from tenet 3 above; Deviations flagged = any part
of task A/B/C you could not fully investigate and why; Skills run + findings
= section 5's applicability statement; Gates = N/A (no code changes, state
this explicitly rather than fabricating gate output); Files changed = the one
new design-doc file only.

## 9. Gates — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json   # grep '^src/' on output, empty = clean
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare   # THE EXACT CI FLAGS — the bare default run has different exit-code behavior and will give a false pass
pnpm tsx web/scripts/contract-auditor.ts
```

**For THIS dispatch**: these gates apply to CODE changes. Since this
dispatch makes none, do NOT run them and claim a pass — explicitly state in
your report "no code changes in this dispatch, gates not applicable." If you
find yourself tempted to run them "just to be safe," that's a sign you've
started implementing when you should have stopped at the design doc — don't.
