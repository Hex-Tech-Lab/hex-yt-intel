# ADR 038: Analysis Model Cascade — Jev-Gated Model Selection from Bake-Off Evidence

- **Status**: ✅ Accepted (user, 2026-10-03) — **production rollout gated** (see §4)
- **Date**: 2026-10-03 (this document fully replaces the 2026-10-03 PROPOSED draft of the same number)
- **Supersedes (for the analysis path only)**: ADR 003 / ADR 011 ("Haiku 4.5 primary"). Chat / digest / stance / entity-extraction cascades are unchanged.
- **Superseded by**: none
- **Architecture context**: implements the model economics of ADR 036 (5-Layer Jev-Gated Architecture, Accepted 2026-09-27) — Layers 1–4 model selection; does not change layering, gates, or the evaluation contract.
- **Author**: OC (opencode). No cascade code changed in this step.

## 1. Decision — the exact cascade

User decision (2026-10-03), mapped to ADR 036 layers:

| Layer (ADR 036) | Model | Reasoning effort | Role |
|---|---|---|---|
| Layer 0 | **Jev** (`~typesafe/jev-latest`, Decisions API) | — | classification gate + gates A/B/C (≈$0.0006/full-ctx grade) |
| Layer 1 — Evidence Extraction | **`z-ai/glm-5.3-flash`** | **`minimal`** | chunked map-reduce extraction → typed evidenceLedger, no prose |
| Layer 4 — Locked Style Rendering | **`openai/gpt-oss-120b`** | **`minimal`** | evidence-preserving articulation pass over canonical report + ledger (canonical report only — never the transcript) |
| Fallback (when a tier produces zero tokens) | **`openai/gpt-6-luna`** — **NOT Luna Pro** | minimal | reliability fallback tier |
| Layer 5 (escalation only) | **Haiku 4.5** | — | gated escalation path ONLY (R10: low evidence confidence, failed grounding, invalid JSON, unresolved speaker attribution, weak style after rendering); never the default path |

Notes:
- **Luna, not Luna Pro.** On the v2 stripe the two are indistinguishable (identical 81/70 median parity/style on the same dims; see §2) while Luna Pro costs 2×. Pro is therefore not used anywhere in this cascade. (This replaces the prior draft's `gpt-6-luna-pro` tier 3; the gpt-6-vs-gpt-5.6 ambiguity is mooted by the Luna-only choice.)
- **Haiku 4.5 is removed from the routine analysis path.** It survives only as the Layer 5 gated escalation. The legacy `testOverride` / `model_config` plans and `admin_settings.model_cascade` that still name Haiku-first for analysis must be updated in the rollout step so no stale path reintroduces it.
- Registry ownership: the cascade lives under **`cascade.analysis`** in `app_settings` (code already reads it at `web/lib/config/cascade.ts:110-116`; the key is ABSENT in prod today — seeding it is what makes the change registry-driven). Keep `ANALYSIS_CASCADE_FALLBACK` in code in sync. Rollback = rewrite the registry value back to the incumbent Haiku list (verbatim values in Appendix A) — no deploy.
- OSS-120B context is **131,072 tokens**: fine for Layer 4, which receives the canonical report + evidence ledger (current canonical shapes ≈20k tokens/call). It is **ruled out as a transcript reader** — full transcripts measured up to 177.5k chars (~45k tokens, 39hqY3nH5ug) plus prompt would breach 131k; transcript reading stays on Layer 1's GLM (1M ctx).

## 2. Evidence — bake-off record (Jev-judged)

Sources: `docs/history/HANDOVER_2026-09-27-OC-BAKEOFF-PIPELINE-REENGINEERING.md` (rounds 1–4; user's 5 messages verbatim in §8), `.memory/AGENT_LEDGER.md` lines 1423–1424 (rounds 3–4), `docs/history/BAKEOFF_L2_TRENDS_LATEST.json` (v2 stripe), `/tmp/opencode/articulation-exercise.mts` (two-phase POC). Judge: Jev full-transcript grading, transcript-grounded parity + style vs the Haiku baseline. promptVersion pinned per run: "UCIS v5.4 (c4125116) — unmodified" (R9).

### 2.1 Rounds 1–4

| Round | Video | Extraction winner | Articulation matrix (full-ctx) | Notes |
|---|---|---|---|---|
| 1 | Z6l4HpuyyP0 (10m finance) | GLM 90.7 parity | GLM→OSS best (3/11 passes) | naive 12k judge slice (minor here) |
| 2 | ymgH8jS6Wb8 (16m) | top-3 within ~1.2 pts (Luna Pro 83.4, OSS 82.4, GLM 82.0) | 0/11 passes on all — video-dependent | |
| 3 | MoBr0nQtOnA (40m) | GLM chunked extraction **91.5 avg parity (90–93 all 11 dims), style 84.8** | GLM-identity 91.5/84.6 (5/11), Luna-Pro 91.6/83.6 (5/11), Luna 90.9/84.1 (4/11), **OSS 88.8/81.4 (2/11)**, Llama 65.9/46.5 (0/11 — collapses on 96k input) | 24k-slice had collapsed ALL extractors (20–45); chunking + full-ctx grading recovered |
| 4 | 1U8-4N1HNtU (Arabic 23m) | GLM medP=90/medS=83 (4/11) | Luna 88/76, Luna-Pro 86/75, **OSS 83/80**, Llama 60/55 | cross-lingual hold |

### 2.2 v2 stripe (single video, 12 dims, `BAKEOFF_L2_TRENDS_LATEST.json`)

Median parity/style across the 12 graded dims:

| Model | medInfo | medStyle |
|---|---|---|
| GLM-5.3-Flash | 88/83 (per-dim; ledger headline 88/83) | — |
| GPT-OSS-120B | 80 | 79 |
| GPT-6-Luna | 81 | 70 |
| GPT-6-Luna-Pro | 81 | 70 |
| Llama-3.3-70B | 68 | 67 |

(Exact per-dim medians; GLM 88/83 aggregate matches the ledger's "GLM 88/83" summary for this stripe.)

### 2.3 Findings the decision rests on

- **GLM led extraction on every full-context round**: parity 90.7 → 91.5 → 89.4 across rounds 1/3/4 — holds cross-lingually (round 4 is Arabic). Style 81–84.6 remains the gap.
- **Luna ≈ Luna Pro**: identical 81/70 medians on the v2 stripe. Luna Pro's 2× price buys nothing measurable → Pro is not used.
- **Two-phase GLM→OSS won Round 1** (the original motivation for an articulation pass — `/tmp/opencode/articulation-exercise.mts` lines 19, 58, 69: GLM `reasoning.effort: 'minimal'` per-dim extraction → single `openai/gpt-oss-120b` articulation pass → Jev grades). **BUT** on the later full-ctx rounds OSS scored below GLM/Luna on style — R3: 81.4 vs 84.6 (GLM-identity); R4: 80 vs 83 (GLM). The user's choice of OSS as the Layer 4 renderer is recorded WITH these numbers on the table: OSS is a deliberate pick as a cheap, evidence-preserving articulation tier, not a style winner, and the Layer 4/5 style lever (conditional Haiku escalation on weak style, R10) covers the gap. The R6 pipeline-level bake-off on the frozen pool re-tests GLM-only vs GLM→OSS end-to-end before rollout.
- **Cost**: prior draft's table stands — Haiku today $0.11–0.17 K=1, **$1.128 K=11** (crucible `3daf3be2`) vs ≈$0.03–0.09 for the new cascade, meeting the $0.05–0.09 target (§ of the archived draft, preserved in git history at `a58f688e`).

### 2.4 The contamination cause (why extraction moved off Haiku)

User-identified cause (2026-10-03): the prompt demanded cross-domain bridges while declaring the video a closed universe; Haiku extrapolated (invented 401k/529/18%-vs-14% facts on Z6l4HpuyyP0). Partial fixes already shipped: **R1b dim-8 epistemic split (PR #363)**, **R2b signed projective context (PR #368)**. The structural fix is ADR 036's evidenceLedger (R2/R3) with GLM extraction.

## 3. Consequences

**Positive**
- K=11 crucible-class runs drop from $1.13 → ≈$0.03–0.09 (≥12× on the measured run).
- Registry-driven and rollback-able without deploy (Appendix A holds the incumbent value verbatim).
- Same `CascadeItem`/`buildRequestProvider` contract already exercised by chat/digest/stance (`LLMCascade.ts:36-53`); pinned `allow_fallbacks: false` provider orders as per the standing standard.

**Risks**
- Invalid-JSON is not caught by zero-token fall-through — that class belongs to ADR 036's Jev Gate C / Layer 5 escalation (R10), not the cascade fallback.
- OSS style deficit vs GLM-identity is measured (§2.3); if the frozen-pool R6 run shows GLM-only style ≥85, the Layer 4 tier becomes redundant and drops out by registry edit.
- Anthropic-only `cache_control` breakpoints no-op on non-Anthropic tiers (`LLMCascade.ts:328-354` guard handles this safely); cost estimates assume no cache discount — conservative.
- `testOverride.enabled=true` in prod (`app_settings.model_config`) pins Haiku-first for stale clients without `cascade` in the payload — must be cleared/rewritten in the rollout step (Appendix A).

## 4. Rollout gate (production is NOT flipped by this ADR)

Before flipping prod:

1. Run the **frozen 14-video pool** through `scripts/bakeoff-l2-evaluator.ts` (v2 permanent harness) comparing **Haiku vs GLM-only vs GLM→OSS** on identical transcripts/metadata/grading state (R6), with median+P25/P75+worst-case stratified reporting (R8).
2. Only if the R6 evaluation clears the ADR 036 interim bar (parity ≥90 / style ≥85 non-inferiority) does `cascade.analysis` get seeded; the production gate 95/95 remains the Haiku-drop condition (ADR 036 §4).

Rollback = registry: restore the incumbent list from Appendix A into `cascade.analysis`; takes effect next analysis, no deploy.

## Appendix A — the pre-change production state (cascade trace, carried from the prior draft; verified 2026-10-03 at `e8692858`)

This is the factual trace of why every run lands on Haiku 4.5 today, kept as the rollback/audit record. The cascade decision proper is §1–§4 above.

**Selection (Vercel, per-request):**

1. `web/lib/usecases/CreateAnalysisUseCase.ts:190` — `resolveAnalysisCascade()` resolves the full registry cascade (model id + name + cost + providerOrder per tier).
2. `web/lib/config/cascade.ts:110-116` — `resolveCascade('cascade.analysis', …)` reads registry key **`cascade.analysis`** via `SupabaseSettingsAdapter.getRegistrySettings`, falling back to `ANALYSIS_CASCADE_FALLBACK` (`cascade.ts:50-59`) only if the registry is unreachable/empty. The fallback is 4× `anthropic/claude-haiku-4.5` (Vertex → Azure → Anthropic Direct → Bedrock) + 2× `claude-sonnet-5`.
3. `CreateAnalysisUseCase.ts:188` — in parallel, `resolveModels(tier, 'analysis')` resolves the legacy flat model-id list for the signed token: `web/lib/adapters/SettingsModelAdapter.ts:85-122` reads the `model_config` row of `app_settings`, falling back to `FALLBACK.analysis`.
4. `CreateAnalysisUseCase.ts:479-484` — both are forwarded into the signed stream payload: `models` (flat ids, HMAC-signed) AND `cascade` (full tiers with providerOrder, unsigned body field).

**Registry rows driving this (read 2026-10-03, prod):**

- `app_settings.model_config` (the ONLY row in `app_settings` in prod):
  - `plans.pro.analysis = ["anthropic/claude-haiku-4.5", "nvidia/nemotron-3-nano-30b-a3b:free", "z-ai/glm-4.5-air:free", "google/gemma-4-26b-a4b-it:free"]`
  - `plans.free.analysis = ["nvidia/nemotron-3-nano-30b-a3b:free", "z-ai/glm-4.5-air:free", "google/gemma-4-26b-a4b-it:free", "anthropic/claude-haiku-4.5"]`
  - `plans.enterprise.analysis` = same as pro.
  - **`testOverride.enabled = true`**: `analysis = ["anthropic/claude-haiku-4.5", "nvidia/nemotron-3-nano-30b-a3b:free"]` — every run is Haiku-first via this path.
- `admin_settings.model_cascade` (id=default) = `["nemotron-3-nano", "claude-haiku-4-5"]` — legacy client-display/routing shape (`web/lib/config/synthesis-with-settings.ts:55`); not the worker's execution list.
- **`cascade.analysis` does NOT exist in prod `app_settings`** — the registry-resolved path always falls back to `ANALYSIS_CASCADE_FALLBACK`.

**Execution (Cloudflare Worker):**

5. `worker/src/routes/analysis.ts:117` — the request contract accepts `cascade`: "worker uses `cascade` when present; `models` stays as the signed/legacy fallback for stale clients."
6. `worker/src/routes/analysis.ts:1794` — `new LLMCascade(apiKey, req.models, req.cascade, req.maxOutputTokens, …)`.
7. `worker/src/services/LLMCascade.ts:80-105` — constructor requires a non-empty cascade (SSOT violation error otherwise); `this.chain = cascade`. Iterated **first-tier-wins**: fall-through only when the current tier produces zero tokens (network/HTTP error, timeout, abort).
8. `LLMCascade.ts:319-383` (`callLLMStream`) — per-tier OpenRouter request: single `model` field, `provider: { order: providerOrder, allow_fallbacks: false }` for pinned tiers (`buildRequestProvider`, `LLMCascade.ts:36-53`), `max_tokens` from registry `analysis.maxOutputTokens.*`, `reasoning: { effort: 'low' }`, Anthropic `cache_control` split when prompt caching is enabled. `translateModelId` (`worker/src/services/model-id-translator.ts`) is currently a no-op passthrough.
9. `LLMCascade.ts:564-600` (`callLLM`) — identical construction for the non-streaming legacy path.

**Accounting:** response usage extracted (`LLMCascade.ts:300-306`); `model_used` / `cost_usd` / `tokens_used` / `cached_tokens` written through `web/app/api/analyses/persist/route.ts:791, 969, 1003, 1059, 1125, 1429, 1530` and `202-212, 306, 348, 638, 1220-1223`.

**Hardcode/default inventory (the effective live list is the code fallback, since the registry key is absent):**

| Location | Value | Role |
|---|---|---|
| `web/lib/config/cascade.ts:54-59` | 4× `anthropic/claude-haiku-4.5` + 2× `claude-sonnet-5` | hardcoded fallback, IS the effective live list |
| `app_settings.model_config` `testOverride.analysis` | `["anthropic/claude-haiku-4.5", "nvidia/nemotron-3-nano-30b-a3b:free"]`, `enabled: true` | flat signed-token list (legacy `models`) |
| `app_settings.model_config` `plans.{pro,free,enterprise}.analysis` | Haiku-first lists | tier plans (bypassed while `testOverride.enabled`) |
| `admin_settings.model_cascade` | `["nemotron-3-nano", "claude-haiku-4-5"]` | legacy client-side display/routing shape |
| `web/lib/config/synthesis-with-settings.ts:55` | `['nemotron-3-nano', 'claude-haiku-4-5']` | fallback for the legacy shape |
| `web/lib/config/cascade.ts` `CASCADE_FALLBACKS.{chat,digest,stance,entityExtraction,reasoning*}` | gpt-oss-120b / gemini / llama / o3-mini lists | other paths, NOT analysis |

**Why Haiku wins every run**: it is first in the effective list AND it succeeds — a pure configuration outcome (first-tier-wins + healthy Vertex route), not a reliability one. Live facts (CC-verified 2026-10-03): prod `testOverride.enabled = true` with analysis `[anthropic/claude-haiku-4.5, nvidia/nemotron-3-nano-30b-a3b:free]`; Carmack K=11 cost $1.128; GPT-OSS-120B context 131,072.
