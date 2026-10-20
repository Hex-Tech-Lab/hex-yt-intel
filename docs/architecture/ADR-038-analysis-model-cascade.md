# ADR 038: Analysis Model Cascade — Jev-Gated Model Selection from Bake-Off Evidence

- **Status**: ✅ Accepted (user, 2026-10-03) — **production rollout blocked on the Phase B–D orchestrator + the preregistered frozen-pool and holdout gates (§4)**
- **Date**: 2026-10-03 (this document fully replaces the 2026-10-03 PROPOSED draft of the same number)
- **Supersedes (for the analysis path only)**: ADR 003 / ADR 011 ("Haiku 4.5 primary"). Chat / digest / stance / entity-extraction cascades are unchanged.
- **Superseded by**: none
- **Architecture context**: implements the model economics of ADR 036 (5-Layer Jev-Gated Architecture, Accepted 2026-09-27) — Layers 1–4 model selection; does not change layering, gates, or the evaluation contract.
- **Author**: OC (opencode). No cascade code changed in this step.

## 1. Decision — the exact cascade

User decision (2026-10-03), mapped to ADR 036 layers:

| Layer (ADR 036) | Model | Reasoning effort | Role |
|---|---|---|---|
| Layer 0 | **Jev** (`~typesafe/jev-latest`, Decisions API) | — | classification + routing gate ONLY (S1–S6 class, speaker count, extrapolation-risk score). Gates A/B/C are NOT Layer 0 — Gate A sits after Layer 1 extraction, Gate B after each Layer 2 dimension bundle, Gate C after Layer 3 synthesis (ADR 036 §2). Jev also grades each gate call at ≈$0.0006/full-ctx grade; the per-analysis Layer 0 classification call itself is ≈$0.00001. |
| Layer 1 — Evidence Extraction | **`z-ai/glm-5.3-flash`** | **`minimal`** | chunked map-reduce extraction → typed evidenceLedger, no prose |
| Layer 4 — Locked Style Rendering | **`openai/gpt-oss-120b`** | **`minimal`** | evidence-preserving articulation pass over canonical report + ledger (canonical report only — never the transcript) |
| Fallback (when a tier produces zero tokens) | **`openai/gpt-6-luna`** — **NOT Luna Pro** | minimal | reliability fallback tier |
| Layer 5 (escalation only) | **Haiku 4.5** | — | gated escalation path ONLY (R10: low evidence confidence, failed grounding, invalid JSON, unresolved speaker attribution, weak style after rendering); never the default path |

Notes:
- **Luna, not Luna Pro.** On the v2 stripe the two are indistinguishable (identical 81/70 median parity/style on the same dims; see §2); both list at the same OpenRouter price ($0.10 / $0.50 per M tokens, checked 2026-10-03), so Pro adds nothing. Pro is therefore not used anywhere in this cascade. (This replaces the prior draft's `gpt-6-luna-pro` tier 3; the gpt-6-vs-gpt-5.6 ambiguity is mooted by the Luna-only choice.)
- **Haiku 4.5 is removed from the routine analysis path.** It survives only as the Layer 5 gated escalation. The legacy `testOverride` / `model_config` plans and `admin_settings.model_cascade` that still name Haiku-first for analysis must be updated in the rollout step so no stale path reintroduces it (procedure in §4a).
- Registry ownership — **verified against code 2026-10-03**: the cascade is NOT a row of `app_settings`. `resolveAnalysisCascade()` (`web/lib/config/cascade.ts:118`) reads registry key `cascade.analysis` via `SupabaseSettingsAdapter.getRegistrySettings`, which queries the **`setting_definitions`** table (key + default_value, `web/lib/adapters/SupabaseSettingsAdapter.ts:81`) and **`setting_values`** (scope_type='system', scope_id null, `SupabaseSettingsAdapter.ts:82`) — the same Wave-S registry tables used by `remediation.*`/`billing.*`/`digest.*` keys. `app_settings.model_config` is the separate legacy flat-list path (`SettingsModelAdapter.ts:85-122`). Seeding `cascade.analysis` therefore means inserting one `setting_definitions` row + a system-scope `setting_values` row, not touching `app_settings`. Keep `ANALYSIS_CASCADE_FALLBACK` in code in sync (`cascade.ts:50-59`). Rollback = rewrite the registry value back to the incumbent Haiku list (verbatim values in Appendix A) — no deploy.
- **The current `LLMCascade` cannot execute this cascade as staged** (verified `worker/src/services/LLMCascade.ts:119-121, 185-205`): it is a single-prompt **first-success fallback** — it iterates the tier list and falls through only when a tier produces zero tokens (network/HTTP error, timeout, abort; `streamCascade` doc comment at `LLMCascade.ts:119` and the mid-stream fallback at `:185-205`). It has no concept of stages with different prompts, no quality-triggered escalation, and hardcodes `reasoning: { effort: 'low' }` at both call sites (`LLMCascade.ts:400` streaming, `:591` non-streaming) with no per-tier field — so the table's `minimal` per-tier effort is **not reproducible without code change** (a registry list can only carry model ids/name/cost/providerOrder — `CascadeItem` shape, `web/lib/config/cascade.ts:10-15`). A sequential orchestrator implementing ADR 036 Phases B–D (Layer 1 extraction → Gate A → Layer 2 bundles → Gate B → Layer 3 synthesis → Gate C → Layer 4 rendering → conditional Layer 5 escalation) must exist first; see §4a Deployment prerequisites.
- **Trust boundary of the `cascade` request field — documented, not fixed here (verify finding)**: the signed v2 stream token HMACs `models` (flat ids — `worker/src/routes/analysis.ts:305-310`: `modelStr = [...(models ?? [])].sort().join(",")` is part of the signed message in both v1 and v2) but `cascade` is an **unsigned body field**: `CreateAnalysisUseCase.ts:477` forwards the registry-resolved tiers, and `worker/src/routes/analysis.ts:117` accepts it with no signature, no allowlist, and no registry re-validation — `analysis.ts:1794` passes `req.cascade` straight into `new LLMCascade(...)`, which prefers it over `models` (constructor takes cascade when present). Who can set it: whoever can reach the worker's analysis stream endpoint with a *validly signed* v2 token — i.e. the legitimate web client, or anyone who can replay a captured token within `exp` — can substitute an arbitrary model/providerOrder list and the worker honors it; an attacker without a valid signature cannot forge the request at all (the token is still the auth gate), but within that gate `cascade` is attacker-controlled content. No model-id allowlist exists on the worker path (`translateModelId`, `worker/src/services/model-id-translator.ts`, is a no-op passthrough). Risk accepted for now (the token gate bounds the exposure); the rollout step must add either (a) a signed registry-version stamp verified server-side, or (b) an allowlist check of every `cascade[].model` against `setting_definitions` before `LLMCascade` consumes it.
- OSS-120B context is **131,072 tokens**, which is not the binding constraint for Layer 4 — Layer 4 receives only the canonical report + evidence ledger (current canonical shapes ≈20k tokens/call). It is **ruled out as a transcript reader** on the evidence/provenance boundary, not the context window: R2 (ADR 036) makes the evidenceLedger the sole factual source for later layers, and Layer 4 must see only the canonical report + ledger so it structurally cannot introduce or launder unsupported material from the transcript. Full transcripts measured up to 177.5k chars (~45k tokens, 39hqY3nH5ug) plus the ~11.5k-token prompt (≈56.5k total) would actually still fit inside 131k — the boundary rule is what forbids it, and transcript reading stays on Layer 1's GLM (1M ctx).

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
| GLM-5.3-Flash | 88 | 83 |
| GPT-OSS-120B | 80 | 79 |
| GPT-6-Luna | 81 | 70 |
| GPT-6-Luna-Pro | 81 | 70 |
| Llama-3.3-70B | 68 | 67 |

(Exact per-dim medians. GLM 88/83 also matches the ledger's "GLM 88/83" aggregate headline for this stripe.)

### 2.3 Findings the decision rests on

- **GLM led extraction on every full-context round**: parity 90.7 → 91.5 → 89.4 across rounds 1/3/4 — holds cross-lingually (round 4 is Arabic). Style 81–84.6 remains the gap.
- **Luna ≈ Luna Pro**: identical 81/70 medians on the v2 stripe. Same price as Luna on OpenRouter, so Pro buys nothing → Pro is not used.
- **Two-phase GLM→OSS won Round 1** (the original motivation for an articulation pass — `/tmp/opencode/articulation-exercise.mts` lines 19, 58, 69: GLM `reasoning.effort: 'minimal'` per-dim extraction → single `openai/gpt-oss-120b` articulation pass → Jev grades). **BUT** on the later full-ctx rounds OSS scored below GLM/Luna on style — R3: 81.4 vs 84.6 (GLM-identity); R4: 80 vs 83 (GLM). The user's choice of OSS as the Layer 4 renderer is recorded WITH these numbers on the table: OSS is a deliberate pick as a cheap, evidence-preserving articulation tier, not a style winner, and the Layer 4/5 style lever (conditional Haiku escalation on weak style, R10) covers the gap. The R6 pipeline-level bake-off on the frozen pool re-tests GLM-only vs GLM→OSS end-to-end before rollout.
- **Cost**: prior draft's table stands — Haiku today $0.11–0.17 K=1, **$1.128 K=11** (crucible `3daf3be2`) vs ≈$0.03–0.09 for the new cascade, meeting the $0.05–0.09 target (§ of the archived draft, preserved in git history at `a58f688e`).

### 2.4 The contamination cause (why extraction moved off Haiku)

User-identified cause (2026-10-03): the prompt demanded cross-domain bridges while declaring the video a closed universe; Haiku extrapolated (invented 401k/529/18%-vs-14% facts on Z6l4HpuyyP0). Partial fixes already shipped: **R1b dim-8 epistemic split (PR #363)**, **R2b signed projective context (PR #368)**. The structural fix is ADR 036's evidenceLedger (R2/R3) with GLM extraction.

## 3. Consequences

**Positive**
- K=11 crucible-class runs drop from $1.13 → ≈$0.03–0.09 (≥12× on the measured run).
- Registry-driven and rollback-able without deploy (Appendix A holds the incumbent value verbatim) — **but only after §4a's orchestrator prerequisite is met; the registry edit alone changes tier order, not pipeline structure.**
- Same `CascadeItem`/`buildRequestProvider` contract already exercised by chat/digest/stance (`LLMCascade.ts:36-53`); pinned `allow_fallbacks: false` provider orders as per the standing standard.

**Risks**
- Invalid-JSON is not caught by zero-token fall-through — that class belongs to ADR 036's Jev Gate C / Layer 5 escalation (R10), not the cascade fallback.
- OSS style deficit vs GLM-identity is measured (§2.3); if the frozen-pool R6 run shows GLM-only style ≥85, the Layer 4 tier becomes redundant and drops out by registry edit.
- Anthropic-only `cache_control` breakpoints no-op on non-Anthropic tiers (`LLMCascade.ts:328-354` guard handles this safely); cost estimates assume no cache discount — conservative.
- `testOverride.enabled=true` in prod (`app_settings.model_config`) pins Haiku-first for stale clients without `cascade` in the payload — must be cleared/rewritten in the rollout step (Appendix A).

## 4. Preregistered go/no-go (user-approved 2026-10-03; set before any run, never changed after seeing results)

### 4a. Deployment prerequisites (hard)

Production rollout of this cascade is **blocked** until both of the following exist:

1. **A sequential orchestrator implementing ADR 036 Phases B–D must exist first** (Layer 0 routing → Layer 1 GLM extraction → Jev Gate A → Layer 2 dimension bundles → Gate B per bundle → Layer 3 canonical synthesis → Gate C → Layer 4 OSS rendering → conditional Layer 5 Haiku escalation), **with tests**. The current `LLMCascade` (`worker/src/services/LLMCascade.ts`) is a single-prompt first-success fallback (falls through only on zero tokens — §1) and cannot implement stage-to-stage routing, per-stage prompts, or quality-triggered escalation; the registry model list alone delivers none of it. The orchestrator's tests must cover: stage ordering, gate PASS/REPAIR/ESCALATE routing (R10 triggers), evidenceLedger hand-off between stages (R2/R3 provenance preserved end-to-end), and the escalation condition (style polish only after factual validation passes). It must also carry a **per-stage reasoning effort**: today `LLMCascade.ts:400` and `:591` hardcode `reasoning: { effort: 'low' }` and `CascadeItem` has no effort field, so the `minimal` efforts in §1 are not expressible until the orchestrator (or the cascade item schema) adds one — the bake-off arms must run at the §1 efforts, recorded per run (R9).
2. **Registry change procedure with a tested rollback** — against the real tables, not `app_settings`:
   - Insert `cascade.analysis` as a `setting_definitions` row (key + `default_value` JSON of the `CascadeItem[]` list) + a `setting_values` row (scope_type='system', scope_id NULL) — verified read path: `web/lib/adapters/SupabaseSettingsAdapter.ts:81-82`.
   - **Read-after-write verification**: immediately after seeding, call `resolveAnalysisCascade()` server-side and assert the resolved list byte-matches the seeded value (guards against RLS/scope mismatches silently falling back to `ANALYSIS_CASCADE_FALLBACK` — the failure mode is a silent no-op, so the verification is mandatory, not optional).
   - **`testOverride` handling**: `app_settings.model_config.testOverride.enabled=true` must be set to `false` (or its analysis list aligned) in the same change window — while enabled, stale clients without `cascade` in the payload still run Haiku-first via the legacy signed `models` path (Appendix A).
   - **Stale-client handling**: clients that don't forward `cascade` fall to the signed `models` list — during rollout this is acceptable only while `testOverride` is disabled and `models` matches the incumbent; after the window, stale-client runs should be monitored via `model_used` telemetry.
   - **Tested rollback**: before enabling, rehearse (a) rewriting the `setting_values` row back to the incumbent Haiku list and (b) re-disabling `testOverride` restoration, and verify read-after-write reflects the incumbent on the next analysis, no deploy. Rollback is only real if it has been executed once in a non-prod environment.

### 4b. Frozen-pool gate (development data)

Run the **frozen 14-video pool** (R7 — development data; routing-rule tuning on this set is tracked as such) through `scripts/bakeoff-l2-evaluator.ts` (v2 permanent harness), comparing **Haiku vs GLM-only vs GLM→OSS vs the full Jev-gated path** (R6 — all four, identical transcripts/metadata/grading state, promptVersion + model/provider versions pinned per run, R9).

Metrics — parity and style reported **separately** (R5): median, P25/P75, pass rate, worst case — overall AND stratified by class (S1–S6), language, duration, genre, speaker count (R8) — plus **unsupported-claim rate** and **schema validity**.

Enablement bar (to seed `cascade.analysis`): **≥12/14 videos** jointly parity ≥90 AND style ≥85; candidate medians ≥90 (parity) / ≥85 (style); **no video below 80 parity or 75 style**; **no regression >10 points vs Haiku** on either metric.

**Score definitions (preregistered 2026-10-03, before any R6 run).** Per video, *parity* = the median over that video's dimensions of the judge's `InformationParity` score and *style* = the median of `StyleConsistency`, both on 0–100 (`scripts/bakeoff-l2-evaluator.ts` `scoreTo100`, per-video `medInfo`/`medStyle`). Every arm, the Haiku arm included, is graded by the same judge against the full transcript (transcript-grounded, full-ctx), so arms are comparable. *Regression vs Haiku* = for each video and each metric, Haiku arm score − candidate arm score; the bar fails if any single video exceeds 10 points on either metric. The evaluator must emit these per-video values and the paired differences; adding that output is part of the R6 harness work, not a post-hoc calculation.

**Each candidate arm is gated independently.** The enablement bar above applies, unchanged, to **each** of GLM-only, GLM→OSS and the full Jev-gated path on its own; no arm passes on another arm's results, and arms are not compared by picking the best after seeing results.

**What a failed gate means (preregistered).**
- An arm that misses the bar is a **no-go**: it is not seeded into `cascade.analysis` and its route is not built further.
- If **no** candidate arm passes, production stays on the **current Haiku-based route with its existing escalation path** (Appendix A). No other route is promoted.
- GLM-only may proceed on its own only if it clears the bar on its own; a GLM→OSS failure neither blocks nor promotes GLM-only.
- **Orchestrator design (ADR 036 Phases B–D) may proceed in parallel with the bake-off; orchestrator implementation PRs for a route wait until that route's arm passes §4b.** The §4c holdout remains a separate production blocker after §4b passes.

### 4c. Holdout gate (required before production)

A holdout set **disjoint from the 14-video pool**, frozen before scoring, never tuned on:

- **≥150 effective independent videos and ≥50 independent clusters**, where a cluster = channel/series with samples per cluster capped (to limit within-cluster correlation), and selection production-weighted from recent telemetry.
- **Coverage floors ≥20 per material marginal stratum** (language, S1–S6, duration, genre, speaker count), **≥30 for high-risk strata** — floors are coverage, not proof: an unmet stratum stays on the incumbent route until it is covered.
- Same per-video and worst-case cutoffs as §4b.
- **Joint pass rate: one-sided 95% lower bound ≥85%**, computed via cluster-level bootstrap with a preregistered design effect (accounts for within-cluster correlation — the design effect value is fixed before scoring).
- **95/95 remains the bar for dropping Haiku entirely** (ADR 036 §4) — distinct from and higher than the 90/85 enablement bar. Haiku escalation stays enabled at launch regardless.

### 4d. Escalation semantics at launch

Haiku escalation stays enabled at launch and may polish style **ONLY after factual validation passes** (never polish a factually-unvalidated report — ADR 036 Layer 4/5 rule). OSS (Layer 4) output is **rejected/escalated** if it adds facts, entities, examples or causal claims, or changes numbers, timestamps or uncertainty markers.

Rollback = registry: restore the incumbent list from Appendix A into `cascade.analysis`; takes effect next analysis, no deploy.

## Appendix A — the pre-change production state (cascade trace, carried from the prior draft; verified 2026-10-03 at `e8692858`)

This is the factual trace of why every run lands on Haiku 4.5 today, kept as the rollback/audit record. The cascade decision proper is §1–§4 above.

**Selection (Vercel, per-request):**

1. `web/lib/usecases/CreateAnalysisUseCase.ts:190` — `resolveAnalysisCascade()` resolves the full registry cascade (model id + name + cost + providerOrder per tier).
2. `web/lib/config/cascade.ts:108-116` (`resolveCascade`) + `:119` (`resolveAnalysisCascade`) — reads registry key **`cascade.analysis`** via `SupabaseSettingsAdapter.getRegistrySettings` (tables: `setting_definitions` + `setting_values`, NOT `app_settings` — see §1 registry note), falling back to `ANALYSIS_CASCADE_FALLBACK` (`cascade.ts:50-59`) only if the registry is unreachable/empty. The fallback is 4× `anthropic/claude-haiku-4.5` (Vertex → Azure → Anthropic Direct → Bedrock) + 2× `claude-sonnet-5`.
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
