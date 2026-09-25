# ADR 035: Tiered Compute Depth
**Date:** 2026-09-26
**Status:** Proposed

## Context
Not all users require the full UCIS compute pipeline (all dimensions, knowledge graph, personas). A cheaper Light tier ($9/mo) needs a fundamentally cheaper execution path to remain profitable.

## Decision
Introduce a direct "transcript-to-digest" path that bypasses the full UCIS compute for Light tier users. This path generates only the core highlights and summary, skipping heavy metadata dimensions.

## Consequences
- **Positive:** Dramatically reduces COGS for Light tier users, preserving healthy margins even at 100% utilization.
- **Negative:** Creates two distinct product experiences that must be clearly communicated and maintained.
