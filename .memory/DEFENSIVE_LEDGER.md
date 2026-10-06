# Defensive Fallback Ledger & Dependency Graph

> **Single Source of Truth (SSOT)** for all defensive defaults, fallbacks, coalesce operators, and recovery behaviors across `hex-yt-intel`.
>
> Established: 2026-10-06 | Governed by: **Defensive Ledger Contract** in [CLAUDE.md](file:///home/kellyb_dev/projects/hex-yt-intel-wt-10x/CLAUDE.md) & [AGENTS.md](file:///home/kellyb_dev/projects/hex-yt-intel-wt-10x/AGENTS.md).

---

## Architectural Purpose & Governance

Defensive code patterns (e.g. `?? fallback`, `|| defaultValue`, catch-and-return-null, and client-side retry recovery) prevent catastrophic failures during network degradation or database anomalies. However, when left unmapped, they become **shadow configurations** that mask root-cause configuration drift, bypass Settings Registry overrides, or cause silent cascade degradation.

This ledger formalizes every defensive node into a traceable dependency graph. 

### Ledger Structure
- **Node ID**: Domain-scoped identifier (`DOM-xxx`)
- **Module Path**: Source file relative to repository root
- **Line Reference**: Target line/block reference
- **Trigger Condition**: Anomaly or missing state that trips the defensive fallback
- **Fallback Value / Behavior**: The concrete default assigned or recovery path executed
- **Dependent Systems (Relatives)**: Downstream consumers, UI bindings, DB tables, or network services impacted

---

## 1. LLM Cascade & Model Routing

| Node ID | Module Path | Line Reference | Trigger Condition | Fallback Value/Behavior | Dependent Systems (Relatives) |
|---|---|---|---|---|---|
| `LLM-001` | `worker/src/services/LLMCascade.ts` | L34 | Missing/stale `llmCascadeHandshakeTimeoutMs` from client | `15000` ms (15s) | OpenRouter streaming handshake, SSE connection |
| `LLM-002` | `worker/src/services/LLMCascade.ts` | L35 | Missing/stale `llmCascadeTimeoutMs` from client | `240000` ms (4 min per tier) | OpenRouter streaming execution window |
| `LLM-003` | `worker/src/services/LLMCascade.ts` | L108 | `maxOutputTokens` undefined in constructor | `LLM_MAX_TOKENS_FALLBACK` (`{ haiku: 8192, default: 16000 }`) | Synthesis token cap, truncation guards |
| `LLM-004` | `worker/src/services/LLMCascade.ts` | L194 | Model call returns empty string or error string | `rawError = result.error \|\| 'No tokens produced'` | Error logger, fallback to next tier in `this.chain` |
| `LLM-005` | `worker/src/services/LLMCascade.ts` | L202 | Accessing next cascade tier label for logs | `this.chain[tierIndex + 1]?.name \|\| 'unknown'` | Structured Sentry & console cascade logs |
| `LLM-006` | `web/lib/config/cascade.ts` | L28-35 | `cascade.chat` missing in Settings Registry | `CHAT_CASCADE_FALLBACK` (Cerebras Llama 3.3 70B, Groq, Vertex Llama) | Chat API route, `useChatStore`, user assistant |
| `LLM-007` | `web/lib/config/cascade.ts` | L45-48 | `cascade.digest` missing in Settings Registry | `DIGEST_CASCADE_FALLBACK` (Groq Llama 3.3 70B, Cerebras) | `GenerateExecutiveDigestUseCase`, Dimension 0 UI |
| `LLM-008` | `web/lib/config/cascade.ts` | L50-65 | `cascade.analysis` missing in Settings Registry | `ANALYSIS_CASCADE_FALLBACK` (Claude Haiku 4.5 Anthropic / Vertex / Bedrock) | Worker UCIS analysis generation, streaming grid |
| `LLM-009` | `web/lib/config/cascade.ts` | L67-75 | `cascade.stance` missing in Settings Registry | `STANCE_CASCADE_FALLBACK` (Groq Llama 3.3 70B, Gemini 2.5 Flash) | Stance relations extraction, MindMap graph |
| `LLM-010` | `web/lib/config/cascade.ts` | L77-85 | `cascade.entityExtraction` missing in Registry | `ENTITY_EXTRACTION_CASCADE_FALLBACK` (Groq Llama 3.3 70B, Gemini 2.5 Flash) | Knowledge graph node extraction, entity tags |
| `LLM-011` | `web/lib/config/cascade.ts` | L87-91 | `cascade.reasoning.free` / `proEnterprise` missing | `REASONING_CASCADE_FREE_FALLBACK` / `PRO_FALLBACK` | Deep reasoning engine, multi-hop queries |
| `LLM-012` | `web/lib/adapters/OpenRouterCompletionAdapter.ts` | L8, L71 | `maxTokens` parameter not supplied | `DEFAULT_MAX_TOKENS = 2000` | Ad-hoc server-side completions, summarization |

---

## 2. Sensor Fusion & Diarization Probes

| Node ID | Module Path | Line Reference | Trigger Condition | Fallback Value/Behavior | Dependent Systems (Relatives) |
|---|---|---|---|---|---|
| `FUS-001` | `worker/src/services/sensor-fusion/probes/DiarizationFactory.ts` | L21 | Missing `totalCascadeTimeoutMs` in factory config | `DEFAULT_TOTAL_CASCADE_TIMEOUT_MS = 18000` (18s) | Diarization probe cascade, remaining budget check |
| `FUS-002` | `worker/src/services/sensor-fusion/probes/DiarizationFactory.ts` | L33 | Missing `diarizationCascadeOrder` in config | `DEFAULT_DIARIZATION_CASCADE = ['assemblyai', 'deepgram']` | Acoustic diarization provider ordering |
| `FUS-003` | `worker/src/adapters/AssemblyAIAdapter.ts` | L69 | Missing/invalid `timeoutMs` in adapter config | `ASSEMBLYAI_DEFAULT_TIMEOUT_MS = 15000` (15s) | AssemblyAI Universal-1 HTTP acoustic probe |
| `FUS-004` | `worker/src/adapters/DeepgramNova2Adapter.ts` | L81 | Missing/invalid `timeoutMs` in adapter config | `DEEPGRAM_DEFAULT_TIMEOUT_MS = 10000` (10s) | Deepgram Nova-2 HTTP acoustic probe |
| `FUS-005` | `worker/src/adapters/DeepgramNova2Adapter.ts` | L82 | Missing `model` in Deepgram adapter config | `DEEPGRAM_DEFAULT_MODEL = 'nova-2'` | Deepgram API parameter dispatch |
| `FUS-006` | `worker/src/services/sensor-fusion/probes/MultimodalProbeRunner.ts` | L29, L66 | Missing `model` in multimodal probe runner | `MULTIMODAL_PROBE_DEFAULT_MODEL = 'google/gemini-2.5-flash'` | Vision/audio frame inspection probe |
| `FUS-007` | `worker/src/services/sensor-fusion/probes/MultimodalProbeRunner.ts` | L30, L67 | Missing/invalid `timeoutMs` in multimodal runner | `MULTIMODAL_PROBE_DEFAULT_TIMEOUT_MS = 15000` (15s) | Multimodal visual frame analyzer probe |
| `FUS-008` | `worker/src/services/sensor-fusion/matrix/fusion-router.ts` | L41, L119 | Omitted `weights` parameter in `routeFusion()` | `DEFAULT_FUSION_WEIGHTS` (heuristics: 0.35, acoustic: 0.40, visual: 0.25) | Matrix router S1–S6 classification |
| `FUS-009` | `worker/src/services/sensor-fusion/heuristics/jev-text-parser.ts` | L56 | Omitted config in `JevTextParser` | `JEV_TEXT_PARSER_CONFIG_DEFAULTS = { requestTimeoutMs: 15000 }` | Structural turn-taking heuristic analysis |
| `FUS-010` | `worker/src/services/sensor-fusion/SensorRegistry.ts` | L128-130 | Diarization or multimodal probe failure | `diarizationSpeakerCount: 0`, `uiFramesDetected: false`, `debateProsody: false` | Matrix router fallback to heuristic classification |
| `FUS-011` | `worker/src/services/sensor-fusion/diarization-metrics.ts` | L87 | Unparseable or empty media URL for telemetry | Returns `'redacted-invalid-url'` or `'unknown'` | Sentry telemetry, PII leak protection |

---

## 3. Network Resiliency & Ingestion Timeouts

| Node ID | Module Path | Line Reference | Trigger Condition | Fallback Value/Behavior | Dependent Systems (Relatives) |
|---|---|---|---|---|---|
| `NET-001` | `worker/src/services/TranscriptExtractor.ts` | L84, L112 | Undefined `chainBudgetMs` in extractor | `DEFAULT_CHAIN_BUDGET_MS = 435000` (~7.25 min) | Multi-provider transcript fetch cascade |
| `NET-002` | `worker/src/services/TranscriptExtractor.ts` | L27, L120 | Undefined provider ordering string | `DEFAULT_PROVIDER_ORDER = 'transcriptapi,apify,decodo,native,supadata'` | Transcript extraction provider sequence |
| `NET-003` | `worker/src/services/CommentClassifier.ts` | L18, L93 | Comment classification fetch hang | `REQUEST_TIMEOUT_MS = 30000` (30s abort) | YouTube comment sentiment & stance labeling |
| `NET-004` | `worker/src/services/UpstashCacheAdapter.ts` | L13, L116 | Omitted TTL in cache `set()` | `DEFAULT_TTL_SECONDS = 604800` (7 days) | Redis transcript & relations caching |
| `NET-005` | `worker/src/services/chapter-persist.ts` | L78 | Video chapter persistence network latency | `10000` ms (10s abort) | Internal S2S chapter persistence |
| `NET-006` | `worker/src/queue-consumers/comments-tier3.ts` | L53, L81 | Comment run status query latency | `PERSIST_TIMEOUT_MS = 10000` (10s abort) | QStash comment batch processing |
| `NET-007` | `web/lib/services/dimension-remediation.ts` | L579-581 | Timeouts missing from Settings Registry | `timeoutMs: 240000`, `handshakeTimeoutMs: 15000`, `connectionTimeoutMs: 3000` | Background dimension gap remediation sweep |
| `NET-008` | `web/lib/adapters/DubShortLinkAdapter.ts` | L20 | Missing `dub.requestTimeoutMs` in registry | `DUB_CONFIG_FALLBACK = { requestTimeoutMs: 3000 }` (3s abort) | Short URL creation, share links |
| `NET-009` | `web/lib/utils/sign-out-with-timeout.ts` | L25-38 | Supabase Auth `signOut()` hanging indefinitely | Races against timeout, forces local session purge | Client signout flow, navigation state |

---

## 4. Remediation, Reaper & Database Defaults

| Node ID | Module Path | Line Reference | Trigger Condition | Fallback Value/Behavior | Dependent Systems (Relatives) |
|---|---|---|---|---|---|
| `DAT-001` | `web/lib/services/dimension-remediation.ts` | L84-88 | Settings keys missing for remediation | `REGISTRY_FALLBACK`: `maxRetries: 3`, `quarantineTtlSeconds: 21600` (6h) | Token-bucket spend guard, retry ceiling |
| `DAT-002` | `web/lib/services/dimension-remediation.ts` | L445 | `opts.limit` omitted in candidate scan | `100` rows per sweep (capped at `MAX_CANDIDATE_PAGES = 5`) | DB query page size, reaper memory usage |
| `DAT-003` | `web/lib/services/CombinerPass.ts` | L151 | Chunks lack canonical dimension title | `base.name \|\| 'Dimension ${dimNumber}'` | Stitched UCIS payload, markdown reconstructor |
| `DAT-004` | `web/lib/adapters/SupabaseBillingAdapter.ts` | L105, L139 | Profile row has null `tier` | `'free'` tier fallback | Feature gating, quota checks |
| `DAT-005` | `web/lib/adapters/PostgresBillingAdapter.ts` | L27, L73 | Missing `billing.quota.processingGraceWindowMs` | `REGISTRY_FALLBACK = 300000` (5 minutes) | Quota reservation expiry window |
| `DAT-006` | `web/lib/config/pricing-settings.ts` | L11-20 | Missing `billing.pricing.*` registry entries | `PRICING_REGISTRY_FALLBACK` (free: $0, light: $5, pro: $9) | Checkout flow, pricing cards |
| `DAT-007` | `web/lib/config/prior-payload.ts` | L16, L37 | Invalid or missing prior payload size limit | `PRIOR_PAYLOAD_MAX_BYTES_FALLBACK = 65536` (64 KB) | Projective synthesis context window payload |

---

## 5. UI State & Playback Ergonomics

| Node ID | Module Path | Line Reference | Trigger Condition | Fallback Value/Behavior | Dependent Systems (Relatives) |
|---|---|---|---|---|---|
| `UI-001` | `web/components/dashboard/HighlightsScrubber.tsx` | L96-98 | Registry settings missing for highlight playback | `min: 5s`, `max: 30s`, `fallback: 10s` (`HIGHLIGHTS_REGISTRY_FALLBACK`) | Highlights playback scrubber, auto-advance |
| `UI-002` | `web/components/dashboard/HighlightsScrubber.tsx` | L320 | Highlights fetch failure (500, 403, network drop) | Collapses gracefully (`return null`) without throwing | Dashboard layout, video player card |
| `UI-003` | `web/components/dashboard/HighlightsTrack.tsx` | L150 | Current video playback time is unmounted/null | Defaults to `0` seconds | Highlights scrubber playhead indicator |
| `UI-004` | `web/components/dashboard/HighlightsTrack.tsx` | L200 | Highlight collection has 0 duration | `Math.max(...) \|\| 1` (prevents division by zero) | Progress bar rendering, marker percentage |
| `UI-005` | `web/components/templates/console/DimensionDrawer.tsx` | L283 | ETA calculation returns null/undefined | Displays fallback empty/idle indicator | Jev run progress drawer, streaming progress |
| `UI-006` | `web/components/templates/console/ApexSummaryCard.tsx` | L106 | Selected summary tier tab is loading | `*Waiting for ${activeTab} summary layer...*` | Apex summary markdown renderer |
| `UI-007` | `web/components/containers/DashboardContainer.tsx` | L448-451 | Timestamp seek value is `00:00:00` or invalid | Rejects seek (`secs > 0` required) to prevent jump to start | VideoPlayerCard, word cloud entity clicks |
| `UI-008` | `web/components/organisms/ExecutiveSummary.tsx` | L97-100 | Stored digest payload has missing fields | Empty string `''` fallback per tier | 4-tier executive summary card |

---

## Contractual Verification Rule

Whenever code modifies any primary setting, timeout, API endpoint, or model parameter listed above, developers and agents **must** audit the corresponding `Node ID` and its **Dependent Systems** to ensure fallback behavior remains synchronized.
