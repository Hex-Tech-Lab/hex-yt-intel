# ADR 028 Phase 2: Ingestion & SimHash Integration Audit

## 1. Input-to-Output Call Graph

**1.1 Ingestion Trace**
*   **[web/lib/usecases/ExtractHighlightsUseCase.ts:203-219](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/usecases/ExtractHighlightsUseCase.ts#L203-L219)**: Modifies the finalization step of the extraction pipeline. Once semantic highlights are built and saved, it triggers the secondary SimHash pipeline if valid transcript segments exist.
*   **[web/lib/utils/simhash.ts:32-45](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/simhash.ts#L32-L45)**: Translates 30-second temporal windows of normalized transcript text into robust `64-bit BigInt` fingerprints.
*   **[web/lib/ports/TemporalKnowledgePort.ts:18](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/ports/TemporalKnowledgePort.ts#L18)**: Abstraction boundary for persisting `TemporalSubgraphNode[]` matrices.
*   **[web/lib/adapters/SupabaseTemporalGraphAdapter.ts:16-30](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/adapters/SupabaseTemporalGraphAdapter.ts#L16-L30)**: Adapts the anchor array into structured multi-row `.insert()` queries targeting `analysis_simhash_anchors`.
*   **[web/app/api/webhooks/highlights/route.ts:52-57](file:///home/kellyb_dev/projects/hex-yt-intel/web/app/api/webhooks/highlights/route.ts#L52-L57)**: DI container wiring `SupabaseTemporalGraphAdapter` into `ExtractHighlightsUseCase`.

**1.2 Consumption Trace (Grounding)**
*   **[web/app/api/chat/conversations/[id]/messages/route.ts:104-110](file:///home/kellyb_dev/projects/hex-yt-intel/web/app/api/chat/conversations/[id]/messages/route.ts#L104-L110)**: Injects the graph adapter into the chat handler boundary.
*   **[web/lib/usecases/ProcessChatMessageUseCase.ts:468-477](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/usecases/ProcessChatMessageUseCase.ts#L468-L477)**: Detects expired (>72h) transcript context (`!groundingData.transcript`). Invokes fallback temporal graph bridging (`temporalGraph.queryTemporalSubgraph`), serializing nodes efficiently back into the LLM synthesis window.

## 2. Dead-Code Attestation

**Status: VERIFIED 100% UTILIZATION**
No uncalled helper functions, speculative schema modifications, or dead utility paths exist. 
*   `queryTemporalSubgraph`: Verified mapped to chat LLM grounding generation on transcript cache misses.
*   `storeSimHashAnchors`: Verified triggered on the webhook extraction finalization branch.
*   `computeSimHash64`: Directly supplies the `simhash64` value in the batch save iterations. 

All interfaces enforce strict type safety (`TemporalKnowledgePort`). No loose `Record<string, unknown>` bypasses were permitted for the temporal matrix.

## 3. Empirical Verification & Test Output

A dedicated integration test suite covering end-to-end integration and temporal query edge cases was authored and verified locally.

**Raw Testing Stats:**
*   **Total Test Suites**: `109 Files`
*   **Vitest Status**: `1,299 passed | 0 failed`
*   **New Specs**: 
    *   `extract-highlights-simhash.test.ts` (Asserts 30s chunk alignments mapping to bounded ranges)
    *   `process-chat-temporal-grounding.test.ts` (Validates fallback routing triggered solely when raw transcripts return `null`)
*   **Lint**: Clean

## 4. Cyclomatic Complexity Delta

**Status: MAINTAINED**
No single function surpasses the cyclomatic complexity threshold of `>10`. The chunking generator implements bounded `< 5` depth (one `for` loop mapping the windows).

## 5. Branch Validation

Target execution branch: `feat/adr-028-temporal-sqlgraph`
Final Execution Checkpoint SHA: `ef49242d`
All cjs artifacts used for compilation are pruned. Pipeline tests are green.
