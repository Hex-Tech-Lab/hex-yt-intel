# Cost Component Enumeration — hex-yt-intel (2026-08-16)

Real repo scan, not a guess — every external/paid call site grep'd and individually checked for whether it's LLM-backed, before building any COGS estimate. This is the "list all angles where we spend money" step; dollar-figure estimation is the next, separate step once this list is confirmed complete.

## A. Per-analysis LLM cost drivers (scale with usage volume)

| Component | File | Confirmed real? | Notes |
|---|---|---|---|
| Main 11-dimension analysis cascade | `worker/src/services/LLMCascade.ts`, `worker/src/routes/analysis.ts` | ✅ real, primary cost | The base cost every June estimate was built on — needs re-verification against current model tier (nemotron-3-nano lead + free fallbacks → Haiku 4.5 per ADR 003/011), not assumed unchanged |
| Dimension remediation retries | `web/lib/services/dimension-remediation.ts`, `webhooks/remediate-dimensions/route.ts` | ✅ real, budget-gated | Real extra LLM calls beyond the base cascade — ADR 019's token-bucket budget already caps this (% of OpenRouter remaining balance), so it has a real ceiling, but the ceiling itself is a cost input, not zero |
| Dimension-0 executive digest | `webhooks/digest/route.ts` (uses `GenerateExecutiveDigestUseCase.ts`) | ✅ real | ADR 010 — separate, cheap, idempotent single cascade call per analysis |
| Embeddings | `web/lib/embeddings.ts`, `webhooks/embed/route.ts` | ✅ real, **currently zero user-facing value** | OpenRouter embedding call fires per analysis via webhook; `web/app/api/search/route.ts` consumes it but has zero UI callers found anywhere in `web/components`/`web/app` — real spend, no attached feature right now. Flagging as a candidate to pause (stop the spend) or ship (build the search UI) — not a decision to make silently here. |
| Relations engine (KG relation inference) | `web/lib/intelligence/relations-engine.ts` | ✅ real, 4 LLM call sites confirmed | Part of knowledge-graph construction, runs per analysis alongside entity extraction |
| Comments classification | `worker/src/services/CommentClassifier.ts` | ✅ real | Comments-sampling engine (Phases 0-4 shipped per project memory) — this is the "comments ingestion would require a pack/credit" cost you flagged; real, separate LLM cost per comments-analysis job, distinct from the base video analysis |
| Chat | `worker/src/chat-stream.ts`, `web/lib/usecases/ProcessChatMessageUseCase.ts` | ✅ real, **ongoing, not one-time** | Separate CHAT_CASCADE (ADR 011) — cost scales with number of chat turns per user, not a fixed per-analysis cost. This is the "est. chat turns" driver you flagged; needs a per-turn cost × assumed-turns-per-user estimate, not a flat add-on |

## B. Per-video, non-LLM external costs

| Component | File | Confirmed real? | Notes |
|---|---|---|---|
| Transcript extraction | `worker/src/services/TranscriptExtractor.ts` | ✅ real | Decodo API, per earlier research: ~$1.00/1,000 requests (verified 2026-06-09 Council pass — this specific figure is a real, verified API price, not the stale COGS-per-video conclusion built from it) |
| Channel/video metadata | `worker/src/routes/channel-meta.ts` | ✅ real | YouTube Data API v3 — generally free-tier quota-based, not a per-call $ cost, but has a real daily quota ceiling worth knowing |

## C. Non-LLM webhooks — checked individually, not LLM cost drivers

`compliance-check`, `wiki-builder`, `oracle-sequence`, `ffmpeg-enrich` — all 0 LLM call sites confirmed via grep. These may still carry real compute-time cost (Cloudflare Workers CPU-seconds, Vercel function invocations) but are not model-API spend. Not further classified in this pass — flag if any of these turn out to be non-trivial compute cost once §D is priced.

## D. Infrastructure / platform costs (subscription or usage-tier, not per-analysis)

| Component | Notes |
|---|---|
| Cloudflare Workers | Compute time for the LLM-streaming worker — CPU-seconds billed, budgeted (paid plan, 30s default/5min configurable per Law #2). Scales with cascade duration, not directly with token cost. |
| Vercel | Hosting + function invocations (auth/quota bouncer path, Serverless not Edge). |
| Supabase | DB + storage, scales with row count / query volume, not per-analysis directly. |
| Upstash Redis | Rate limiting + KV cache — usage-based. |
| Upstash Vector | Vector DB for the embeddings above — usage-based, directly tied to §A's embeddings spend. |
| QStash | Job queue (async pipeline, remediation dispatch) — per-message cost. |

## E. Explicitly resolved, not a separate cost

**Grounding vs. websearch**: "grounding" in this codebase (ADR 008) means injecting the analysis's own already-generated content into the chat LLM's prompt context — it is the same chat cascade call in §A, not a second external websearch API. There is no live websearch-augmented mode wired into the app with its own cost right now. (My own Exa/Brave/SerpAPI research-tool usage this session is unrelated — a Claude Code session cost, not app runtime spend.)

## Next step (not done in this pass)

Price each confirmed component in §A/B against current OpenRouter model-tier rates and realistic per-user usage assumptions (base analysis + remediation retry rate + average chat turns/user + comments-job attach rate) to produce a corrected COGS-per-user estimate — replacing the stale June 9 $0.0615/video single-call figure. This is the input the pricing Council round needs before §3 of the framed question can be finalized.
