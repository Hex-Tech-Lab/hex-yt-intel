# ADR 033: Bundle Prompt Caching
**Date:** 2026-09-26
**Status:** Accepted

## Context
The UCIS system runs 5 parallel analysis bundles for a single video. Without prompt caching, the identical transcript and core UCIS instructions (the prefix) are billed as input tokens 5 separate times, costing ~$0.096 per analysis in input tokens alone (at p90).

## Decision
Implement Anthropic prompt caching across the 5 bundles.
1. The prefix (UCIS core + transcript) is identical and deterministic across all 5 bundles.
2. The system message is constructed as a 2-block array, with `cache_control` applied to the prefix block.
3. Bundles 2-5 are staggered to wait for Bundle 1's first LLM delta (or explicit worker "llm-started" event) to ensure the cache is warm before they dispatch, guaranteeing cache hits.

## Consequences
- **Positive:** Input token costs drop from ~$0.096 to ~$0.03 per analysis, a substantial COGS reduction.
- **Negative:** Increased latency for bundles 2-5 due to the stagger gate, though mitigated by the fast time-to-first-token of the cache-warming bundle.
