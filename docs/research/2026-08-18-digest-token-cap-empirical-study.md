# Empirical study: `digest.maxOutputTokens` (2026-08-18)

## Why this exists

`digest.maxOutputTokens` was set to 6000 last night (migration `20260818000000_digest_max_output_tokens.sql`) as a fix for real truncation (`finish_reason: "length"` on 5/14 rows at the then-current 2000-token cap). The user rejected 6000 as an arbitrary padded guess — it was derived from only 4 *censored/truncated* samples (we saw they hit the cap, not what they actually needed), not real completion-token data. This report replaces it with a real empirical derivation per AGENTS.md §5.0.3 item 6 ("no setting without empirical backing").

## Data source check

Checked whether real completion-token counts are stored anywhere in the DB for historical rows: `executive_digest` JSONB has no `usage` field on any of the 88 rows checked (`usage_type` = `null` for all). Historical completion-token counts are **not recoverable from stored data** — they must be derived by regeneration.

`executive_digest->>'model'` confirms all 88 real historical digest rows in `analyses` (non-null `executive_digest`, non-empty `analysis_markdown`) are `openai/gpt-oss-120b` — matches the production model per the digest cascade RCA (`docs/research/2026-08-18-digest-cascade-and-input-source-rca.md`). No Haiku-generated digests exist in production history, so this study is single-model (GPT-OSS-120B), which is correct — that's the model the cap actually governs.

## Method

1. Pulled all 88 real rows (id, `length(analysis_markdown)`) via Supabase Management API (`SUPABASE_ACCESS_TOKEN`, `set -a; source .env.local; set +a`). Real input size (the assembled 11-dimension markdown that `buildExecutiveDigestUserMessage()`/`truncateForDigest()` in `web/lib/prompts/executive-digest.ts` feeds to the model) ranges **3,932 to 62,044 characters**.
2. Stratified-sampled **24 of the 88** evenly across that full real range (not a random or convenience sample — picked at even percentile intervals so the low, mid, and high ends of real input size are all represented).
3. Pulled each row's full `analysis_markdown` + loaded the **live production system prompt** from Vault (`prompt_definitions` joined `vault.decrypted_secrets`, key `prompt.executive_digest.system`).
4. Built each row's user message with a verbatim port of the real `truncateForDigest()`/`buildExecutiveDigestUserMessage()` logic.
5. Regenerated each digest fresh via OpenRouter (`openai/gpt-oss-120b`, Cerebras provider, `temperature: 0.3`) at an **uncapped `max_tokens: 8000`** — deliberately far above any plausible real need, specifically so the true completion-token count could be observed **without truncation censoring** (last night's 6000 estimate was built from truncated samples, i.e. we never actually saw what those rows needed).
6. Recorded real `usage.completion_tokens` and `finish_reason` per row from the raw OpenRouter response.

## Results (n=24, real data)

| Row ID | Input size (chars) | Completion tokens | Finish reason |
|---|---|---|---|
| 1bdfa12b | 3,932 | 1930 | stop |
| 17a8fe35 | 8,563 | 1008 | stop |
| 0de7e5df | 15,056 | 1566 | stop |
| 25aee412 | 20,739 | 1984 | stop |
| 38de9fe0 | 24,853 | 2056 | stop |
| 70eda19f | 27,592 | 861 | stop |
| c8fdd013 | 28,761 | 1239 | stop |
| 114e7c1a | 30,885 | 1959 | stop |
| 47cf53d3 | 32,641 | 1178 | stop |
| 6c94bd75 | 33,795 | 1469 | stop |
| b35c77f7 | 34,461 | 1082 | stop |
| 20391afe | 35,139 | 2089 | stop |
| 945201a6 | 36,697 | 981 | stop |
| 798873e2 | 37,958 | 1928 | stop |
| 4faa7077 | 39,137 | 1694 | stop |
| d9bf5b2f | 39,858 | 949 | stop |
| eda009ae | 41,743 | 2354 | stop |
| e30c9991 | 42,061 | 1467 | stop |
| 781cb5e6 | 42,948 | 1925 | stop |
| 6591b52a | 44,152 | 1032 | stop |
| 8accb13b | 45,193 | 1414 | stop |
| 56e4fed4 | 46,802 | 1760 | stop |
| ced0c984 | 48,102 | 1127 | stop |
| 73d5e3b8 | 62,044 | 2471 | stop |

**All 24/24 rows finished with `finish_reason: stop`** — zero truncation at `max_tokens: 8000`, confirming these are real completed generations, not more censored data.

- **min = 861, max = 2471, mean = 1563.5, median = 1517.5, population stdev ≈ 469**

## Relationship: input size vs. output tokens

Pearson correlation between `analysis_markdown` length (chars) and `completion_tokens`: **r = 0.13** — a weak, near-negligible positive correlation. The lowest-input row (3,932 chars) produced 1930 tokens; several 40,000+ char rows produced under 1000 tokens. Output size is **not meaningfully driven by input size**.

This is honestly the expected shape given how the digest is structured: it always renders the same ~4 fixed sections (snapshot / overview / takeaways / detailed summary), so its length is governed by how much the model chooses to say per section, not by how much source material it's digesting. The data supports a **flat ceiling**, not a per-input scaling formula — imposing a formula here would not be honest to what the data shows.

## Derivation

- Empirical max observed (n=24, real, uncensored): **2471 tokens** (row `73d5e3b8`, also the single largest-input row in the sample at 62,044 chars — plausibly not coincidental, though r=0.13 says this isn't a reliable predictor in general).
- Apply 15–20% margin per the user's methodology. Chose **18%**: 2471 × 1.18 = 2916.28.
- Rounded to a clean value: **3000**.

## What changed

`digest.maxOutputTokens` **updated from 6000 to 3000** (migration `supabase/migrations/20260818070107_digest_max_output_tokens_empirical.sql`, following ADR 018's apply-then-register discipline: applied live via `/database/migrations` POST — server assigned version `20260818070107` — then the local file was named to match exactly, and `list_migrations` confirms it registered correctly at position 138/138). 6000 did **not** fall within the empirically-justified range (2471–2916) — it was roughly 2x higher than needed, itself a real (if less severe) form of the "no setting without empirical backing" problem the user flagged, so it was replaced rather than kept.

The Settings Registry `setting_definitions.description` for the key now carries the full derivation inline (data source, n=24, date, formula), per the traceability requirement.

## Honesty notes / limits

- n=24 of 88 available rows — a genuine stratified sample across the real input range, not the full population. A larger run (e.g. all 88) would tighten the confidence on the true max but was not run this session; 24 is adequate to establish the flat-ceiling shape and a defensible max+margin, not to claim an unbreakable ceiling.
- This is real digest content regenerated fresh under production-identical prompt/input construction — not simulated or word-count-estimated. No tokenizer estimation was needed since real `usage.completion_tokens` was available directly from the OpenRouter response.
- A theoretical single future row could still exceed 2471 tokens (this is an empirical, not analytic, bound) — the 18% margin is the buffer against that, not a guarantee. If real production truncation is observed again post-deploy, that would be new evidence to re-run this study, not an argument to blindly re-inflate the cap.
