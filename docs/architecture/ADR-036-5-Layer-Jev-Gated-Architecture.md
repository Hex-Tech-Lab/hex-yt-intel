# ADR 036: 5-Layer Jev-Gated Architecture

- **Status**: ✅ Accepted (user, 2026-09-27) — build pending
- **Date**: 2026-09-27 (confirmed); formalized as ADR 036 on 2026-10-03
- **Supersedes**: none yet — the current 5-bundle Haiku-first cascade (ADR 003 / ADR 011) stays the production default until this ADR's phased build lands and the new path beats it on the full 14-video pool (R6/R7 evaluation contract).
- **Numbering note**: "ADR 036" was pencilled in `docs/history/THOS_2026-09-25_1400_COST_AUDIT_HIGHLIGHTS_LEVERS_PLAN.md:85` for the Jev highlight ranker (H2) but was never written; reassigned to this ADR by user decision (2026-10-03). The H2 highlight ranker needs a new number.
- **Source of record**: `.memory/ADRS.md:29` (user-confirmed 2026-09-27, transcribed below). Bake-off evidence for the model choices: ADR 038.
- **Author**: OC (opencode); user-confirmed.

## 1. Context

Model bake-off + pipeline reengineering for vIntel's analysis engine, judged by **Jev** (`~typesafe/jev-latest` via the OpenRouter Decisions API, resolving `typesafe/jev-1.13-20260917`). User targets: 95 parity / 95 style (Haiku fully dropped if met); interim bar 90/85 non-inferiority; cost target <9¢/analysis normal path, <5¢ stretch (current short-video analysis ≈ $0.145).

Bake-off rounds 1–4 (`docs/history/HANDOVER_2026-09-27-OC-BAKEOFF-PIPELINE-REENGINEERING.md`) established: cheap challengers reach Haiku-level factual parity (GLM-5.3-flash chunked extraction ~90–91.5 parity across English and Arabic videos) but trail on style; judge-slice and truncation artifacts were root-caused and fixed (full-transcript grading validated); Haiku's baseline contamination (extrapolated facts — 401k/529/18%-vs-14% invented on a closed-universe prompt) motivated an evidence-first architecture rather than model swap alone. The user confirmed the 5-layer architecture with classification as Layer 0 on 2026-09-27, folding in 10 binding requirements (R1–R10, transcribed verbatim below).

## 2. Decision — the 5-layer architecture (transcribed from `.memory/ADRS.md:29`)

**LAYER 0 — Jev Classification Gate** (per analysis, ~$0.00001/call): S1–S6 structural class + multi-speaker noul + extrapolation-risk score (POC validated 2026-09-26 over the 14-video pool: choice-type needs keyed criteria record; multi-speaker noul matched ground truth 0.04–0.96). Gate output routes the pipeline: chunk count, speaker-attribution pre-pass (S3/S4), genre-specific dimension emphasis, extrapolation-risk → gate strictness + escalation likelihood.

**LAYER 1 — Evidence Extraction** (cheap challenger model, currently GLM-5.3-flash minimal-reasoning, chunked map-reduce for >24k-char transcripts with fact-preserving merge): produces a typed evidenceLedger (claims with segmentId+timestamp+explicit/derived/inference status, entities, relations, numbers, workflows, contradictions, missing fields). NO prose. This layer fixes the verified Haiku-baseline contamination problem (extrapolated 401k/529/18%-vs-14% facts) by making authenticity the ground truth.

**JEV GATE A**: evidence audit + dimension applicability (e.g. Dim7 present/partial/absent — directly targets the invented-implementation-system failure) + rerun/escalate routing.

**LAYER 2 — Dimension Bundles**: narrow per-bundle prompts = shared TOC + universal guardrails + ONLY the requested dimensions' definitions + evidenceLedger + output contract (current production sends the full 43k-char UCIS prompt ×5 with ~11.5k input tokens each; target 15–17k chars total per bundle, ~40%+ input shave, combined with PR #348 prompt caching). Bundle outputs stay compact.

**JEV GATE B** per bundle: named-entity grounding, numeric provenance, invented-system detection → targeted rerun of affected dimension only.

**LAYER 3 — Canonical Synthesis** (deterministic-leaning merge): dedupe facts, align entity IDs, merge KG, enforce the no-cross-dimension-evidence rule mechanically, attach provenance map. NO prose.

**JEV GATE C**: report integrity (schema sanity, cross-bundle contradiction, material extrapolation presented as fact) → PASS/REPAIR/ESCALATE routing (thresholds: ≥0.90 pass, 0.70–0.89 uncertain, <0.70 escalate).

**Deterministic validation** (code, not LLM): JSON parse, dimension presence/uniqueness, word limits, timestamp format, KG referential integrity, persona weight sum, no trailing text.

**LAYER 4 — Locked Style Rendering**: rewrite the canonical report ONLY for articulation (rhythm, transitions, hierarchy, density); forbidden from adding facts/entities/examples/systems/causal claims or altering numbers, timestamps, uncertainty markers. Candidates by evidence: GLM-identity/Luna/Luna-Pro (~84.6 style), OSS-120B, conditional Haiku 4.5 polish ONLY when gates pass factual validation but style is weak (never polish a factually-unvalidated report).

**Optional LAYER 5** (escalation only): Haiku premium path.

## 3. The 10 binding requirements (R1–R10, verbatim)

- **(R1)** Layer 0 routing contract is versioned + testable — class→chunking/speaker-handling/strictness/escalation mapping must be deterministic, not model-inferred.
- **(R2)** evidenceLedger is the SOLE factual source for later layers — renderers get no permission to consult world knowledge or reinterpret unsupported claims.
- **(R3)** every claim carries provenance: transcript span/timestamp + extraction model + pass + confidence + status (explicit|derived|inference|unsupported).
- **(R4)** Dim7 hard applicability gate — present/partial/absent decides whether a system is rendered, partial/absent must NOT be expanded.
- **(R5)** factual parity and style parity scored separately — style pass gets no credit for preserving a Haiku error, hallucination penalized independently.
- **(R6)** evaluate the whole PIPELINE not individual models — Haiku vs GLM-only vs GLM→OSS vs full Jev-gated path on identical transcripts/metadata/grading state.
- **(R7)** frozen 14-video benchmark set — routing-rule tuning on the same set must be tracked as development data; held-out set added later.
- **(R8)** median + P25/P75 + pass rate + worst-case, reported overall AND stratified by class/language/duration/genre/speaker-count.
- **(R9)** prompt versions + model/provider versions immutable per run — UCIS v5.4/5.1.1 drift fix and the unlogged prompt-update ADR belong to Phase A (baseline reproducibility).
- **(R10)** escalation defined BEFORE implementation: low evidence confidence, failed grounding, invalid JSON, unresolved speaker attribution, weak style after rendering.

**User decision (2026-10-03)**: unsupported facts are **prohibited in the report**. Cross-domain context, if needed, goes in a **separate, clearly labelled, sourced section** that cannot be mistaken for what the video established — never woven into the per-dimension narrative. This is binding on every layer: extraction flags provenance status (R3 `unsupported`), Gate C routes material extrapolation-presented-as-fact to REPAIR/ESCALATE, and Layer 4 rendering may not soften or integrate an `unsupported` item into the body text.

**CRITICAL**: Layer 4 is an evidence-preserving transformation, NOT another analysis pass — it receives the canonical report + evidence ledger (never the transcript or the full UCIS prompt), with fact addition procedurally forbidden.

## 4. Evaluation contract

Comparator set (R6, full pipeline — all four on identical inputs): **Haiku vs GLM-only vs GLM→OSS vs the full Jev-gated path**.

Median + P25/P75 + worst-case per metric, stratified by classification class (S1–S6) and language; pass = parity ≥90 AND style ≥85; production gate 95/95 (user target — Haiku fully dropped if met); unsupported-claim rate and schema validity reported separately. The operational detail of these gates (enablement bar, holdout set, cluster bootstrap) is preregistered in ADR 038 §4b–§4c and is normative for both ADRs.

## 5. Cost model

Current short-video analysis $0.145 (user's OpenRouter log math, 2026-09-26); targets <9¢ normal path, <5¢ stretch; Haiku polish only on gated escalations; Jev gates ≈ $0.0006/full-ctx grade.

## 6. Build phasing

- **Phase A** — bake-off tooling permanence (full-ctx grading + chunked extraction + draft persistence into `scripts/bakeoff-l2-evaluator.ts`).
- **Phase B** — Layer 0 + 1 behind Settings Registry `analysis.pipeline.mode`.
- **Phase C** — bundles + gates.
- **Phase D** — synthesis + render + escalation.

Each phase lands behind the registry flag; the current Haiku cascade remains the default until the new path beats it on the full 14-video pool with stratified reporting.

## 7. Implementation status (TRUE as of 2026-10-03)

| Item | Status |
|---|---|
| Phase A (harness: full-ctx Jev grading, chunked extraction, promptVersion pinning) | ✅ done — `scripts/bakeoff-l2-evaluator.ts` v2, type-checked and 1-video stripe validated (2026-09-27) |
| UCIS v5.4 drift fixes D1–D5 (retroactive ADR, `.memory/ADRS.md:31`) | ✅ done |
| R1b dim-8 epistemic split (PR #363) | ✅ shipped (partial fix for Haiku contamination cause) |
| R2b signed projective context (PR #368) | ✅ shipped (partial fix for Haiku contamination cause) |
| Phase B (Layer 0 + 1) | ❌ NOT built |
| Phase C (bundles + gates) | ❌ NOT built |
| Phase D (synthesis + render + escalation) | ❌ NOT built |
| Frozen 14-video pool, full run | ❌ never fully run (only stripe rounds 1–4 + classification POC) |
| Production | ⚠️ still runs the 5-bundle Haiku-first cascade (see ADR 038 §1.1 trace) |

## 8. Consequences

- Production cost/quality stays on the incumbent cascade until Phases B–D land and the R6 evaluation on the frozen pool clears the gate — no silent model flip.
- The layering makes Layer 4's style problem separable from factual integrity: extraction quality (GLM parity evidence) and articulation (style evidence) are addressed by different layers, matching the bake-off's observed failure mode.
- The contamination root cause is partially addressed in production already (R1b dim-8 epistemic split, PR #363; R2b signed projective context, PR #368); the full fix is the evidenceLedger architecture itself (R2/R3).
- Registry-gated phasing (`analysis.pipeline.mode`) gives per-phase rollback without deploys.

## 9. Related

- ADR 038 — analysis model cascade (Layers 1–4 model economics, from the same bake-off evidence).
- ADR 037 — Jev semantic chunking (not approved for build; interacts with Layer 0/2 chunking).
- Retroactive UCIS v5.4 drift ADR — `.memory/ADRS.md:31` (Phase A prerequisite, done).
- Bake-off record: `docs/history/HANDOVER_2026-09-27-OC-BAKEOFF-PIPELINE-REENGINEERING.md`; `.memory/AGENT_LEDGER.md` rounds 3–4 entries; `docs/history/BAKEOFF_L2_TRENDS_LATEST.json`.
