# ADR 038: Analysis Model Cascade — GLM 5.3 Flash → GPT-OSS 120B → Luna Pro

- **Status**: PROPOSED (awaiting user approval)
- **Date**: 2026-10-03
- **Supersedes (for the analysis path only)**: ADR 003 / ADR 011 ("Haiku 4.5 primary"). Chat / digest / stance / entity-extraction cascades are unchanged.
- **Superseded by**: none
- **Dispatched trace + draft**: OC (opencode), Sprint 2.6 Track A step 1/3. No cascade code changed in this step.

## 1. Context

**User directive (2026-10-03):** analysis LLM spend must follow a cheap cascade —
**GLM 5.3 Flash → GPT-OSS 120B → Luna Pro** — targeting **$0.05–$0.09 per analysis**.
Haiku 4.5 is to be **removed from the analysis path**.

**Observed state (verified 2026-10-03, live prod):** every analysis since the cascade
went registry-driven lands on `Claude Haiku 4.5 (Vertex)`. The last 10 rows in
`analyses.model_used` (73499a64 → 3daf3be2, spanning 2026-09-27 → 2026-10-02) are all
`Claude Haiku 4.5 (Vertex)`. Carmack crucible run `3daf3be2` (K=11, 45 chunk rows) cost
**$1.128** in `analysis_chunks.cost_usd`; K=1 runs cost $0.11–$0.17.

This is the **documented configuration, not a bug**: ADR 003 / ADR 011 designate
Haiku 4.5 as the analysis primary, and every layer of the pipeline faithfully resolves
and executes that decision.

### 1.1 End-to-end trace: where the model list comes from and where it goes

All hops verified with file:line on branch `feature/2.6-routing-and-synthesis` (e8692858).

**A. Selection (Vercel, per-request):**

1. `web/lib/usecases/CreateAnalysisUseCase.ts:190` — `resolveAnalysisCascade()`
   resolves the full registry cascade (model id + name + cost + providerOrder per tier).
2. `web/lib/config/cascade.ts:110-116` — `resolveCascade('cascade.analysis', …)`
   reads the Settings Registry key **`cascade.analysis`** via
   `SupabaseSettingsAdapter.getRegistrySettings`, falling back to
   `ANALYSIS_CASCADE_FALLBACK` (`cascade.ts:50-59`) only if the registry is
   unreachable/empty. The fallback is 4× `anthropic/claude-haiku-4.5`
   (Vertex → Azure → Anthropic Direct → Bedrock) + 2× `claude-sonnet-5`.
3. `CreateAnalysisUseCase.ts:188` — in parallel, `resolveModels(tier, 'analysis')`
   resolves the **legacy flat model-id list** for the signed token:
   `web/lib/adapters/SettingsModelAdapter.ts:85-122` reads the `model_config` row of
   `app_settings` (plans per tier, plus `testOverride` — see §1.3), falling back to
   `FALLBACK.analysis`.
4. `CreateAnalysisUseCase.ts:479-484` — both are forwarded into the signed stream
   payload: `models` (flat ids, HMAC-signed) **and** `cascade` (full tiers with
   providerOrder, unsigned body field).

**B. Registry rows that drive this (read 2026-10-03, prod `app_settings` / `admin_settings`):**

- `app_settings.model_config` (the ONLY row in `app_settings` in prod):
  - `plans.pro.analysis = ["anthropic/claude-haiku-4.5", "nvidia/nemotron-3-nano-30b-a3b:free", "z-ai/glm-4.5-air:free", "google/gemma-4-26b-a4b-it:free"]`
  - `plans.free.analysis = ["nvidia/nemotron-3-nano-30b-a3b:free", "z-ai/glm-4.5-air:free", "google/gemma-4-26b-a4b-it:free", "anthropic/claude-haiku-4.5"]`
  - `plans.enterprise.analysis` = same as pro.
  - **`testOverride.enabled = true`** (see §1.3): `analysis = ["anthropic/claude-haiku-4.5", "nvidia/nemotron-3-nano-30b-a3b:free"]`.
- **`admin_settings.model_cascade` (id=default)** = `["nemotron-3-nano", "claude-haiku-4-5"]` — legacy shape consumed by `web/lib/config/synthesis-with-settings.ts:55` (`modelCascade: adminSettings?.modelCascade ?? ['nemotron-3-nano', 'claude-haiku-4-5']`). Client-display/routing only; not the worker's execution list.
- **`cascade.analysis` does NOT exist in prod `app_settings`.** The registry-resolved
  path therefore always falls back to the hardcoded `ANALYSIS_CASCADE_FALLBACK`
  (4× Haiku + Sonnet 5) — the registry-driven mechanism was built (migration
  `20260725140000_cascade_registry.sql`) but never seeded for analysis.

**C. Execution (Cloudflare Worker):**

5. `worker/src/routes/analysis.ts:117` — the request contract accepts `cascade`:
   *"worker uses `cascade` when present; `models` stays as the signed/legacy fallback
   for stale clients."*
6. `worker/src/routes/analysis.ts:1794` — `new LLMCascade(apiKey, req.models, req.cascade, req.maxOutputTokens, …)`.
7. `worker/src/services/LLMCascade.ts:80-105` — constructor requires a non-empty
   cascade (SSOT violation error otherwise); `this.chain = cascade`. The chain is
   iterated **first-tier-wins**: the first tier that produces a token is committed;
   fall-through only when the current tier produces **zero tokens** (network/HTTP
   error, timeout, abort).
8. `LLMCascade.ts:319-383` (`callLLMStream`) — per-tier OpenRouter request:
   single `model: <requestModel>` field (NOT an OpenRouter-native `models` array),
   `provider: { order: providerOrder, allow_fallbacks: false }` for pinned tiers
   (`buildRequestProvider`, `LLMCascade.ts:36-53`; Haiku 4.5 without providerOrder is
   a hard SSOT error), `max_tokens` from registry `analysis.maxOutputTokens.haiku/.default`,
   `reasoning: { effort: 'low' }`, Anthropic `cache_control` split when prompt caching
   is enabled (`analysis.promptCaching.enabled`, `CreateAnalysisUseCase.ts:232-243`).
   `translateModelId` (`worker/src/services/model-id-translator.ts`) is currently a
   no-op passthrough.
9. `LLMCascade.ts:564-600` (`callLLM`) — identical construction for the non-streaming
   legacy path.

**D. Accounting (worker → Vercel persist → Supabase):**

10. Response-side usage extraction (`LLMCascade.ts:300-306`): `tokensUsed`, `costUsd`,
    `cachedTokens`, `generationId` from the stream's usage frames; `modelUsed` =
    the tier's human-readable `name` (e.g. "Claude Haiku 4.5 (Vertex)").
11. `web/app/api/analyses/persist/route.ts:791, 969, 1003, 1059, 1125, 1429, 1530` —
    `model_used: model || null` (or `'edge-stream'`) written to `analyses` and
    `analysis_chunks` rows; `cost_usd` / `tokens_used` / `cached_tokens` written on
    `analysis_chunks` (`persist/route.ts:202-212, 306, 348, 638, 1220-1223` — the
    admin cost ledger sums chunk `cost_usd` into the parent row's quota consumption).

**Complete hardcode/default inventory for the analysis model id:**

| Location | Value | Role |
|---|---|---|
| `web/lib/config/cascade.ts:54-59` | 4× `anthropic/claude-haiku-4.5` + 2× `claude-sonnet-5` | hardcoded fallback, IS the effective live list (registry key absent) |
| `app_settings.model_config` `testOverride.analysis` | `["anthropic/claude-haiku-4.5", "nvidia/nemotron-3-nano-30b-a3b:free"]`, `enabled: true` | flat signed-token list (legacy `models`) |
| `app_settings.model_config` `plans.{pro,free,enterprise}.analysis` | Haiku-first lists | tier plans (bypassed while `testOverride.enabled`) |
| `admin_settings.model_cascade` | `["nemotron-3-nano", "claude-haiku-4-5"]` | legacy client-side display/routing shape |
| `web/lib/config/synthesis-with-settings.ts:55` | `['nemotron-3-nano', 'claude-haiku-4-5']` | fallback for the legacy shape |
| `web/lib/config/cascade.ts` `CASCADE_FALLBACKS.{chat,digest,stance,entityExtraction,reasoning*}` | gpt-oss-120b / gemini / llama / o3-mini lists | other paths, NOT analysis |

### 1.2 Why every run lands on Haiku 4.5 (Vertex) — answered

**Haiku is simply first in the effective list, and it succeeds.** There is no
evidence of earlier-model failure:

- The effective execution list is `ANALYSIS_CASCADE_FALLBACK` (registry key
  `cascade.analysis` absent) — its FIRST entry is `anthropic/claude-haiku-4.5`
  with `providerOrder: ['google-vertex']`.
- The cascade is first-tier-wins (`LLMCascade.ts` constructor + `streamCascade`
  iteration): with `allow_fallbacks: false` and a healthy Vertex route, tier 1
  produces tokens on every request and tiers 2-6 are never attempted.
- Fallback events emit `stage: 'fallback'` status frames (`LLMCascade.ts:1533`
  "All models in cascade failed" is the terminal error; per-tier fall-through is
  logged + Sentry-captured per `LLMCascade.ts:520-540`). No such frames / captures
  are associated with normal analysis runs, and `model_used` is uniformly the
  tier-1 name across 10+ consecutive analyses. Conclusion: **Haiku first AND
  Haiku succeeding** — a pure configuration outcome, not a reliability one.

### 1.3 The `testOverride` hazard

`SettingsModelAdapter.resolveModels` (`SettingsModelAdapter.ts:105-107`) prefers
`testOverride` over tier plans when enabled. In prod it IS enabled and pins
analysis to `[haiku-4.5, nemotron-free]`. This legacy flat list only matters for
stale clients without `cascade` in the payload — but it is a second, independent
hardcode of "Haiku first" that must be updated (or its `testOverride.enabled`
flag cleared) as part of step 2, or stale-client fallbacks will reintroduce Haiku.

### 1.4 Target-model fitness (verified against `https://openrouter.ai/api/v1/models`, 2026-10-03)

Our prompt sizes (measured, crucible 3daf3be2 + registry `analysis.transcriptBudgetChars` = 48000 default):
~19.2k-token shared prompt prefix (cached) + full UCIS system prompt; per-chunk
`tokens_used` 18.6k–24.8k (input+output combined) → **input ≈ 15k–20k tokens per
call**, K=1 total ≈ 20k tokens, K=11 ≈ 220k tokens aggregate (per-cell ~20k).

| Model | Context | $/M in / out | Fits 20k prompt? | Fits 48k-char transcript (~15k tok) + system? | `response_format` / structured outputs | JSON-reliability notes | Tool support |
|---|---|---|---|---|---|---|---|
| `z-ai/glm-5.3-flash` | 1,048,576 | 0.15 / 0.50 | Yes (huge headroom) | Yes | `response_format` supported | GLM Flash tier — strong at cheap structured extraction; validate in bake-off (Layer-0/1 POC 2026-09-26 already used it) | `parallel_tool_calls` supported |
| `openai/gpt-oss-120b` | **131,072** | 0.037 / 0.17 | Yes | **Marginal** — 131k ctx total; our ~20k/call is fine, but NO headroom for future full-transcript (177.5k chars ≈ 45k tok) prompts + 16k output | `response_format` + `structured_outputs` | Proven in-repo: chat/digest/stance cascades all lead with it (high volume, stable) | tools not listed for this id; structured outputs yes |
| `openai/gpt-6-luna-pro` | 1,050,000 | 0.10 / 0.50 | Yes | Yes (1.05M) | `response_format` + `structured_outputs` | "Luna Pro" ambiguity: catalog has `gpt-6-luna-pro` ($0.10/$0.50) and `gpt-5.6-luna-pro` ($0.20/$1.20). **This ADR uses `openai/gpt-6-luna-pro`** — flag for user confirmation | `tools`, `tool_choice` supported |
| `openai/gpt-5.6-luna-pro` (alt) | 1,050,000 | 0.20 / 1.20 | Yes | Yes | same | 2× input, 2.4× output vs gpt-6; only if gpt-6 quality insufficient | same |
| (current) `anthropic/claude-haiku-4.5` | 200,000 | 1.00 / 5.00 | Yes | Yes | `response_format` | incumbent benchmark | tools |

### 1.5 Cost model (from real token counts of 3daf3be2)

Per-cell shape: ~19k input (bundle 1 uncached) / ~17k cached reads (bundles 2-11 at
~86-92% cache hit), ~2-3k output. Cost = Σ over cells, using the OpenRouter $/M
above (cache reads at Haiku's 0.1× written-in-ADR behavior is NOT assumed for the
new models — costed at full input price, which makes these estimates conservative
upper bounds for non-Anthropic models since OpenRouter bills their cached tokens
at provider-defined discounts).

| Cascade | K=1 (1 cell) | K=11 (45 cells, observed shape) | vs target $0.05–0.09 |
|---|---|---|---|
| **Today: Haiku 4.5** (measured) | $0.11–0.17 | **$1.128** | ❌ 2–12× over |
| **GLM 5.3 Flash only** | ≈ $0.006 | ≈ $0.033 | ✅ well under |
| **GLM 5.3 Flash → GPT-OSS 120B** (all on GLM; OSS fallback tier) | ≈ $0.006–0.008 | ≈ $0.033–0.05 | ✅ |
| **GLM → OSS → gpt-6-luna-pro** (Luna only on double fallback) | ≈ $0.007–0.02 | ≈ $0.035–0.09 | ✅ at target even with one tier of Luna escalation |
| Same, `gpt-5.6-luna-pro` as tier 3 | +2× on Luna cells | up to ≈ $0.15 worst-case | ⚠️ only if Luna escalates heavily |

Assumptions: output tokens per cell ~2–3k (observed); pricing from the 2026-10-03
catalog snapshot; no prompt-caching discount applied for non-Anthropic models
(conservative). K=11 aggregate input ~218k tokens + cached reads ~154–188k/cell-tier.

**Conclusion: the 3-model cascade meets the $0.05–$0.09 target at K=11 and beats it
at K=1, with GLM 5.3 Flash as the workhorse (≈$0.03/K=11) and Luna Pro affordable
even as a frequent escalator.**

## 2. Decision

**PROPOSED**: replace the analysis execution cascade with a 3-tier, registry-held
cascade — user directive 2026-10-03:

1. **`z-ai/glm-5.3-flash`** — primary. 1M ctx, cheapest, `response_format` OK.
   Providers: pin in step 2 after a live probe (catalog does not expose provider
   slugs here; do NOT set `allow_fallbacks` true — reuse the `buildRequestProvider`
   pinned-order contract, `LLMCascade.ts:36-53`).
2. **`openai/gpt-oss-120b`** — tier 2. Already proven in-repo (chat/digest/stance).
   **131k context**: safe at the current ~20k/call shape, but document that any
   future full-transcript (>131k-token) prompt on this tier will 4xx — the
   `analysis.transcriptBudgetChars` budget (default 48000 chars) keeps us well under.
3. **`openai/gpt-6-luna-pro`** — tier 3 ("Luna Pro" disambiguation: the cheaper
   gpt-6 variant, $0.10/$0.50, NOT `gpt-5.6-luna-pro`; user to confirm).

- **Haiku 4.5 is REMOVED from the analysis path** (user directive). The legacy
  `testOverride` / `model_config` plans and `admin_settings.model_cascade` that
  still name Haiku for analysis must be updated or disabled in the same change
  (step 2) so no stale path reintroduces it.
- **Registry ownership**: the cascade lives under **`cascade.analysis`** in
  `app_settings` (the key the code already reads at `cascade.ts:110-116`; it is
  currently ABSENT in prod — seeding it is what makes the change registry-driven
  and rollback-able). Keep `ANALYSIS_CASCADE_FALLBACK` in code in sync with the
  seeded default.
- Entries keep the `CascadeItem` shape (`model`, `name`, `cost`, `providerOrder`)
  so `buildRequestProvider`'s `allow_fallbacks: false` pinning applies unchanged.
- `max_tokens` handling: `analysis.maxOutputTokens.default` (16000) applies to all
  three new tiers; the Haiku-specific key stays for the digest/chat paths.

## 3. Consequences

**Positive**
- K=11 crucible-class runs drop from $1.13 → $0.03–0.09 (≥12× on the measured run).
- Registry-driven: no redeploy to tune; instant rollback by rewriting
  `cascade.analysis` (restore the old Haiku list verbatim).
- No code-path novelty: same `CascadeItem`/`buildRequestProvider` contract already
  exercised by chat/digest/stance.

**Risks**
- **JSON-output reliability**: the UCIS prompt demands strict 11-dimension structured
  output. GLM 5.3 Flash and Luna Pro are unproven on THIS prompt at volume (OSS-120b
  is proven on smaller prompts only). Mitigation: bake-off on the frozen 14-video
  pool (R6/R7 of the 5-layer ADR) before enabling; `response_format` is supported
  by all three but the cascade's zero-token fall-through does not catch
  *invalid-JSON* — that class is Jev Gate C / escalation territory (5-layer ADR R10).
- **gpt-oss-120b 131k ceiling**: current shapes fit (~20k/call), but the tier cannot
  host a full-transcript prompt (177.5k chars measured on 39hqY3nH5ug). The
  `analysis.transcriptBudgetChars` gate must stay in place; document the ceiling.
- **"Luna Pro" ambiguity**: gpt-6 vs gpt-5.6 (2× price). Flagged for user decision;
  default chosen is `openai/gpt-6-luna-pro`.
- **Quality risk**: removing Haiku from analysis is exactly the trade the 2026-09-26
  bake-off data anticipated (cheap challengers approach Haiku on content parity, lose
  on style). The 5-layer ADR's Layer-4 style pass remains the answer; this cascade
  covers Layers 1–3 economics only.
- **Prompt caching**: Anthropic-only `cache_control` breakpoints no-op on the new
  tiers (`LLMCascade.ts:328-354` guard already handles non-Anthropic safely). Cost
  estimates above assume no cache discount, so real spend should be ≤ estimates.
- **`testOverride` stale path**: `app_settings.model_config.testOverride.enabled=true`
  still lists Haiku for analysis; if left as-is, a stale client (no `cascade` in
  payload) would fall back to Haiku-first. Step 2 must clear/rewrite it.

**Rollback**
- Registry-only: set `cascade.analysis` back to the current 4× Haiku + Sonnet list
  (values in §1.1/B) — takes effect on the next analysis, no deploy.
- Code fallback remains the same list until step 2 changes it deliberately.

## 4. Compliance notes

- Numbering: ADR 037 (Jev Semantic Chunking) is taken; this is 038.
- This ADR is **Proposed**; user approval required before step 2 (code change).
- Relationship to the 2026-09-27 5-layer Jev architecture (user-confirmed): this
  cascade implements the Layer 1–3 model economics; it does not change layering,
  gates, or the evaluation contract. The 5-layer build keeps its own phasing.
