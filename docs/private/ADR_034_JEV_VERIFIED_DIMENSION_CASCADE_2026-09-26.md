# ADR 034: Jev-verified Dimension Cascade
**Date:** 2026-09-26
**Status:** Proposed

## Context
Analysis COGS are driven by using a high-capability model (Claude Haiku 4.5) for all dimensions, even simple ones.

## Decision
Route dimensions through a cheaper drafter (GPT-OSS/GLM) first. The resulting drafts are scored by Jev (the Decisions API `POST /api/alpha/decisions`, ~0.5s). Only drafts that score low are escalated to the more expensive Haiku model for a rewrite.

## Consequences
- **Positive:** Expected to drop all-in costs from ~$0.10-0.12 (post L1+L3) to ~$0.06-0.08.
- **Negative:** Adds complexity to the routing and fallback logic; requires a quality bake-off on 10 real videos to tune the threshold.
