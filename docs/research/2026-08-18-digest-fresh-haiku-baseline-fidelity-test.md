# Fresh Haiku 4.5 baseline fidelity test — GPT-OSS-120B vs. real Haiku 4.5 (2026-08-18)

## Why this test exists

Earlier tonight's fidelity test (`docs/research/2026-08-17-digest-regeneration-fidelity-test.md`) claimed to compare GPT-OSS-120B against real historical Haiku-4.5 digest baselines. Direct DB verification (`docs/research/2026-08-18-digest-baseline-model-correction.md`) showed this premise was wrong: production digest generation runs on GPT-OSS-120B via `resolveChatCascade()`, and every "baseline" row in that test was itself GPT-OSS-120B-generated. There are no real historical Haiku-4.5 `executive_digest` rows in the database to compare against — Haiku has never generated a digest in production.

This test corrects that by generating **fresh Haiku 4.5 baselines live**, same conditions, same prompt, same rows, for a genuine apples-to-apples comparison.

## Method

1. Queried `analyses` (Supabase Management API, `SUPABASE_ACCESS_TOKEN`) for rows with `dimension_count = 11` and real, non-empty `analysis_markdown` (>500 chars). 14 usable rows recovered with usable content (of 19 candidates scanned; 5 had empty/too-short markdown).
2. Loaded the **live production digest system prompt** directly from the Vault-backed registry (`prompt_definitions` joined to `vault.decrypted_secrets`, key `prompt.executive_digest.system`) — not the hardcoded fallback constant.
3. Built each row's user message with a faithful JS port of the real `buildExecutiveDigestUserMessage()` / `truncateForDigest()` logic (`web/lib/prompts/executive-digest.ts`), applied to the row's real `analysis_markdown`.
4. For each of the 14 rows, called OpenRouter directly (`OPENROUTER_API_KEY`) with the **same system prompt + same user message** against both `anthropic/claude-haiku-4.5` (fresh baseline) and `openai/gpt-oss-120b` (candidate, same conditions this time — not an old historical row generated under a different token budget). `max_tokens=2000`, `temperature=0.3`.
5. Parsed both outputs with a faithful JS port of the real `parseExecutiveDigest()` (header-based tier extraction, same regex set).
6. Scored content fidelity using Haiku 4.5 as an independent judge call (temperature 0), comparing GPT-OSS-120B's `{snapshot, takeaways, overview}` against the **fresh same-row Haiku baseline** — factual coverage and takeaway selection only, explicitly instructed to ignore prose style.

## Per-row results

| Row | ID (short) | Haiku format | GPT-OSS format | Haiku finish | GPT-OSS finish | Fidelity score | Haiku cost | GPT-OSS cost |
|---|---|---|---|---|---|---|---|---|
| 1 | 75870431 | pass | pass | stop | stop | 78 | $0.00901 | $0.00208 |
| 2 | e076b945 | pass | pass | stop | stop | 75 | $0.01189 | $0.00272 |
| 3 | 807e7eac | pass | pass | stop | stop | 85 | $0.01116 | $0.00235 |
| 4 | c866f529 | pass | pass | stop | stop | 82 | $0.00940 | $0.00200 |
| 5 | 0de09824 | pass | pass | stop | stop | 85 | $0.00977 | $0.00262 |
| 6 | 4b9c2cc3 | pass | pass | stop | stop | 78 | $0.00971 | $0.00253 |
| 7 | 35878592 | pass | pass | stop | **length** | 78 | $0.01134 | $0.00304 |
| 8 | 8af9413b | pass | pass | stop | **length** | 78 | $0.01084 | $0.00304 |
| 9 | 2c485f81 | pass | pass | stop | stop | 78 | $0.01096 | $0.00309 |
| 10 | b35c77f7 | pass | pass | stop | **length** | 78 | $0.01047 | $0.00290 |
| 11 | e23c2540 | pass | pass | stop | stop | 78 | $0.01112 | $0.00270 |
| 12 | a60168dd | pass | pass | stop | stop | 75 | $0.01207 | $0.00278 |
| 13 | be046301 | pass | pass | stop | **length** | 78 | $0.01135 | $0.00308 |
| 14 | f3417cdd | pass | pass | stop | **length** | 78 | $0.01288 | $0.00313 |

All 14 rows: **format pass on both models** (headers parsed cleanly, `parsedVia: 'headers'` on every row — the earlier session's format-fragility findings did not reproduce here under fresh, same-conditions generation).

**Real, notable finding**: 5 of 14 GPT-OSS-120B calls (36%, n too small for a rate claim — see caveat below) hit `finish_reason: "length"` at `max_tokens=2000`, meaning the model was truncated mid-generation and still produced a parseable, complete-looking digest by coincidence of where the cut landed relative to the header structure. This is a real token-budget risk worth flagging on its own, independent of the fidelity score — GPT-OSS-120B's completions ran notably longer (up to 2000 completion tokens, several hitting the reasoning-token overhead of an OSS reasoning model) than Haiku's (953–1486 completion tokens, never truncated).

## Fidelity scores

- n = 14, scores range 75–85, mean 78.9.
- Judge reasoning consistently found GPT-OSS-120B covering the *core* facts/takeaways from the fresh Haiku baseline, with recurring minor-omission or metric-conflation notes (e.g. row 2: "conflates credit counts with video counts").

## Statistical framing (honest)

Using a pass/fail threshold of fidelity score ≥70 ("acceptable, minor gaps" band, consistent with the project's existing PR confidence tiering):

- **14 of 14 rows passed** (100%).
- Wilson 95% confidence interval on that pass rate: **[78.5%, 100%]**.
- n=14 clears the ≥10 threshold the user asked for, so this Wilson interval is a legitimate population-level estimate — not a single-trial anecdote. But note the interval is still wide (78.5–100%) precisely because n=14 is small; it should not be read as "GPT-OSS-120B passes 100% of the time" — read it as "the true pass rate is plausibly anywhere from ~79% to 100% given this sample."
- The mean fidelity score (78.9) is a point estimate over 14 independent rows, not 5-6 — this is the rigor the user asked for after tonight's earlier "20% failure rate from 1-in-5" methodology error. It is still a modest sample for score-level (not just pass/fail) precision; no confidence interval is reported on the mean score itself since Wilson applies to binomial proportions, not continuous scores.

## Real cost comparison (this run)

| | Haiku 4.5 (fresh baseline) | GPT-OSS-120B (same conditions) |
|---|---|---|
| Total cost, 14 rows | $0.15196 | $0.03805 |
| Total tokens, 14 rows | 85,364 | 83,118 |
| Avg cost/row | $0.01085 | $0.00272 |
| Cost ratio | 1.00x | **0.25x** (Haiku costs 3.99x more than GPT-OSS-120B) |

Judge-call cost (Haiku 4.5 as judge, 14 calls): $0.03432 — a real, separate cost not attributable to either candidate, reported for completeness.

**This directly contradicts the earlier session's "47% more expensive" framing of GPT-OSS-120B vs. Haiku** — that claim had no real Haiku baseline to compare against (per the correction doc) and cannot be trusted as a real cost comparison. This run's real, fresh, same-conditions numbers show the opposite direction and magnitude: GPT-OSS-120B is **~4x cheaper** than Haiku 4.5 for the same digest task, while producing digests judged 75–85/100 on content fidelity against Haiku's own fresh output.

## Verdict

- **Real n = 14** rows, real fresh Haiku 4.5 baselines generated live for this test (not historical, not assumed).
- **Real fidelity finding**: GPT-OSS-120B's digest output tracks a fresh same-row Haiku 4.5 baseline at 75–85/100 content fidelity (mean 78.9), with 14/14 rows above the 70-point "acceptable" threshold — Wilson 95% CI [78.5%, 100%].
- **Real cost finding**: GPT-OSS-120B is ~4x cheaper than Haiku 4.5 for this exact task under identical prompts/conditions — the opposite of and much larger than the earlier session's unverified "47% more expensive" claim.
- **Real risk finding, independent of fidelity**: GPT-OSS-120B truncated (`finish_reason: length`) on 5/14 calls at the current `max_tokens: 2000` digest budget; Haiku never did. This is a real token-budget headroom gap worth a follow-up (raising `max_tokens` for the GPT-OSS-120B cascade entry, or confirming the current headroom is safe) even though it did not visibly break parsing in this sample.
- No fabricated data; the 5-row gap between the 19 candidate rows scanned and the 14 used is explained (empty/too-short `analysis_markdown`), not hidden.
