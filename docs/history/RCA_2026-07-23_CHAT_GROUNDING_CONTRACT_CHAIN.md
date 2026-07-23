# RCA: Chat Grounding Contract Chain — Transcript, Metadata, Dimension 0

**Date:** 2026-07-23
**Trigger:** Live testing showed chat repeatedly answering "no transcript available" / "no timestamped transcript" on analyses that had genuinely succeeded, plus an explicit requirement to ground chat in full video+channel metadata, comments, and all 12 dimensions (0-11) with a timestamped transcript.
**Scope of this document:** not a single point-fix — a full audit of the ingestion → analysis-stream → persist → grounding → chat contract chain, covering what was broken, what was fixed, and what remains a real risk or gap.

---

## 1. The chain, as it actually exists

```
Browser (CreateAnalysisUseCase)
  └─ WorkerIngestionAdapter.fetch()
       ├─ GET  /fetch-metadata   (CF Worker → YouTube Data API + Decodo fallback)
       └─ POST /fetch-transcript (CF Worker → TranscriptExtractor.fetch())
  └─ returns { metadata, transcript, transcriptAvailable, segments }  →  client

Browser (useSSEStream, 5 parallel bundle streams)
  └─ POST /analyze-llm-stream × 5  (each carries transcript + segments + metadata)
       CF Worker (analysis.ts)
         ├─ fetchTranscriptIfMissing()  — re-fetches ONLY if transcript missing
         ├─ fetchChannelMetaCached()    — cached, time-bounded (fixed tonight)
         └─ PersistService.persist()  → POST /api/analyses/persist  × 5 (+ finalize)

Vercel (/api/analyses/persist)
  ├─ writes analyses.validation_report  (metadata, channelMeta, dimension_status, ...)
  ├─ writes analyses.analysis_markdown / analysis_payload  (dimensions 1-11)
  └─ writes transcripts.{content,segments}  (upsert, keyed by clean video_id)

Vercel (/api/analyses/digest)  — SEPARATE, on-demand, triggered by the
  Executive Summary panel mounting client-side
  └─ writes analyses.executive_digest  (Dimension 0: snapshot/overview/takeaways/detailedSummary)

Chat (ProcessChatMessageUseCase ← SupabaseAnalysisAdapter.getAnalysisGrounding)
  └─ reads analyses.{title, channel_title, analysis_markdown, analysis_payload,
       validation_report, executive_digest} + transcripts.{content, segments}
  └─ builds one system prompt string, sent to the LLM
```

Every bug fixed tonight, and every risk below, is a break somewhere in this chain — either a value silently dropped between two hops, or a hop that runs more often / more expensively than the architecture assumed.

---

## 2. What was actually broken, and the real root causes

### 2.1 Transcript never reached the `transcripts` table (root cause of "no transcript")

`fetchTranscriptIfMissing()` only calls `TranscriptExtractor.fetch()` — the only source of timed `segments` — when the incoming `transcript` string is empty. In the common, successful case, the transcript was **already known** from the initial ingestion call, so this function returned early with `segments: undefined`. Both write sites in `/api/analyses/persist` were gated on `segments.length > 0`, so **nothing was ever written to the `transcripts` table for the majority of successful analyses** — confirmed live via direct DB query on a real analysis (`validation_report.transcript_available: true`, zero rows in `transcripts`).

Fix: thread the flat transcript text through the persist contract alongside segments; write to `transcripts` using flat text as a fallback when segments are unavailable.

### 2.2 Segments never reached the worker at all (root cause of "no timestamps" persisting after 2.1)

Even after 2.1 shipped, live testing showed a *second*, deeper break: the transcript row now existed, but `segments` was always an empty array. Trace: the CF Worker's own `/fetch-transcript` route (hit during **initial ingestion**, the path that succeeds for nearly every video) already returns segments — `TranscriptExtractor.fetch()` produces them internally and the route spreads `...result` into its JSON response. But three call sites in a row discarded them:

1. `WorkerIngestionAdapter.fetchWorkerTranscript()` read only `data.transcript`.
2. `CreateAnalysisUseCase`'s response to the browser never carried a `segments` field.
3. `useSSEStream`'s POST body to the CF Worker's `/analyze-llm-stream` never included `segments`.

So `req.segments` was always empty when it reached `fetchTranscriptIfMissing()`, and since the transcript was already known (see 2.1), the function's own fetch branch — the only other source of segments — never ran either. **Two independent, compounding gaps had to both be closed for the common case to work at all.**

Fix: thread `segments` through all three hops. No extra network calls needed — the data was already being fetched and returned, just dropped at each boundary.

### 2.3 Channel metadata was fetched and immediately discarded

`TranscriptExtractor.fetchChannelMetadata()` was called on every analysis (when `channelId` was known) and its result was used for exactly one `console.info` log line, then thrown away. Full video metadata (views, likes, comment count, publish date) *was* persisted but never included in the chat system prompt. Fixed by threading `channelMeta` through the persist contract into `validation_report.channelMeta`, and adding both metadata blocks to the grounding prompt.

### 2.4 Dimension 0 (executive digest) was invisible to chat — found during this audit, not live-tested yet

`getAnalysisGrounding()`'s `SELECT` never included the `executive_digest` column. Chat only ever saw dimensions 1-11. This is a real, separate gap from the transcript issue — the product surfaces the 4-tier digest (Snapshot/Overview/Key Takeaways/Detailed Summary) prominently and the user confirmed it renders correctly, but chat had zero access to it. Fixed by selecting the column, narrowing it with a has-content check, and surfacing it as its own section ahead of the 11-dimension body.

---

## 3. Blind spots and risks surfaced by auditing the fix itself (not by a new bug report)

Fixing 2.1-2.3 changed *how often* and *how expensively* two calls run. Reviewing the chain after the fact surfaced three real problems the point-fixes introduced:

### 3.1 5x cost multiplier on channel metadata (fixed)
The architecture runs **5 parallel bundle streams per analysis**, each an independent SSE POST to `/analyze-llm-stream`. Removing the "only fetch if transcript missing" gate from the channel-metadata fetch meant it now ran unconditionally on **all 5 bundles**, uncached — a 5x Decodo API call multiplier on every single analysis, forever, for a field that changes rarely.
**Fixed:** Upstash cache keyed by `channel-meta:<channelId>`, 7-day TTL.

### 3.2 Unbounded latency on the critical path (fixed)
The channel-metadata fetch was `await`ed unconditionally before the bundle's synthesis could proceed — including on the previously-instant "transcript already known" fast path. `fetchChannelMetadata` has its own 15s internal timeout; a slow/degraded Decodo could have added up to 15s of latency to *every one* of the 5 bundles, for a nice-to-have enrichment field, risking exactly the stream-timeout-into-billing-failure class of bug the A6/A7 fixes (documented in the roster) closed.
**Fixed:** bounded to 4s via `Promise.race`; on timeout the analysis proceeds without channel metadata rather than stalling.

### 3.3 Unbounded payload size (fixed)
Decodo's `youtube_channel` scrape target has no documented shape or size contract. Whatever it returns lands in an **unbounded `jsonb` column** (`validation_report.channelMeta`) and, after tonight's fix, in **every future chat system prompt** for that video.
**Fixed:** capped at 20KB at two points — the worker (drop before sending) and the persist route (drop after parsing, defense in depth since it's a separate deployable across a network boundary).

### 3.4 Concurrent writes to `transcripts` — benign today, fragile as an invariant
All 5 bundle streams call the same chunk-path safety-net upsert to `transcripts`, each with (in practice) identical `segments`/`transcript` content, since all 5 receive the same `req.transcript`/`req.segments` from the single initial ingestion call. This is currently harmless (idempotent overwrite of equal values) but relies on that equality holding — `SupabaseTranscriptAdapter.upsertTranscript`'s own check-then-upsert is explicitly documented as non-atomic for the `created_at`/`expires_at` fields. If a future change makes any bundle fetch its own transcript independently, this becomes a real race. Not fixed tonight — flagging as a structural fragility, not an active bug.

### 3.5 `channelId` is not reliably populated
Direct DB query during this session found at least one recent analysis with `validation_report.metadata.channelId: null`. When `channelId` is missing, the channel-metadata enrichment silently no-ops (by design — no error, no fallback). Not investigated further tonight; worth checking `MetadataScraper`'s channelId extraction reliability if channel metadata coverage turns out to be inconsistent in practice.

### 3.6 Dimension 0 grounding depends on UI-triggered generation order
`executive_digest` is populated by a **separate, on-demand** use case (`GenerateExecutiveDigestUseCase`), invoked only when the client hits `/api/analyses/digest` — which happens when the Executive Summary panel mounts in the browser. If a user opens chat and asks a dim-0-flavored question *before* ever viewing that panel, `executive_digest` may still be `NULL`, and grounding will correctly omit it (no error — just silently absent). This is a timing/ordering gap, not a bug in tonight's fix, but it means "chat has dim 0" is conditional on UI interaction order, which the user should know does not always hold.

### 3.7 Prompt-injection surface, widened but not new
Transcript, description, and now channel metadata are all creator-controlled text injected verbatim into the system prompt with no sanitization. This was already true for transcript/description before tonight; channel metadata (channel-owner-controlled scrape content) is the same trust tier as the existing description field. Not a new *category* of risk, but the attack surface is larger now that channel metadata flows through too. No mitigation implemented tonight — consistent with how the existing fields are (not) handled; flagging for awareness, not treating as a regression.

---

## 4. Explicitly NOT implemented — comments

**Comments (with per-comment author/timestamp metadata) do not exist anywhere in this codebase.** Confirmed via full-repo search: no `commentThreads` call, no comments table, no comments field on any type. This is not a bug to fix — it is a net-new feature. Rough shape if pursued:

- **Fetch:** YouTube Data API `commentThreads.list` (needs a new quota-costed call per analysis; YouTube Data API has a daily unit quota shared with existing metadata calls).
- **Storage:** new table or jsonb column, keyed by video_id, similar to `transcripts` (author, publishedAt, text, likeCount per comment, cap N most-relevant/most-liked comments to bound cost).
- **Wiring:** thread through the same three-hop pattern this RCA just fixed for segments (ingestion → client → worker → persist) — this codebase now has a working template for exactly that pattern.
- **Grounding:** a new `--- COMMENTS ---` section, size-capped like channel metadata.
- **Cost consideration:** unlike channel metadata (7-day cache, one fetch per channel), comments are per-video and would need their own cache/TTL strategy to avoid the same 5x-per-analysis multiplier class of bug found in §3.1.

Deliberately scoped out of tonight's work given the size of the remaining chain audit; flagged as the one explicit requirement not delivered.

---

## 5. Verification performed

- `pnpm type-check`, `pnpm lint`, and the relevant vitest suites (chat-grounding-gate, chat-knowledge-history-injection, chat-contracts, executive-digest, executive-digest-usecase, persist-validation, analysis-creation.contract) all green after each commit.
- Worker `typecheck` + `esbuild build` green after each commit.
- Live DB queries against production confirmed: transcript persistence now works for fresh analyses (8.6KB verbatim text confirmed for one real video); prior gap confirmed via direct query (zero `transcripts` rows despite `transcript_available: true`).
- **Not yet live-verified:** segments (timestamps) reaching a fresh analysis end-to-end, and the Dimension 0 grounding fix — both shipped in this session's final commits; require the user to run one more fresh analysis and ask a minute-specific question, since this agent has no authenticated browser session to trigger analyses itself.

## 6. Commits (chronological)

1. `04616575` — persist verbatim transcript even without timed segments (§2.1)
2. `dfbec72b` — ground chat in full video/channel metadata + timestamped transcript (§2.3, first pass at §2.2's rendering)
3. `b9d63e5e` — thread timed segments from initial ingestion to chat grounding (§2.2, the actual root cause)
4. `7a99dcb7` — cache + bound channel-metadata enrichment, cap payload size (§3.1, §3.2, §3.3)
5. `6ac34d7a` — include Dimension 0 executive digest in grounding (§2.4)
