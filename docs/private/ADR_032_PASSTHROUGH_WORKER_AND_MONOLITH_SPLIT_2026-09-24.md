# ADR 032 — Byte-Relay Worker, Vercel-Side Parsing, and the First Monolith Split

**Status**: ACCEPTED (2026-09-24, user approved; job A interim fix approved for merge).
**Supersedes in part**: ADR 005 (hybrid edge; the Cloudflare/Vercel split stays, responsibilities move), ADR 006 (structured JSON streaming; parsing moves off the worker).
**Inputs**: AGY pipeline map (`docs/research/2026-09-24-analysis-pipeline-e2e-map.md`, PR #323); job A worker-CPU fix (`7d727e3a`, branch `fix/worker-free-plan-cpu`); Cloudflare observability logs for the 2026-09-23 incident (PR #321); Vercel project settings (checked by the user 2026-09-24).

---

## 1. Context

On 2026-09-23 Cloudflare began strictly enforcing the Workers **Free plan limit of 10 ms CPU per request**. Every analysis stream was killed with `exceededCpu` ("Stream ended without a terminal signal"). The worker had been using 370–876 ms CPU per stream for a month without being killed. Upgrading is not an option: all infrastructure stays on free plans.

Measured and verified facts:
- Job A's `BracketBuffer` fix removed the quadratic rescan (scanned chars 1.85e8 → 9.4e4 on a 94 KB stream), but `feed()` alone still took **17.6 ms** on that stream. A parse-on-worker design cannot fit in 10 ms, whatever its optimisations.
- The AGY map's inventory puts today's worker at an estimated **58–117 ms CPU per stream** across ~11 operations (BracketBuffer, JSON.parse per fragment, jsonrepair, markdown reconstruction, Zod, prompt building, chapter regex, comment sampling, SSE serialisation, HMAC).
- Time spent waiting on network I/O does not count as Cloudflare CPU time. Long streams are fine as long as the worker does almost no computation per byte.
- Vercel: **Fluid Compute is enabled**, default function max duration **300 s** (Hobby ceiling), region `cdg1`, 1 vCPU / 2 GB. Vercel cannot hold the 3–60+ minute LLM stream (the original reason for ADR 005), but it can easily run a one-shot prepare step and a one-shot parse/persist step.

## 2. Decision

**The Cloudflare worker becomes a byte relay. It never parses, decodes, or re-serialises model output.** All parsing moves to Vercel, which does it once per analysis at persist time. The browser keeps its existing live parser for display only. Persistence must never depend on the browser staying open.

### 2.1 Responsibilities after the change

| Step | Where | What it does | CPU-sensitive? |
|---|---|---|---|
| Prepare (once per analysis) | **Vercel** `CreateAnalysisUseCase` | Quota/auth, transcript + metadata + comments fetch, comment sampling, chapter parsing (once), prompt build. Builds the **complete OpenRouter request body** per chunk, including `models: [primary, fallback…]` (OpenRouter-native fallback), and stores it in Upstash Redis under `analysis:{id}:chunk:{n}:request` (TTL 1 h). Issues the signed stream token. | No (Vercel, 300 s) |
| Stream (long, per chunk) | **Cloudflare worker** | Verify token (one HMAC). GET the prebuilt request bytes from Redis. `fetch` OpenRouter with those bytes unchanged. `tee()` the response body: branch 1 pipes to the browser unchanged; branch 2 is collected as an array of raw `Uint8Array` chunks (no decoding, no parsing). On end, POST the concatenated raw bytes to Vercel `/persist` via `ctx.waitUntil` with an HMAC over the SHA-256 digest. | **Yes, target < 5 ms p99** |
| Live display | **Browser** | Existing SSE parsing + `StreamDeltaHandler.healJson()`; unchanged except it now reads OpenRouter's SSE format directly instead of the worker's re-emitted events. | Browser |
| Parse + persist (once per chunk) | **Vercel** `/persist` (split, see 2.3) | Verify HMAC; parse the raw SSE (extract `delta.content`, `usage`, `finish_reason`, which model served it); `jsonrepair`; Zod; dimension extraction; chunk CAS; stitch; markdown reconstruction; side effects (embed/digest/highlights/validation publish). | No (Vercel, 300 s) |
| Cancel | Browser abort → worker sees client disconnect → aborts upstream fetch | Replaces the 3 s Redis cancel-polling loop. | Removes a CPU source |

### 2.2 Why the raw-bytes detail matters
OpenRouter streams one SSE event per token (`data: {"choices":[{"delta":{"content":"…"}}]}`). Extracting the text on the worker, even without BracketBuffer, costs one `JSON.parse` per token, thousands per stream. That is the cost the AGY map's Option A left in place ("accumulate the raw text buffer"). Keeping raw bytes means the worker's per-byte work is a native stream tee plus an array push.

### 2.3 First monolith cut (on-path only; the rest in later waves)
- `worker/src/routes/analysis.ts` (1,260 LOC) becomes a thin route plus three small units: `StreamTokenVerifier`, `UpstreamRelay` (fetch + tee + collect), and `PersistRelay` (waitUntil POST with retry). BracketBuffer, MarkdownReconstructor, PersistService parsing, PromptBuilder, chapter parsing and MetadataScraper leave the worker's request path.
- `web/app/api/analyses/persist/route.ts` (1,507 LOC) becomes a thin HMAC/route handler over `PersistAnalysisChunkUseCase`, with adapters `OpenRouterSseParser` (raw bytes → text + usage + model), `ChunkStitcher`, and `PersistSideEffects` (QStash publishes). Existing behaviour (CAS, reaper hand-off, dual write) stays; code moves.
- On-path tangents fixed in the same waves: hardcoded 25 s handshake timeout in `useSSEStream.ts` → registry key; 3 s cancel poll removed; quadratic comment slicing in persist (repeated `JSON.stringify` in a loop) → single pass; `parseChapters` run once; `REAP_GRACE_MINUTES = 30` → registry key.

## 3. Invariants (each needs a test)
1. Worker CPU per stream request < 5 ms p99, measured from Cloudflare observability `cpuTime`, never estimated.
2. Persistence never depends on the browser: closing the tab at any point still persists what the model produced.
3. The browser never sends model output to `/persist` (no client tampering path).
4. Every persisted chunk is HMAC-verified over the digest of the exact bytes the worker received.
5. An old/new path switch lives in the Settings Registry (`analysis.pipeline.mode = legacy | relay`) and stays until wave 3 passes.
6. Zero analyses lost during rollout: the reaper and remediation keep working for both modes.

## 4. Risk register

| # | Risk | Likelihood | Impact | Mitigation / how we check |
|---|---|---|---|---|
| R1 | Raw SSE is ~5–10× the text size (a long analysis may reach 1–2 MB), close to Vercel's 4.5 MB request body limit | Medium | High | Measure real sizes in wave 2a on 3 h videos. If needed, persist per chunk (already chunked by bundle) or strip SSE framing with a native `TextDecoderStream` + line split measured under CPU budget. |
| R2 | YouTube blocks or throttles transcript/metadata fetches from Vercel datacenter IPs (they currently run on Cloudflare) | Medium | High | Wave 2a spike: fetch transcript + metadata for 20 real videos from Vercel `cdg1` before moving anything. Fallback: keep only the fetch on the worker (I/O only), passing raw bytes through Redis. |
| R3 | `crypto.subtle` digest/HMAC over 1–2 MB counts toward worker CPU | Low | Medium | Measure in wave 2b; the alternative is HMAC over a short token plus server-side size/sequence checks. |
| R4 | Browser parser currently expects the worker's re-emitted events, not OpenRouter's raw SSE | High (certain) | Medium | Wave 2c adapts `synthesis-stream-adapter` behind the mode switch; contract test on real recorded streams. |
| R5 | OpenRouter `models` fallback behaves differently from the hand-written cascade (timeouts, which errors trigger fallback) | Medium | Medium | Wave 2b test against live OpenRouter with a forced-failing primary; keep registry-driven model lists. |
| R6 | Vercel `/persist` parsing time on the largest chunk | Low | Low | 300 s budget; measure p99 in wave 3. |
| R7 | Redis free-plan command quota with prebuilt request storage | Low | Low | One SET + one GET per chunk. |
| R8 | Worker memory holding raw chunks | Low | Low | 128 MB limit versus a few MB. |

## 5. Plan (each wave is small, delegated as discrete OC tasks; CC reviews every wave)
- **2a Spikes (measure before building):** (i) real raw-SSE sizes for 3 min / 28 min / 1 h / 3 h videos; (ii) Vercel-side YouTube fetch success from `cdg1` on 20 videos; (iii) worker CPU of tee + collect + HMAC on a recorded 2 MB stream.
- **2b Worker relay** behind `analysis.pipeline.mode`: token verify, Redis request fetch, upstream relay, persist relay, abort propagation.
- **2c Browser** reads raw OpenRouter SSE in relay mode (display only).
- **2d Vercel prepare**: move transcript/metadata/comments/chapters/prompt build to `CreateAnalysisUseCase`; store prebuilt request bodies.
- **2e Vercel persist split**: `PersistAnalysisChunkUseCase` + `OpenRouterSseParser` + `ChunkStitcher` + `PersistSideEffects`; old route becomes a thin handler for both modes.
- **2f Tangents** listed in 2.3.
- **Wave 3 proof**: real videos at 3 min, 28 min, 1 h, 1.5 h Arabic, 3 h; zero `exceededCpu`; worker CPU p99 < 5 ms; tab-close test at 50% and 95%; all dimensions persisted; then flip the default to `relay` and schedule deletion of the legacy path.

## 6. Alternatives rejected
- **Browser-driven persistence (map Option B):** loses analyses on tab close; lets the client tamper with persisted output.
- **QStash ingestion queue (map Option C):** extra hop and quota for no gain over a direct `waitUntil` POST.
- **Optimise the parser to fit in 10 ms:** measured at 17.6 ms for `feed()` alone after job A's fix, before any other step.
- **Paid Cloudflare plan / move the stream to Vercel:** excluded by the free-plan constraint and Vercel's inability to hold long streams.

## 7. Open questions for the user
1. Approve the decision (byte relay + Vercel parsing), including moving transcript/metadata fetching to Vercel subject to spike R2.
2. Approve merging job A's BracketBuffer fix now as an interim reduction (it still exceeds 10 ms on long streams, so it is not a fix on its own).
