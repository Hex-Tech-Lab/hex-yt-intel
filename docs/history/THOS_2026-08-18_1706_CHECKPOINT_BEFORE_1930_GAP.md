# CHECKPOINT — hex-yt-intel, before session gap until ~19:30 (user's local time)

**Written**: 2026-08-18, ~17:06 EEST, immediately before a usage-limit checkpoint. User has been working ~8 hours, stepping away, returning ~19:30.

## What's running right now (unresolved at checkpoint time)

1. **agentId `a4af0887d05b57fe4`** — n=8 revalidation of the "EXHAUSTIVE EXTRACTION MANDATE" factual-coverage fix, combined with existing structural fixes (D7/D8 checklist, D9/11 estimate fix), across all 5 real UCIS bundle groups × 8 real videos. This is THE real, load-bearing validation — if it confirms the n=1 result (factual 0→72, structural 0→100), that's strong evidence GPT-OSS-120B is production-viable for most of the UCIS pipeline. Output expected at `docs/research/2026-08-18-n8-validated-final-scores.md`.
2. **agentId `a3b4e2385d554126f`** — Settings-Registry-based multi-provider price-ID structure (Paddle/Dodo/Creem), real Paddle sandbox price objects if the MCP tool cooperated, real documentation of what Dodo/Creem need before they can go live. Branch: `feat/pricing-cogs-model-and-ui-2026-08-18`.

**On resume**: check both agents' real output files before trusting any summary — per this session's own standing rule, always verify a dispatched agent's actual deliverable on disk.

## Real state of the two open PRs

- **PR #240** (`feat/pricing-cogs-model-and-ui-2026-08-18`): all 5 real Cubic-flagged P0s fixed and pushed (checkout plan/interval wiring, candidate-pricing purchase gate, mock-data removal, route validation, founders-copy contradiction). Real remaining blocker: only Pro/monthly has a live price ID; Light/Max/Pro-yearly need real price IDs created before they can transact — this is what the two dispatched agents above are working toward. Two P1 items deprioritized (cascade registry migration check, digest token-cap bounded validation) — real, not yet done.
- **PR #239** (`fix/entity-color-taxonomy-mismatch`): WordCloud gray bug root-caused and fixed (commit `88d03e07`) — `useKnowledgeGraph.ts` wasn't normalizing entity types on its live-SSE/API paths. Graph rigid-layout bug also fixed (missing `d3ReheatSimulation()` call). Node-sizing gap (LLM-authored weight field, no prompt guidance) real and confirmed but NOT fixed — needs a worker-prompt change. **Not live-visually verified** (auth-blocked for the dispatched agent) — real open item, needs your own eyes on the real Vercel preview.
- **Real, deeper product critique from you tonight, not yet acted on**: the graph/WordCloud/MindMap don't currently deliver real value even once the color bug is fixed — POLE+O's 5 generic labels alone aren't useful, and the presentation itself (overlapping text, thick links, near-uniform sizing) reads as a gimmick, not a feature. This is a real, unresolved product-quality question, separate from the color bug — needs real design/product thinking, not just a bug fix.

## Real cost spent tonight (parity-test cohort specifically)

~$3.14 through the pre-harness-fix rounds, plus small amounts for the harness proof-run, per-stream re-derivation (free), D6 fix (~$0.02), factual-coverage investigation (~$0.015) — real total for tonight's testing work is in the single-digit dollars, not the earlier alarming $25→$16 trajectory (that included non-testing spend too).

## Real, load-bearing findings tonight (in case this doc is all that survives context)

1. Production digest generation already runs on GPT-OSS-120B, not Haiku (confirmed via code, contradicting every prior assumption).
2. GPT-OSS-120B's UCIS gaps are real prompt-engineering problems, not model-capability limits — proven twice: D7/D8's checklist fix (13%→100%, 0%→100%) and tonight's factual-coverage fix (0→72 at n=1, pending n=8 confirmation).
3. Real, permanent parity-test judge harness now exists at `docs/research/parity-test-harness/` — NEVER let a future session rebuild this from scratch again (this happened twice already, cost real money via judge-calibration drift).
4. Real cascade provider-order SSOT bug found — three disagreeing sources (web fallback, DB registry, worker hardcoded array). Web fallback + DB registry fixed; worker-side NOT fixed — real gap, `docs/TECH_DEBT_LEDGER.md` has the full writeup.
5. Real per-stream (not per-bundle) reporting is the correct methodology — bundle averages hid that D6 was the real outlier (18.8%) inside an otherwise-fine bundle.

## Real next steps on resume (priority order)

1. Verify both dispatched agents' real completion status and output files.
2. If the n=8 factual-coverage validation holds up, that's the real evidence base for a genuine pricing-Council session — the original goal of this whole detour.
3. Real live-visual check of PR #239's WordCloud fix (Vercel preview exists, `9316a80`/`a6b9f09` branch).
4. Decide on the graph/WordCloud/MindMap value question — is generic POLE+O labeling worth shipping at all without the tier-2 richness, or does it need to be reworked/hidden until it's genuinely useful.
5. Fix the worker-side cascade SSOT gap (`worker/src/services/LLMCascade.ts`).

Full detail in `docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` §6m (through §6m-xii+) and `docs/research/2026-08-18-*` files.
