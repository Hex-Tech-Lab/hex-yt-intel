# Agent Dispatch — Cline (Nemotron 3.5 Lightning, low effort) — 3-tier draft/review/refine pipeline fidelity test

## Model-tuning note
Low-effort tier — literal numbered steps, not prose principles. Same guardrails as the earlier MCP-verification dispatch: never print credential values, verify claims against real evidence before reporting, re-read files/data after any write.

## 0. Ledger protocol — ALWAYS
Follow `AGENTS.md` §5 in full: read `.memory/AGENT_LEDGER.md` and `.memory/ADRS.md` first; post `[IN_PROGRESS]` with intent + target files before touching anything; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary at the end.

## 1. Context
hex-yt-intel is a YouTube-analysis SaaS. The Dimension-0 "Executive Digest" pass (`web/lib/prompts/executive-digest.ts`) currently runs on Haiku 4.5. We're testing whether a cheaper 3-tier pipeline can match Haiku-4.5-only quality: **(1) GPT-OSS-120B drafts** the digest from the assembled 11-dimension markdown, **(2) a peer-review-style cross-check pass** (a second GPT-OSS-120B call reviewing the draft against the source markdown for gaps/errors), **(3) Haiku 4.5 does a final verify/refine pass working from the condensed draft + review notes**, not from the raw source markdown — this should be far cheaper than Haiku generating from scratch since its input is a short draft, not the full 11-dimension text.

This hypothesis is modeled directly on the real LLM Council process just run in this project (13 advisors → anonymized peer review → Chairman synthesis) — that process demonstrably caught real findings in its third pass that the first two passes missed, using the same model throughout. The bet here is the same structural benefit applies to the digest pipeline even with a cheaper model doing most of the work.

There is a **separate, already-written test** (`docs/agent-prompts/2026-08-17-oc-digest-fidelity-test.md`, not yet run) that compares GPT-OSS-120B-only vs the real historical Haiku-4.5 baseline — a flat 2-way comparison. This task is different and complementary: it tests the **3-tier pipeline** specifically, not a flat model swap. Run both if resources allow; this one is the higher-value hypothesis per the project's pricing strategy doc (`docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` §6m).

## 2. Task
1. Query the `analyses` table (Supabase, project ref `adnmbikaqnxivalqoild`) for real completed rows with `dimension_count = 11` and a non-null digest field — verify the actual column name from the live schema, don't assume. Select 4-6 rows, prioritizing language diversity if the multilingual test harness at `/tmp/mling-test/` still exists and can be reused for row selection logic.
2. For each row, extract: the real assembled 11-dimension markdown (the original digest-pass input) and the real Haiku-4.5-generated digest (the baseline to compare against).
3. For each row, run the 3-tier pipeline:
   - **Tier 1**: call GPT-OSS-120B (check `web/lib/config/cascade.ts` for the real provider/model string this project already uses) with the same system prompt as `getExecutiveDigestSystemPrompt()`, same user message via `buildExecutiveDigestUserMessage()`. This is the draft.
   - **Tier 2**: call GPT-OSS-120B again with a review prompt you construct: give it the tier-1 draft AND the original source markdown, ask it to identify factual gaps, missing key points, or format issues in the draft. This is the review.
   - **Tier 3**: call Haiku 4.5 with the tier-1 draft + tier-2 review notes (NOT the full original markdown), ask it to produce the final digest incorporating the review's corrections. This is the refine pass.
4. Parse the tier-3 output with the real production `parseExecutiveDigest()` function from `executive-digest.ts` — don't write a new parser.
5. Score two ways for each row: **format** (did `parseExecutiveDigest` succeed via `parsedVia: 'headers'`) and **content fidelity** (a separate Haiku-4.5 judge call scoring 0-100 how closely the tier-3 output matches the real historical Haiku-4.5 baseline, on factual coverage and takeaway selection — same judge methodology as the multilingual test).
6. Also record the **real token/cost delta**: sum actual input+output tokens for tiers 1+2+3 combined vs. the real historical single-call Haiku-4.5 cost for the same row, so the report shows whether this pipeline is actually cheaper in practice, not just in theory.

## 3. Goal / definition of done
A real report at `docs/research/2026-08-18-3tier-pipeline-fidelity-test.md`: per-row fidelity scores, per-row real cost comparison (3-tier pipeline vs Haiku-4.5-only baseline), and an explicit verdict on whether the 3-tier pipeline is viable — comparable quality at meaningfully lower cost, or not. Real scores from real API calls against real historical data, not estimates.

## 4. Expected results
- `docs/research/2026-08-18-3tier-pipeline-fidelity-test.md` (new file)
- A short addition to `docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` §6m linking to this result (append, don't rewrite)
- `.memory/AGENT_LEDGER.md` entries per protocol

## 5. Task-specific skills/tools/MCPs
Supabase MCP for the real row query — verify actual column names before assuming. No production code changes — this is a research/test harness task.

## 6. Fixtures
Reuse `/tmp/mling-test/`'s harness pattern (LLM-judge scoring, results JSON) if still present. If gone, build a minimal equivalent and note that in your report.

## 7. The three tenets — ALWAYS
1. State the exact contract (row selection → 3-tier pipeline → real parser → real judge score → real cost delta) before running it.
2. E2E proof: cite actual row IDs, actual API responses, actual token counts, actual scores — not "the pipeline works."
3. Tangent hunt: flag anything in `executive-digest.ts` or the cascade config relevant to this pipeline's viability that you notice along the way.

If real historical rows with the needed shape aren't available, STOP and report that gap rather than fabricating synthetic inputs. Never print any real credential value in your output — confirm presence only.

## 8. Report format — ALWAYS
RCA → Contract → Real per-row results table (fidelity + cost) → Tangents found → Deviations flagged → Skills run → Gates → Files changed.

## 9. Gates
```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
```
(No production code changes expected — if you touch shipped code, run the full gate set from `docs/agent-prompts/TEMPLATE.md`.)
