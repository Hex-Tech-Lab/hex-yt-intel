# Design — ADR 036 Phase B: Layer 0 (Jev classification) + Layer 1 (evidence extraction) + Jev Gate A

**Status:** design only — no executable pipeline code until a route passes ADR 038 §4b (user directive 2026-10-03, ADR 038 "What a failed gate means"). Written 2026-10-03 against `main` `25688c08`.
**Scope:** interfaces, the `analysis.pipeline.mode` gate, the Gate A contract, the test plan. Phases C (bundles + Gate B) and D (synthesis + render + escalation) are out of scope except where Phase B's outputs must fit them.

---

## 1. Verified starting point

| Fact | Evidence |
|---|---|
| `analysis.pipeline.mode` does **not** exist in code or migrations (ADR 032 planned `legacy \| relay`, never built). Phase B introduces it. | `grep -rn "analysis.pipeline.mode" web worker supabase` → no hits |
| Today's "Jev plan" is a **chunking plan** (K, cells with word ranges + sha256), stored in `analyses.jev_plan`, fetched by the worker from Vercel's S2S `/plan` route. It is not a classification. | `web/lib/jev/stored-plan.ts:1-30`; `worker/src/routes/analysis.ts:978` `fetchJevPlan` |
| The repo's Jev integration pattern is a **port + adapter**: `CommentClassificationPort` + `JevCommentClassifier` calling `POST https://openrouter.ai/api/alpha/decisions` (Decisions API, never a chat model). | `worker/src/ports/CommentClassificationPort.ts`; `worker/src/services/JevCommentClassifier.ts:24,158-257` |
| `LLMCascade` is single-prompt first-success fallback; it cannot stage, route per stage, or set per-stage reasoning effort (hardcoded `effort: 'low'`). | ADR 038 §1, §4a(1); `worker/src/services/LLMCascade.ts:400,591` |
| Worker CPU: Workers Free 10 ms CPU/request is strictly enforced since 2026-09-23. | ADR 032 |
| Classification today = dimension 11 inside the analysis bundles (`extraFields: ['classification', ...]`), produced by the analysis LLM — not by Jev. | `web/lib/config/synthesis.ts` `DIMENSION_CONFIGS[11]`; PR #426 |

## 2. Where Phase B runs

**Vercel (Fluid Compute), not the worker.** Layer 0 and Layer 1 are multi-call, parse-heavy stages (Jev decisions, chunked GLM map-reduce, evidence merge, Gate A audit). The worker's 10 ms CPU budget cannot hold them (ADR 032). Phase B runs as a server-side orchestration step that the browser triggers exactly like today's analysis start, and whose output (classification + evidenceLedger) is persisted before any Phase C bundle runs.

**Trigger (decided 2026-10-03): a QStash job.** Phase B runs as a QStash-delivered job, so a closed or refreshed tab never kills a multi-minute map-reduce, each job stays inside Vercel's execution ceiling, and failures are isolated per job. The job flushes partial state to Supabase as chunks settle; the client hydrates progress from that state, not from a held-open request.

## 3. The `analysis.pipeline.mode` gate

- Registry key `analysis.pipeline.mode` (`setting_definitions` + system `setting_values`, same seeding pattern as `supabase/migrations/20260930160000_*`), `data_type: 'string'`, `validation: {"enum": ["legacy", "layered"]}`, default `"legacy"`.
- Resolved **once per analysis at creation** (`CreateAnalysisUseCase`) and **frozen onto the analysis row** (new column `pipeline_mode text not null default 'legacy'`). Every later reader (persist, finalize, reaper, restore) reads the row, never the registry, so a registry flip mid-flight cannot split one analysis across two pipelines.
- `legacy` = today's path, byte-for-byte. The flag check is the only change on the legacy path; a test pins that a `legacy` analysis issues exactly today's requests.
- `layered` = Phase B stages run, then (until Phase C exists) the legacy bundles run unchanged with the ledger available but unused. Phase B is therefore observable in production shadow mode without changing a user-visible byte. Shadow output goes to new tables only (§4.4).
- Not signed into the stream token in Phase B (no worker behavior depends on it yet). When Phase C makes the worker's prompt depend on the ledger, the mode and a ledger digest move into the signed v2 token (same reasoning as ADR 037: anything that changes worker behavior is signed).

## 4. Interfaces (Hexagonal-Lite)

### 4.1 Layer 0 — classification

```ts
// web/lib/ports/VideoClassificationPort.ts
export type StructuralClass = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
export interface VideoClassification {
  structuralClass: StructuralClass;
  speakerCount: number;            // Jev noul, rounded per ADR 036 POC (matched GT 0.04–0.96)
  multiSpeaker: boolean;
  extrapolationRisk: number;       // 0–1
  language: string;                // BCP-47, from transcript provider metadata, not Jev
  judge: { model: string; resolvedModel: string; costUsd: number };
}
export interface VideoClassificationPort {
  classify(input: { transcript: string; metadata: VideoMetadataLite }): Promise<VideoClassification>;
}
```

Adapter `JevVideoClassifier` mirrors `JevCommentClassifier` (same Decisions API, same verified request/response shape, typed choices + noul). The S1–S6 definitions and keyed criteria come from the 2026-09-26 POC (ADR 036 §2: "choice-type needs keyed criteria record") and must be committed as a versioned criteria file, not inline strings.

Routing output (pure function, domain): `routeFromClassification(c) → { attributionPrePass: boolean; gateStrictness: 'standard' | 'strict'; escalationLikely: boolean }`. Thresholds are registry keys (`analysis.layer0.*`), never literals.

### 4.2 Layer 1 — evidence extraction

```ts
// web/lib/ports/EvidenceExtractionPort.ts
export type EvidenceStatus = 'explicit' | 'derived' | 'inference';
export interface EvidenceClaim {
  id: string;
  text: string;
  status: EvidenceStatus;
  segmentId: string | null;        // worker-fetched segment id only (#417 provenance)
  timestamp: string | null;        // HH:MM:SS from a trusted segment, else null — never model-invented
  dimensions: number[];            // dimensions this claim is evidence for
}
export interface EvidenceLedger {
  claims: EvidenceClaim[];
  entities: { id: string; name: string; type: string; claimIds: string[] }[];
  relations: { from: string; to: string; type: string; claimIds: string[] }[];
  numbers: { value: string; unit: string | null; claimId: string }[];
  workflows: { name: string; steps: string[]; claimIds: string[] }[];
  contradictions: { claimIds: [string, string]; note: string }[];
  missingFields: { dimension: number; field: string }[];
  provenance: { model: string; provider: string; reasoningEffort: 'minimal'; promptVersion: string; chunks: number; costUsd: number };
}
export interface EvidenceExtractionPort {
  extract(input: { transcript: string; segments: TrustedSegment[] | null; classification: VideoClassification }): Promise<EvidenceLedger>;
}
```

- Adapter `GlmEvidenceExtractor`: GLM-5.3-Flash, `reasoning.effort: 'minimal'`, chunked map-reduce for transcripts > 24k chars (24k windows, 2k overlap) with the fact-preserving merge validated in bake-off Round 3 (`scripts/bakeoff-l2-evaluator.ts` `chunkTranscript`). NO prose output — JSON only, Zod-validated (`EvidenceLedgerSchema`), with the never-reject normalization pattern from #419 for model drift.
- Per-stage model, provider and **reasoning effort** come from a new registry key `cascade.layer1` (`CascadeItem[]` extended with `reasoningEffort`) — this is the ADR 038 §4a prerequisite that `LLMCascade` cannot express. Phase B does not touch `LLMCascade`; it adds a small `StagedModelClient` (one call = one model + provider pin + effort + fallback list) used only by layered stages.
- Timestamps: a claim's `timestamp` is filled **only** by mapping its `segmentId` to a worker-fetched segment (the #417 trust rule). A model-emitted time string without a trusted segment is dropped to `null`.

### 4.3 Jev Gate A

```ts
export type GateVerdict = 'PASS' | 'REPAIR' | 'ESCALATE';
export interface GateAResult {
  verdict: GateVerdict;
  score: number;                                   // 0–1
  applicability: Record<number, 'present' | 'partial' | 'absent'>;   // per dimension 1–11
  unsupportedClaimIds: string[];                   // claims Jev finds unsupported by the transcript
  rerun: { chunkIndexes: number[] } | null;        // REPAIR: re-extract only these chunks
}
export interface EvidenceAuditPort {
  audit(input: { transcript: string; ledger: EvidenceLedger; classification: VideoClassification }): Promise<GateAResult>;
}
```

- Thresholds (decided 2026-10-03: the same ADR 036 bands for Gates A, B and C, to avoid drift between gates): `score ≥ 0.90` PASS, `0.70–0.89` REPAIR (one targeted re-extraction of the flagged chunks, then re-audit once), `< 0.70` ESCALATE. All three are registry keys `analysis.gateA.*`. `gateStrictness: 'strict'` from Layer 0 raises the PASS bar (registry).
- Unsupported claims are **removed** from the ledger before Phase C (never passed on), and counted in telemetry — this is the mechanism that addresses the Haiku-baseline contamination ADR 036 §2 names.
- `applicability: 'absent'` for a dimension means Phase C must render "not covered in this video" for it, never invent (directly targets the invented-implementation-system failure on Dim 7).
- ESCALATE in Phase B = mark the analysis `layered_status = 'escalated'` and continue on legacy output (shadow mode); Phase D defines the real escalation path.

### 4.4 Persistence (new, additive)

- `analysis_layers` table: `analysis_id` (FK), `layer` (`'L0' | 'L1' | 'GA'`), `payload jsonb`, `cost_usd numeric`, `model text`, `created_at`. RLS: service-role write; owner read via the existing `analyses` ownership join (ADR 009 pattern). Retention follows the analysis.
- Migration naming per ADR 018 (apply via `apply_migration`, then rename the local file to the recorded version).

## 5. Test plan

| Layer | Test | Negative control |
|---|---|---|
| Gate | `legacy` analysis issues exactly today's requests (snapshot of the request list) | flip the gate check → snapshot fails |
| Gate | mode frozen at creation: registry flip mid-analysis does not change the row's `pipeline_mode` | read registry in persist → test fails |
| L0 | `JevVideoClassifier` request matches the verified Decisions API shape; noul → `speakerCount` rounding; malformed Jev response → typed error, not a default class | return a default on error → test fails |
| L0 | `routeFromClassification` thresholds come from registry fallbacks; boundary values | hardcode a literal → qa-intel no-hardcoded-tunables rule fails |
| L1 | chunking boundaries (24k/2k), merge dedupes overlap claims, `EvidenceLedgerSchema` accepts known GLM drift and rejects prose | skip normalization → drift fixture fails |
| L1 | model-invented timestamp without a trusted `segmentId` → `null` | trust the model's time string → test fails |
| L1 | `StagedModelClient` sends `reasoning.effort: 'minimal'` and the provider pin from `cascade.layer1` | hardcode `'low'` → test fails |
| GA | PASS / REPAIR (exactly one re-extraction of flagged chunks, one re-audit) / ESCALATE routing at the three bands | allow a second REPAIR loop → test fails |
| GA | unsupported claims removed from the ledger before persistence; `absent` applicability recorded | pass the raw ledger through → test fails |
| E2E | one recorded transcript fixture through L0 → L1 → GA with recorded model responses (no live calls in CI); asserts persisted `analysis_layers` rows and unchanged legacy output | — |
| Live | after the build is authorized: the 14-video pool in shadow mode, comparing the ledger's unsupported-claim rate against the bake-off's Haiku arm | — |

## 6. Rollout (once a route passes ADR 038 §4b)

1. Ship Phase B with the key at `legacy` (dark).
2. Flip to `layered` for an internal allowlist (registry scope `user`, already supported by `setting_values.scope_type`), shadow only.
3. Read telemetry (cost per layer, Gate A verdict mix, unsupported-claim rate) for a week before Phase C starts.
4. Rollback = set the key back to `legacy`; frozen per-analysis mode means in-flight layered analyses finish on their own path.

## 7. Open questions for the user

- ~~Q1~~ — decided 2026-10-03: QStash job (§2).
- ~~Q2~~ — decided 2026-10-03: ADR 036 bands (0.90 / 0.70) for every gate (§4.3).
- **Q3** — S1–S6 criteria: the POC's keyed criteria text was never saved (only per-video labels in `/tmp/opencode/pool_classification.json`). A v1 taxonomy (user-approved 2026-10-03) is being committed as `docs/architecture/S1_S6_TAXONOMY.md` + `web/lib/jev/taxonomy.ts`, with a re-classification check against the POC labels before Phase B relies on it.
- **Q3 agreement result (2026-10-03)**: re-classification over the pool (12/14 classified, 2 transcripts uncached) found **4/12 (33%) class agreement** between the reconstructed v1 criteria and the POC labels — the v1 wording is NOT classifier-equivalent to the lost POC criteria; disagreements concentrate on the S2/S3 (interview vs panel) and S5 boundaries, with multiSpeaker broadly consistent. Tighten v1 criteria and re-run `scripts/jev-classify-pool.ts`, or adopt v1 labels as the new baseline — needs a user call. Details: `docs/architecture/S1_S6_TAXONOMY.md` + `docs/architecture/S1_S6_POOL_RECLASSIFICATION.json` ($0.0037 total).
