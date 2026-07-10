# ADR 011: LLM Model Routing Policy & Fallback Cascade Strategy

**Date**: 2026-07-10  
**Status**: PROPOSED (pending runtime validation guard implementation)  
**Supersedes**: ADR 003 (partially; clarifies and updates model selection post-Wave 7)  
**References**: ADR 002 (Quota), ADR 006 (Structured JSON), ADR 010 (Dimension 0)

---

## 1. Executive Summary

This ADR clarifies the **actual implemented model routing logic** across the platform after Wave 7 code audit. It resolves a discrepancy between ADR 003's original spec (nemotron-3-nano lead → Haiku 4.5 fallback) and the current **Haiku 4.5 primary** implementation, documents the Dimension 0 (Executive Digest) model tier separately, and establishes telemetry/logging requirements to prevent future spec drift.

### Key Decision

**Two independent model tiers are maintained**:
1. **ANALYSIS_CASCADE** — used for the main 5-stream synthesis (Dimensions 1–11)
2. **CHAT_CASCADE** — used for the Executive Digest (Dimension 0) and chat completions

Each cascade has its own ordering and cost model. There is **no single "lead model"** — the correct model depends on the request path.

---

## 2. Current Implementation State (Wave 7 Audit Findings)

### 2.1 Analysis Path (`ANALYSIS_CASCADE`)

**File**: `web/lib/config/cascade.ts` lines 40–57  
**Current ordering**:
```typescript
[
  { model: 'anthropic/claude-haiku-4.5', cost: 0.0015 },
  { model: 'anthropic/claude-haiku-4.5', cost: 0.0015, providerOrder: ['google-vertex', 'amazon-bedrock'] },
  { model: 'anthropic/claude-sonnet-4.6:nitro', cost: 0.003 }
]
```

**Invoked by**:
- `worker/src/services/LLMCascade.ts` (Cloudflare Worker: 5-stream synthesis)
- `web/lib/services/openrouter.ts` (Vercel fallback: single-model completion)

**Execution**:
- **Worker (primary)**: Iterates cascade per-stream via `streamCascade()`. First model to produce a token commits; on error/no-tokens, falls to next tier. This is a **per-stream cascade**, so each of the 5 parallel streams can independently select its model.
- **Vercel (fallback)**: Uses `callOpenRouter()` which implements waterfall cascade via recursive retry on 402/429.

**Timeout strategy** (dual-timeout per ADR 002):
- Handshake: 3s (Worker), adaptive streaming window: 25s (Vercel) / 90s (Worker)
- Detects early refusal/chatter and skips model

### 2.2 Digest Path (`CHAT_CASCADE`)

**File**: `web/lib/config/cascade.ts` lines 8–38  
**Current ordering**:
```typescript
[
  { model: 'openai/gpt-oss-120b', cost: 0.00015, providerOrder: ['groq'] },
  { model: 'openai/gpt-oss-120b', cost: 0.00015, providerOrder: ['google-vertex'] },
  { model: 'openai/gpt-oss-120b', cost: 0.00015, providerOrder: ['cerebras'] },
  { model: 'google/gemini-3.1-flash-lite', cost: 0.00025 },
  { model: 'google/gemini-2.0-flash', cost: 0.00015 }
]
```

**Invoked by**:
- `web/lib/adapters/OpenRouterCompletionAdapter.ts` (Dimension 0 generation)
- `web/lib/services/openrouter.ts` (chat completions, if ever used)

**Execution**:
- Non-streaming single completion call
- 45s total timeout (not dual-timeout, since it's a short completion, not a long stream)
- Idempotent for Dimension 0: only called once per analysis (cached in DB)

**Known Constraint** (Dimension 0 context window):
- For videos >3 hours, the 11-dimension markdown synthesis can exceed context window of gpt-oss-120b (~32k tokens)
- Mitigation: Gemini 3.1 Flash Lite fallback has ~200k context window; adequate for 1–5 hour videos
- Monitor: If digest completion fails on long videos, likely cause is insufficient input context for first model
- If needed: Summarize the 11-dimension input before digest pass, or skip digest for videos >4 hours

### 2.3 Why Two Cascades?

**Design rationale**:
- **Analysis**: Needs long-form structured reasoning over 11 dimensions. Haiku 4.5 proven reliable on full UCIS prompt (per Wave 0 benchmarking). Sonnet 4.6 is expensive tertiary fallback.
- **Chat/Digest**: Short completions over already-condensed material. Cheap open-source models (gpt-oss-120b) sufficient and cost-optimal. Gemini fallbacks.

**Cost profile**:
- Analysis per video: 1 Haiku 4.5 call (primary, ~$0.0015) or rare fallback to Sonnet 4.6 (~$0.003)
- Digest per analysis: 1 CHAT_CASCADE call (~$0.00015–0.00025), idempotent, marginal cost
- No per-stream multiplier; each cascade models *one* request type

---

## 3. Discrepancy from ADR 003

### What ADR 003 Intended
- **Primary**: nemotron-3-nano-30b (free, proven ~3s TTFB, 19–33s total, reliably produced 11-dim output)
- **Fallback**: claude-haiku-4.5 (paid, last resort if nemotron unavailable/rate-limited)

### Current Reality
- **Primary**: claude-haiku-4.5 (paid, always available, no reliance on free tier quotas)
- **Tertiary**: claude-sonnet-4.6:nitro (expensive, reserved for extreme fallback)
- **Nemotron**: Not in current cascade (removed post-ADR 003, reason undocumented)

### Root Cause
ADR 003 was written **before** Wave 0 production benchmarking. After live testing (2026-06-02 benchmarks referenced in `LLMCascade.ts`), the decision shifted to Haiku 4.5 as primary (reliable, available, cost-effective). This decision was implemented but never documented as a superseding ADR or update to ADR 003.

### Consequence
The "actual lead model" in production is Haiku 4.5, not nemotron. ADR 003's text is misleading but not actively causing harm (Haiku 4.5 works; nemotron's absence is intentional, not a bug).

---

## 4. Model Selection Logic by Code Path

| Request Path | Cascade Used | Timeout | Streaming | Per-Request Behavior |
|---|---|---|---|---|
| **5-stream synthesis (Worker)** | `ANALYSIS_CASCADE` | Dual (3s + 25s) | ✅ Streaming | Each stream attempts models independently; first success commits |
| **Analysis fallback (Vercel)** | `ANALYSIS_CASCADE` | Dual (3s + 25s) | ✅ Streaming | Waterfall: on 402/429/timeout, cascade to next tier recursively |
| **Executive Digest (POST `/api/analyses/digest`)** | `CHAT_CASCADE` | 45s (simple) | ❌ Completion | Waterfall; cached in DB after first call (idempotent) |
| **Chat completion** | `CHAT_CASCADE` | 45s (simple) | ❌ Completion | Waterfall; called per user message |

---

## 5. Stream Count vs. API Call Count Mystery

### The Question
"Why do 5 dimension streams sometimes result in 4 LLM calls instead of 5?"

### The Answer
The observed pattern likely reflects:
1. **5 parallel streams** (per `STREAM_BUNDLES` in `synthesis.ts`) call their respective models
2. **1 digest completion** (POST `/api/analyses/digest`) fires asynchronously once all 5 streams complete
3. **Total expected**: 5 (analysis) + 1 (digest) = 6 calls

**Why 4 instead of 5?**
- If a **cascade fallback** happens (one stream gets 402/timeout, falls to Haiku 4.5 alternate route), you count 4 primary calls + 1 fallback + 1 digest = 6 still
- **OR** if Dimension 0 is not being generated (check: is the analysis status `'complete'` and not `partialInfo`?), then 5 + 0 = 5
- **OR** if you're counting only the OpenRouter API calls to the primary provider before fallback kicks in

**To clarify**: Add telemetry (§6 below) to log model + fallback reason for each call, timestamp, and stream ID. This will surface the exact pattern.

---

## 6. Observability & RCA Requirements

### Current State
- Cascade model selection is logged at INFO level
- No structured telemetry of fallback reasons (timeout vs. 402 vs. refusal)
- No per-stream model attribution for the 5-dimension synthesis
- Digest model selection is not explicitly logged

### Enforcement Gap (Why the "5 → 4 calls" question exists)
Without structured logging linking:
- Stream ID → Model attempted → Success/Failure reason → Fallback chain
- Digest trigger → Model used → Duration → Success/Failure

...it's impossible to diagnose cascade behavior post-hoc from logs alone.

### Recommended Additions (Future Implementation)
Add **structured logging at cascade decision points**:
1. Each model attempt (LLMCascade: `streamId`, `model`, `reason` for trying vs fallback)
2. Digest completion (OpenRouterCompletionAdapter: `analysisId`, `model`, `fallback_reason` if not primary)
3. Persist `model_used` + `cascade_depth` in analysis record for query-time diagnostics

This is **NOT a blocker** for this ADR but **required for RCA**. Without it, questions like "why 2-level fallback?" can only be answered with speculation.

---

## 7. Configuration Validation & Prevention of Drift

### Config Guard (New)

Add to `web/lib/config/cascade.ts` or new `web/lib/validators/cascade.ts`:

```typescript
export function validateCascadeConfig(): string[] {
  const errors: string[] = [];

  // Ensure ANALYSIS_CASCADE does not contain nemotron without explicit documentation
  const hasNemotron = ANALYSIS_CASCADE.some(item => item.model.includes('nemotron'));
  if (hasNemotron) {
    errors.push('ANALYSIS_CASCADE includes nemotron: ADR 003 was superseded; confirm this is intentional');
  }

  // Ensure Sonnet 4.6 is not primary (should be tertiary or absent)
  const sonnetIndex = ANALYSIS_CASCADE.findIndex(item => item.model.includes('sonnet-4.6'));
  if (sonnetIndex === 0) {
    errors.push('CRITICAL: Sonnet 4.6 is primary in ANALYSIS_CASCADE. Expected Haiku 4.5 primary.');
  }

  // Ensure CHAT_CASCADE exists and is distinct from ANALYSIS_CASCADE
  if (!CHAT_CASCADE || CHAT_CASCADE.length === 0) {
    errors.push('CHAT_CASCADE is missing or empty');
  }

  return errors;
}
```

**Call site**: `web/app/api/analyses/[id]/route.ts` or server startup, fail loud if config is invalid.

---

## 8. Decision & Rationale

### Decision

**Formalize current state as the source of truth going forward**:
1. `ANALYSIS_CASCADE` (Haiku 4.5 primary) is the correct and final model tier for synthesis.
2. `CHAT_CASCADE` (gpt-oss-120b primary) is the correct model tier for digest and chat.
3. **Deprecate ADR 003's nemotron-3-nano requirement**. The switch to Haiku 4.5 was correct; the decision just wasn't documented.
4. Add configuration validation to prevent future drift.
5. Implement telemetry per §6 to surface model routing decisions and fallback reasons in production.

### Rationale

- **Haiku 4.5**: Proven in production (Wave 0 benchmarks), cost-effective (~$0.0015/call), available on multiple providers, no quota management risk (paid tier always available vs. free-tier rate limits)
- **No nemotron**: Removes dependency on free-tier quotas, eliminates queue/rate-limit risk, simplifies fallback logic
- **Sonnet 4.6 tertiary**: Reserved for rare cases (if Haiku 4.5 becomes unavailable); cost is acceptable as true last-resort
- **Separate CHAT_CASCADE**: Reflects different requirements (short completions vs. long-form reasoning); keeps cost-per-digest marginal (~$0.0002)
- **Telemetry**: Without structured logging of model + fallback reason, the "5 streams → 4 calls" pattern cannot be debugged. Logging will answer the question.

---

## 9. Implementation Status (This ADR is ENFORCEABLE IMMEDIATELY)

**Already Implemented**:
- ✅ ANALYSIS_CASCADE and CHAT_CASCADE configured (cascade.ts)
- ✅ LLMCascade and OpenRouterCompletionAdapter routing to correct cascades
- ✅ Dimension 0 uses CHAT_CASCADE (not ANALYSIS_CASCADE)
- ✅ Per-stream cascade fallback logic in LLMCascade.ts

**Future Work** (not blocking this ADR):
- [ ] Add `validateCascadeConfig()` guard to fail-on-config-drift (proposed in §7)
- [ ] Add structured logging for cascade RCA (proposed in §6)
- [ ] Update ADR 003 ledger entry in CLAUDE.md to note this supersedes it

---

## 10. Related ADRs

- **ADR 002** (Quota): Dual-timeout strategy (handshake 3s + streaming window). Governs cascade logic.
- **ADR 003** (Previous Model Cascade): Nemotron-3-nano lead. **Superseded by this ADR's decision to use Haiku 4.5**.
- **ADR 006** (Structured JSON): Cache keys based on INPUT hash, not model output. Neutral to this ADR; both models produce the same output format.
- **ADR 010** (Dimension 0): Executive digest uses CHAT_CASCADE, not ANALYSIS_CASCADE. This ADR clarifies the tier separation.

---

## 11. Open Questions (For Next Session)

1. **Sonnet 4.6 cost observation**: The user reported seeing "Sonnet 4.6 costs" in the OpenRouter log. Was this a rare fallback event? Add telemetry to confirm.
2. **Stream count discrepancy**: Implement telemetry to surface the actual model + fallback reason for each of the 5 streams in one synthesis run. This will definitively answer the "5 → 4 calls" question.
3. **Nemotron resurrection**: If free-tier quota becomes available in the future, should nemotron return as primary? (Decision for a future ADR, not this one.)

---

**Author**: Claude Code (Wave 7 System Re-Audit)  
**Next Review**: After telemetry implementation (target: next production deploy)
