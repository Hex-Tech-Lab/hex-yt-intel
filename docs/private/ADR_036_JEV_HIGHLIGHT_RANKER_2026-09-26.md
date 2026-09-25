# ADR 036: Jev Highlight Ranker
**Date:** 2026-09-26
**Status:** Proposed

## Context
The highlight extraction process selects segments based on overlap and basic heuristics, sometimes producing a reel that is not "smart" or misses key structural elements of long videos (e.g. 32-min videos getting front-loaded).

## Decision
Use Jev as an importance ranker to score highlight candidates. The goal is to accurately distil a 60-minute video into a 5-10 minute reel, prioritizing the highest-scoring segments across the entire duration.

## Consequences
- **Positive:** Vastly improves the quality and representative spread of the generated highlight reels.
- **Negative:** Adds latency and a slight API cost to the highlight generation phase.
