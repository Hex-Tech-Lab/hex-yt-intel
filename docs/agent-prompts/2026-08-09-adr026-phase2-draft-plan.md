# ADR 026 Phase 2 — Draft Implementation Plan (worker-side extraction pipeline stage)

**Status**: DRAFT, awaiting user feedback before implementation.
**Scope**: worker/`yt-intel` only — no new Cloudflare Worker (see rationale in chat/ADR).

## Open questions resolved for this draft (subject to feedback)

1. Chunk window: keep 75s default (§9 open Q1) — tune from real data later, not guessed now.
2. Embedding service: `web/lib/embeddings.ts` (`openai/text-embedding-3-small` via OpenRouter), not `TfIdfSimilarityEngine` (§9 open Q4) — real semantic match needed for non-verbatim concepts.
3. Grounding confidence floor: 0.75 cosine similarity starting point, logged per-decision for real tuning (§9 open Q3).

## New files (proposed)

| File | Role |
|---|---|
| `worker/src/services/EntityExtractor.ts` | New service. One call = one chunk (§4.2). Calls `cascade.entityExtraction` (already landed). Returns raw candidate entities per chunk: `{ label, baseType, matchMethod, matchConfidence }[]`. |
| `worker/src/services/GroundingVerifier.ts` | New service. Implements §4.3: exact-substring check OR embedding-similarity-floor check per candidate entity against its source chunk text. Rejects/flags anything that fails both. |
| `worker/src/services/EntityResolver.ts` | New service. Implements §4.4: groups raw per-chunk `GroundedMention`s into canonical `GroundedEntity` records (exact/fuzzy label match + timestamp proximity — the "start simple" approach ADR already specified). |

## Pipeline wiring (where this sits relative to the 11-dimension analysis call)

Resolves ADR §10 open Q2: **run in parallel with the dimension-analysis streaming, not before/after it.** Both consume the same `TranscriptExtractor` segments; chunk-grouping + entity extraction has no dependency on dimension-analysis output (dimensions currently use the whole transcript, not the KG). Parallel execution means zero added wall-clock time to the critical path a user is watching (matches this session's earlier "no visual artifact, pre-warm during idle" discipline applied to a different problem, same principle: don't serialize independent work).

Interacts with ADR 021 (Granular Partial-Resume): entity-extraction results should persist per-chunk as they complete, same "piece present → leave alone, missing → refetch only that piece" model already scoped for dimensions — not scoped further in this draft, flagged for the same future ADR 021 Phase 2-4 work already tracked as not-started.

## Sequenced steps

1. `groupSegmentsIntoChunks` (done, merged) called on real `TranscriptExtractor` output at analysis-kickoff time, alongside (not blocking) the dimension-analysis stream start.
2. Per chunk, parallel calls to `EntityExtractor` (one chunk per call, per §4.2's hard invariant) — real cost/token logging tagged under `cascade.entityExtraction` from the first call, per ADR §7's explicit "only real measurement after Phase 2 ships with its own logging."
3. Each candidate entity passes through `GroundingVerifier` before being kept.
4. All verified per-chunk mentions across the video go through `EntityResolver` to produce the final `GroundedEntity[]` (using the `GroundedEntity`/`GroundedMention` types already landed in Phase 1).
5. Persist `GroundedEntity[]` — needs a real decision: new column/table, or fold into existing `knowledgeGraph` JSONB on `analyses`? (Not resolved in this draft — flagging as a 4th open question this plan surfaces, not in the original ADR §10 list.)
6. **Not in this phase**: retiring `findAllEntityMentions`/`findNearestEntityMentionAcrossDimensions` (§5, Phase 4) — the old and new paths coexist until Phase 4's explicit cutover, so nothing user-visible breaks mid-migration.

## New open question surfaced by this draft (not in ADR §10 originally)

**Where does `GroundedEntity[]` actually persist?** Two real options:
- New `kg_entities`-adjacent table (real precedent: `kg_entities`/`kg_relations` already exist per this session's earlier ADR 023 research, though `kg_relations` was found empty database-wide)
- New JSONB column on `analyses` (matches `knowledgeGraph`'s existing shape, simpler migration, less relational query power)

Not decided in this draft — needs the same real-schema-check discipline as everything else this session (check what `kg_entities`/`kg_relations` actually contain today before assuming either is the right target).

## Test/verification plan (per this session's standing skill-stack discipline)

CORE: qa-intel, contract-auditor, `/simplify` on every file. SELECT: `owasp-top-10` (new external LLM/embedding calls), `supabase-postgres-best-practices` (whichever persistence option is chosen). Real regression tests per new pure-logic piece (matching `chunk-grouping.test.ts`'s pattern), plus one real end-to-end verification against a real video before calling Phase 2 done (matching this session's "negative-control verification" and "E2E chain, not just unit-green" standing rules) — not just unit tests in isolation.

## Sizing (per-PR, matching Phase 1's discipline)

Proposed as 3 small PRs, not one large one, same reasoning as Phase 1: (1) `EntityExtractor.ts` + real cascade wiring, (2) `GroundingVerifier.ts` + confidence-floor logging, (3) `EntityResolver.ts` + persistence decision + pipeline wiring. Each independently reviewable, each small enough to stay clear of review-tool free-tier concerns.
