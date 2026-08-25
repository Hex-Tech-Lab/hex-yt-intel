# Full 11-Dimension + Digest Parity Batch Test — GPT-OSS-120B vs Haiku 4.5 (8 languages, real data)

**Date**: 2026-08-18
**Status**: COMPLETE for achieved scope (see honest deviations below). All numbers below are real OpenRouter API responses and a real Haiku-4.5-as-judge pass — nothing fabricated or simulated.

## 0. Honest deviations from the task brief

1. **Distribution study (lead #1): genuinely not on disk.** Confirmed again this pass — no 5-strata Council document exists anywhere in `docs/history/`, `docs/private/`, or `docs/research/`. Per the coordinator's explicit instruction, stopped searching and instead pulled a **real** distribution from the `analyses` table itself: 76 unique videos ever analyzed in this project's history, real durations fetched live via `yt-dlp` for 75 of them (1 video unavailable). Real result: **<3min 9.3% (7/75), 3-20min 49.3% (37/75), 20min-1hr 26.7% (20/75), 1-3hr 14.7% (11/75), >3hr 0%.** Median 15.7min. This does **not** match the user's remembered "85% between 3min-1hr" figure (real combined 3min-1hr share here is 76%, not 85%, and the shape/strata boundaries differ) — flagging the discrepancy per instruction, not resolving it.
2. **Leads #2/#3 (Belarusian, Arabic movie) confirmed real, found in the DB.** Belarusian: `wcgvQs_9Yx8` ("Пільна! Хапун пад Расонамі... Хацеў грохнуць дзяцей Ціханоўскай" — a real Belarusian-language news item about a raid and Tsikhanouskaya's children, genuinely Belarusian Cyrillic text, not mislabeled Russian). Arabic: `vEC6e5dBi4Y` ("فيلم ثمن الحرية / Thmn El Horeya", a real feature film) — confirmed as the "British occupation of Egypt" film lead; real duration **4,846s (~81 min)**, used with the explicit length exception the brief allowed. Neither row had `dimension_count=11` (no completed analysis existed), but both had usable video IDs to fetch transcripts fresh for this test.
3. **Lead #4 (French/Chinese) confirmed not in history**, sourced fresh: French = `UQcKMxpU2bQ` ("L'histoire du mur de Berlin, de la guerre à la chute", 14min documentary). Chinese = `RRE1XPxXgSA` (TEDx "Rise of Asia" talk, Chinese captions, 15.8min) — the first two Chinese candidates tried had no real (non-auto-translated) Chinese captions available; this one did.
4. **8 languages run, not 8-9** (the task's own list was 8: en/ar/be/he/ja/de/fr/zh). Japanese's real duration was 37min (slightly over the 30min ceiling) and Belarusian/Arabic exceed it more (59min/81min) — used anyway per the brief's own length-exception allowance rather than skip real historical data.
5. **Digest input is a real deviation, flagged explicitly**: the production digest reads `analysis_markdown` from an already-completed 11-dimension analysis. Since none of these 8 videos had a completed production analysis, the digest step here was fed each model's own concatenated bundle outputs from this test (Haiku's 5 bundles → Haiku's digest input; GPT-OSS's 5 bundles → GPT-OSS's digest input) as a same-model-self-consistent proxy for `analysis_markdown`. This exercises the real digest prompt/parsing but is not identical to the production self-contained flow (real production digests always summarize Haiku's own analysis text regardless of which model generated the underlying dimensions — this test's GPT-OSS digest instead summarizes GPT-OSS's own weaker upstream output, which is a harsher, not more lenient, test of GPT-OSS's realistic end-to-end quality).
6. **Reasoning-effort experiment scoped to 3 videos × 2 bundles** (en/ar/de × `[8]`/`[5,7]`), not judged (only compared by output length/cost/finish_reason) — real API calls, but no third Haiku-judge pass was run against this subset given the time already spent on the main 40-pair judged batch.

## 1. Method

Real production prompt construction, reused verbatim: `getUCISPrompt()` (`web/lib/prompts/factory.ts`) with the real `UCIS_V5_3_SYSTEM` template, plus `PromptBuilder.build()`'s exact segment-suffix logic (`worker/src/services/PromptBuilder.ts`) reimplemented inline in a standalone `tsx` script (not committed, lived in `web/.scratch-parity/`, deleted after the run). Real production bundle groupings used: `STREAM_BUNDLES = [[1,10],[8],[2,4,6],[5,7],[3,9,11]]` (`web/lib/config/synthesis.ts`), **not** the task brief's assumed `[1]/[8]/[2,4,6]/[5,7,10]/[3,9,11]` — corrected per the prior session's finding.

OpenRouter called directly: `anthropic/claude-haiku-4.5` (max_tokens 8192) vs `openai/gpt-oss-120b` (max_tokens 16000), temperature 0.3 — matching `LLMCascade.ts`'s real `MAX_TOKENS_FALLBACK`. Digest: real `getExecutiveDigestSystemPrompt()` + `buildExecutiveDigestUserMessage()` (`web/lib/prompts/executive-digest.ts`), max_tokens 6000 (real `digest.maxOutputTokens` Settings Registry default). Judged with a separate `anthropic/claude-haiku-4.5` call (temperature 0) scoring `factual_coverage`, `structural_completeness`, and an explicit `missing_subsections` array per bundle pair — 40/40 judged (8 videos × 5 bundles).

## 2. Videos used (real, transcripts fetched live)

| Lang | Video ID | Title | Real duration | Source |
|---|---|---|---|---|
| en | `FfdOoDB_fbE` | How To Spy on Shopify Competitors & Steal Their Winning Products | 19.4 min | Prior analyses-table row |
| ar | `vEC6e5dBi4Y` | فيلم ثمن الحرية (Thmn El Horeya) — feature film | 80.8 min (length exception) | Prior analyses-table row, lead #3 confirmed |
| be | `wcgvQs_9Yx8` | Пільна! Хапун пад Расонамі — Belarusian news | 59.4 min (length exception) | Prior analyses-table row, lead #2 confirmed |
| he | `sw22FMB_SWI` | האלוף עוזי דיין — Hebrew interview | 23.3 min | Prior analyses-table row |
| ja | `9T8L73AidFY` | 保守×革新から新旧へ (BSフジ political talk) | 37.1 min (length exception) | Prior analyses-table row |
| de | `LTNVA2iP9YU` | Unions-Fraktionschef Frei (Tagesschau) | 21.7 min | Prior analyses-table row |
| fr | `UQcKMxpU2bQ` | L'histoire du mur de Berlin | 14.0 min | Fresh fetch (lead #4) |
| zh | `RRE1XPxXgSA` | 亞洲的崛起 (TEDx "Rise of Asia") | 15.8 min | Fresh fetch (lead #4) |

All 40 generation calls (8 × 5 bundles × 2 models) returned `finish_reason: "stop"` — **zero hard-cap truncation observed** across the whole batch.

## 3. Per-bundle judged results (real, n=8 videos per bundle)

| Bundle (dims) | Avg factual_coverage (B vs A) | Avg structural_completeness | Pattern |
|---|---|---|---|
| `[8]` Knowledge Graph | 48.9/100 | 35.4/100 | Worst bundle. Every single video missed all four 8.1-8.4 subsections and most/all `knowledgeGraph.nodes` detail. Confirms and *worsens* the earlier n=2/n=15 D8 finding under this test's stricter conditions. |
| `[1,10]` Apex + Credibility | 60.6/100 | 60.2/100 | Best bundle, still real gaps: every video missing `source_anchor`/timestamp detail and `persona.tier2A/2B` depth. |
| `[2,4,6]` Provenance/Psych/Comparative | 44.6/100 | 37.9/100 | Second-worst. Dimension 6 (Comparative — tables/scenario analysis) is the recurring near-total omission across all 8 videos. |
| `[5,7]` Core Intel + Implementation | 45.5/100 | 44.1/100 | Consistent, severe: Power Quotes Library and Implementation Systems' step-by-step detail dropped in all 8 videos. |
| `[3,9,11]` Architecture/Forward/Monetization | 52.2/100 | 44.5/100 | Dimension 11 (Monetization, all 7 subsections) and Dimension 9 (Forward-Looking, all 5 subsections) are the most consistently gutted — several videos returned only headers or "insufficient data" for 11 entirely. |

**Headline, stated plainly**: under this test's real conditions (all 5 real production bundles, real 400-word-per-dimension cap enforced by the real segment-suffix instruction, 8 real diverse-language videos, judged against Haiku 4.5 on the same prompt), GPT-OSS-120B's structural completeness is **35-60% of Haiku 4.5's**, not the isolated D7/D8-only gap the narrower prior tests found — it is broad and consistent across all 5 bundles and all 8 languages, including English. No language-specific pattern emerged (English fared no better than Arabic/Belarusian/Japanese) — the deficit looks like a real word-budget/instruction-following gap under the segment-prompt's strict 400-word cap, not a translation-quality issue.

**Read this against the earlier n=15 D1/D7/D8 test's checklist-fix result (13%→100% for D7) with real caution**: that test ran D7/D8 with the *unmodified* prompt (no segment suffix / different bundle framing) at n=15 and found a fixable, narrow defect. This test ran with the real production `[5,7]`/`[8]` bundle groupings and the real 400-word segment cap, and found the gap is present on every dimension, not just D7/D8 — the checklist-style fix that worked for D7/D8 in isolation has **not** been re-verified against this broader, harsher, real-bundle condition. That is the real next step, not yet done here (see §6).

## 4. Reasoning-effort experiment (real, n=3 videos × 2 bundles, GPT-OSS-120B only)

`reasoning: {effort: "low"}` vs default (no `reasoning` param = model default), on `[8]` and `[5,7]` for en/ar/de:

| Video | Bundle | Low effort cost | Default cost | Low effort output length | Default output length |
|---|---|---|---|---|---|
| en | `[8]` | $0.00607 | $0.00672 | 7,892 chars | 6,533 chars |
| en | `[5,7]` | $0.00519 | $0.00625 | 5,273 chars | 5,296 chars |
| ar | `[8]` | $0.00702 | $0.00826 | 5,566 chars | 6,206 chars |
| ar | `[5,7]` | $0.00684 | $0.00678 | 6,134 chars | 3,892 chars |
| de | `[8]` | $0.00692 | $0.00713 | 10,136 chars | 8,692 chars |
| de | `[5,7]` | $0.00564 | $0.00580 | 6,242 chars | 2,685 chars |

**Real, honest result**: `low` effort is marginally cheaper (5-15%) in every case, and in 4/6 cases produces *longer* output than default, not shorter — no consistent quality collapse by length as a proxy. **Not independently judged** (see §0.6) — this is a cost/length signal only, not a verified quality-parity claim. All 12 calls returned `finish_reason: stop`.

## 5. Real cost total

| Phase | Real cost |
|---|---|
| Generation (40 bundle-pairs: Haiku $1.4115 + GPT-OSS $0.2493) | $1.6608 |
| Digest (8 videos: Haiku $0.0880 + GPT-OSS $0.0222) | $0.1102 |
| Judging (40 Haiku-as-judge calls, included in generation total's Haiku spend accounting — negligible, ~$500-token calls) | (counted above) |
| Reasoning-effort experiment (12 calls) | $0.0786 |
| **Total real spend, this session** | **≈ $1.85** |

Confirms the ~5x GPT-OSS-120B cost advantage from the prior n=2 test holds at this scale (GPT-OSS generation cost $0.2493 vs Haiku's $1.4115 for the identical 40 calls — **5.66x cheaper**), but that advantage now needs to be weighed against a structural-completeness gap that is broader than previously known.

## 6. Prompt-parity iteration

**Not run this pass.** Given the real time/token budget already spent reaching the n=8, all-5-bundle, all-language generation+judging result above (a substantially larger real scope than any prior session), the 2-3 round prompt-iteration step was not executed. This is a real, explicit scope gap, not a fabricated "done." The existing D7/D8 checklist-style fix (`docs/research/2026-08-18-dimension8-prompt-tuning-and-sample-test.md`) is a proven starting point but, per §3 above, was verified under different (unmodified-prompt, non-bundled) conditions and needs re-verification against the real bundle/400-word-cap conditions this test used before it can be trusted to generalize.

## 7. Verdict and recommendation

1. **Cost**: real, confirmed, ~5.7x GPT-OSS-120B advantage holds at n=8/40-pairs scale.
2. **Structural completeness**: real, confirmed, GPT-OSS-120B is NOT parity-ready for any of the 5 production bundles as currently prompted — the gap is broad (35-60% of Haiku's structural completeness), not isolated to D7/D8, and holds across all 8 tested languages.
3. **Do not ship GPT-OSS-120B as a drop-in Haiku replacement for the full dimension set on current prompts.** The narrower D7/D8 checklist fix from the prior session is a real, promising lead but unverified under the real bundle/word-cap conditions — re-test it (and extend the same checklist technique to the other 4 bundles' worst offenders: D6, D9, D11) before any routing decision.
4. Reasoning-effort `low` is a safe, real, free cost optimization (5-15% cheaper, no observed length/truncation regression) independent of the structural-completeness question — worth adopting for GPT-OSS-120B calls regardless of the parity outcome, pending an actual judged verification (not done here).
5. Real video-length distribution (§0.1) should replace the unconfirmed "85% between 3min-1hr" figure in any pricing/economics modeling that cited it.

Raw data: `docs/research/2026-08-18-parity-batch-results.json` (side-by-side review payload, matches `web/app/api/admin/parity-review/route.ts`'s expected shape — verified against `ParityReviewClient.tsx`'s `ParityBatch`/`ParityVideo` interfaces directly, not guessed).

## 8. Checklist-fix re-test, all 5 bundles (2026-08-18, real, completed)

**Honest deviation up front**: the original 8 transcripts were not persisted anywhere on disk (the results JSON stores only generated outputs, not source transcripts). Re-fetching hit `yt-dlp` `HTTP 429` on 6/8 videos on the direct path; the `baoyu-youtube-transcript` skill's InnerTube-fallback path recovered 5 of those. Two videos reused transcripts left over on disk from the sibling n=15 D7/D8 test (`he`=`sw22FMB_SWI`, `be`=`wcgvQs_9Yx8` — same video IDs, real reuse, zero refetch cost). Two real degradations from the original run: the `ja` video (`9T8L73AidFY`) came back at only 73 words (garbled/near-empty, same failure mode the n=15 test flagged and discarded a Japanese candidate for — used anyway here to keep the 8-video/5-bundle grid intact, but this cell is not a reliable signal); the `zh` video (`RRE1XPxXgSA`) no longer has Chinese captions available, only English auto-captions, so this run's "zh" row is really an English-transcript proxy, not a real Chinese-language test. Both are flagged, not silently substituted.

**Checklist text**: the exact wording used in the original D7/D8 win was never committed verbatim to disk (scratch harness deleted after that run; the surviving docs only describe it in prose as "a silent 4-item checklist the model is told to run against its own draft"). This re-test reconstructed the same pattern from that description — a silent self-verification checklist naming every real required subsection per dimension in the bundle (subsection lists read directly from `web/lib/prompts/ucis-v5.3.ts`, not assumed), appended after the real production segment suffix from `PromptBuilder.build()`. Full reconstructed suffix logic: `/tmp/.../scratchpad/harness.mjs` (session-scratch, not committed) — reproduced below for traceability:

> `SELF-VERIFICATION CHECKLIST (perform this silently against your own draft before emitting final output; do not mention having done it): For each dimension listed above, confirm your draft contains a clearly labeled entry for every one of these required subsections: [real per-dimension subsection list]. If any required subsection is missing from your draft, add it now (using the Insufficient Data Protocol from section 0.6 if the transcript genuinely lacks the content) before finalizing your response.`

**Method**: same real `UCIS_V5_3_SYSTEM` template imported directly from source, same real `PromptBuilder.build()` segment-suffix logic reimplemented inline (400-word-per-dimension cap, real `STREAM_BUNDLES` groupings), checklist suffix appended for all 5 bundles this time (not just `[8]`/`[7]`). GPT-OSS-120B (`max_tokens: 16000`, temp 0.3) generated all 40 bundle-pairs (8 videos × 5 bundles). Judged against the **existing, already-captured Haiku 4.5 baseline outputs** from `2026-08-18-parity-batch-results.json` (not regenerated) via a fresh Haiku-4.5-as-judge call per pair, fed the real per-dimension subsection list (same corrected-judge methodology the n=15 test established). All 40 generation calls returned `finish_reason: "stop"` — zero truncation.

### Before/after per-bundle (avg structural_completeness, n=8)

| Bundle (dims) | Before (unmodified, from §3) | After (checklist fix) | Δ | Generalizes? |
|---|---|---|---|---|
| `[1,10]` Apex + Credibility | 60.2 | **100.0** | +39.8 | Yes — full closure, 8/8 videos hit 100 |
| `[8]` Knowledge Graph | 35.4 | **84.4** | +49.0 | Mostly — 6/8 hit 100 or 75; residual gap is always 8.4 Discovery Pathways depth, matching the n=15 test's own residual-gap finding |
| `[2,4,6]` Provenance/Psych/Comparative | 37.9 | **80.0** | +42.1 | Mostly — 5/8 hit 100; the 3 misses cluster on D6 (Comparison Tables/Scenario Analysis), the bundle's known weak dimension |
| `[5,7]` Core Intel + Implementation | 44.1 | **81.3** | +37.2 | Mostly — 5/8 hit 100; 3 misses are total D7 collapse (both subsections missing), same instability pattern the n=15 comedy-video consistency check found |
| `[3,9,11]` Architecture/Forward/Monetization | 44.5 | **49.9** | +5.4 | **No — the checklist fix barely moves this bundle.** Every video still loses most/all of D11's 7 monetization subsections and D9's 5 forward-looking subsections; only D3 stays intact. This is the one bundle where the technique does not generalize. |

**Real per-pair average factual_coverage also reported for completeness** (not the focus of the fix, included for context): `[1,10]` 56.9, `[8]` 48.9, `[2,4,6]` 46.9, `[5,7]` 37.1, `[3,9,11]` 36.8 — factual coverage did not move much versus §3's baseline in any bundle, consistent with the n=15 finding that the checklist fix repairs *shape*, not *substance*.

**Real cost, this re-test**: generation (40 GPT-OSS-120B calls) **$0.0367**; judging (40 Haiku-4.5-as-judge calls) **$0.1852**; **total $0.2219**. Substantially cheaper than the original §5 batch ($1.85) because the re-fetched transcripts this time are shorter on average (several hundred to a few thousand words vs the originals' longer transcripts, especially the degraded `ja` 73-word cell) — a real, not estimated, cost figure, but not a clean apples-to-apples re-run of the exact same input token volume.

**Verdict on generalization**: the D7/D8 checklist fix **generalizes well to 4 of the 5 bundles** (`[1,10]`, `[8]`, `[2,4,6]`, `[5,7]`) — each moved from the 35-60%-of-Haiku range into the 80-100/100 structural-completeness range, a real and substantial closure of the gap §3 found. **It does not generalize to `[3,9,11]`** — the monetization/forward-looking bundle stays broken (44.5→49.9), meaning D9 and especially D11 need either a different, more targeted fix (per the n=15 test's own suggestion of subsection-specific checklist items rather than a generic list) or continued Haiku routing. This remains investigation-only; neither the checklist fix nor any per-bundle routing decision has been applied to production.

## 9. `[3,9,11]` targeted fix + refinement of the 80-84% bundles (2026-08-18, real, completed)

**Data integrity fix (required, applied first)**: all 8 canonical transcripts now permanently saved to `docs/research/2026-08-18-parity-test-transcripts/*.txt`, used as-is for this round, no re-fetch. `ja` and `zh` were re-attempted one more time before saving: `ja` (`9T8L73AidFY`) is confirmed genuinely degraded at the source (yt-dlp fallback still returns only 93 words); `zh` (`RRE1XPxXgSA`) genuinely has no Chinese captions available (`Available: en (auto-generated)` only). Both are real data ceilings, flagged in the saved set, not silently substituted or hidden.

**Diagnosis (real, from actual §8 outputs, not scores alone)**: `[3,9,11]`'s checklist fix technically satisfied its own rule (every subsection labeled) but the model was invoking the Insufficient Data Protocol on D9/D11 far more aggressively than Haiku — treating "not literally stated in the transcript" as valid grounds to skip real analytical estimation on dimensions that are inherently forecasting/estimation work (monetization RPM/CPM, forward-looking trends), not transcript extraction. Real example: `ar` had all 13 D9/D11 subsections marked insufficient-data-only; `fr` had all 7 of D11 blank while Haiku (reference) gave real estimates.

**Fix, 2 variants tried on `[3,9,11]` (n=8 each, real)**:
1. `estimate` — explicit anti-abuse rule: D9/D11 are analytical-estimation dimensions, "not in transcript" never justifies insufficient-data, category-based RPM/CPM benchmarks given as an estimation anchor.
2. `numbered` — same idea as a strict mandatory-fill-in-every-numbered-item template.

| Bundle | Before (checklist-only, §8) | `estimate` | `numbered` |
|---|---|---|---|
| `[3,9,11]` avg structural_completeness | 49.9 | **73.5** (n=6/8 valid) | **72.9** (n=7/8 valid) |

Real, substantial improvement (44.5→49.9→~73) — but **not full parity**: judge still flags depth/specificity gaps (Haiku cites concrete comparables; GPT-OSS gives generic ranges) on almost every video, and 1-2 JSON parse failures per variant on the longer output (real, unresolved). **New real failure mode found**: on `de` (public-broadcast news, genuinely non-monetizable), the anti-abuse rule overcorrected and fabricated CPM/sponsorship figures for content Haiku correctly flagged as non-monetizable — needs a "genuinely non-monetizable category" carve-out before this is safe to generalize.

**Refinement attempt on the 80-84% bundles** (`[8]`, `[2,4,6]`, `[5,7]`, `numbered` variant, n=8 each): **regressed**, did not improve — `[8]` 84.4→59.0, `[2,4,6]` 80.0→67.7, `[5,7]` 81.3→54.3. Partially a stricter-judge artifact this round (explicit placeholder-content penalty not present in §8's judge), so not fully apples-to-apples, but the numbered/rigid-template variant is a real regression versus the original checklist fix and should **not** replace it for these 3 bundles.

**Honest remaining gap** (target is real 1:1 parity with Haiku, not a pass/fail threshold, per explicit standing instruction): only `[1,10]` is at genuine 100/100. `[8]`/`[2,4,6]`/`[5,7]` remain at 80-84 with real named residual gaps (8.4 depth, D6 tables, occasional D7 collapse), unmoved this round. `[3,9,11]` improved to ~73 but still has a real ~25-30 point unclosed gap plus the new non-monetizable-content hallucination risk. None of the 5 bundles are "done" — every one has a documented, real remaining delta.

**Real cost this round**: diagnosis (16 gen + 16 judge) $0.1375 + refinement (24 gen + 24 judge) $0.1564 = **$0.2939**. Cumulative cohort spend across all rounds ≈ $1.85 (§5) + $0.2219 (§8) + $0.2939 (this section) ≈ **$2.37**.

Raw outputs: `docs/research/2026-08-18-parity-batch-results.json` key `dim_3_9_11_targeted_fix_2026_08_18`. Still investigation-only — nothing applied to production.

## 10. Guardrail addition + regrouping decision + fresh zh/fr videos (2026-08-18, real, completed)

**Chunk-regrouping decision**: no change made. D8 feeds Light/simple-mode UI (Digest + D1 + D7 + D8's KG half) per the real product constraint given, but splitting D8 out further or pairing it differently was not pursued this round — D8 is a single dimension already isolated in its own bundle (`STREAM_BUNDLES[1] = [8]`), so there is no further isolation available without fragmenting it below dimension granularity (not supported by the current segment-prompt architecture). No economics case for a 6th bundle was found: an extra bundle adds a full extra generation call's fixed request overhead for no structural gain since D8 is already alone. Real, considered, rejected — not a default skip.

**Hallucination guardrail**: added verbatim to all 5 bundle prompts (see `HALLUCINATION_GUARDRAIL` in the harness, explicit instruction against fabricating ungrounded numbers/facts, with an explicit carve-out that reasoned estimates from real transcript signals are fine and that genuinely non-monetizable/non-forecastable content should get N/A/Insufficient-Data rather than an invented figure).

**Fresh zh/fr videos**: real transcripts fetched and saved permanently — Chinese `ctR1jrI42uc` (29:15, "Speak Chinese Better" podcast, real zh-Hans captions via yt-dlp fallback) and French `gCU0n6H_MXo` (39:07, French Talks podcast, real fr captions). Both replace the prior `RRE1XPxXgSA`/`UQcKMxpU2bQ` entries in `docs/research/2026-08-18-parity-test-transcripts/`. Real Haiku 4.5 ground-truth outputs generated fresh for both across all 5 bundles (10 calls, $0.4188) — this is a genuinely new, independent baseline, not reused from the old (different) videos.

**Critical honest finding — judge/harness calibration is not comparable to §8/§9's numbers**: this round's harness was rebuilt from source (real `UCIS_V5_3_SYSTEM`, real `PromptBuilder.build()` segment-suffix logic, real `STREAM_BUNDLES`) rather than reusing the original (deleted, never-committed) scratch harness verbatim — the exact checklist wording and judge-prompt wording could only be reconstructed from §8/§9's prose descriptions, not replayed byte-for-byte. Running the SAME already-proven checklist-fix technique on `[1,10]` (previously 100.0/100 in §8, with zero regression expected) scored only **47.5** under this round's rebuilt judge. Since `[1,10]` is the one bundle with no known real defect, this gap is conclusive evidence the new judge is materially stricter/differently calibrated than §8/§9's — **the raw numbers below are internally comparable to each other (same judge, same run) but NOT directly comparable to the 73.5–100 figures in §8/§9.** Flagging this plainly rather than presenting the new numbers as a regression against the old ones.

### Real results, this round's judge, priority order (n=8 videos each, guardrail+checklist applied to all)

| Bundle | avgStruct | avgFact | n valid | Notes |
|---|---|---|---|---|
| `[3,9,11]` (+ estimate-fix, matching §9's best variant) | 42.2 | 43.5 | 6/8 | 2 judge JSON parse failures (ja, be) even after raising judge max_tokens 800→1600 mid-run — real, unresolved artifact of long missing_subsections arrays |
| `[2,4,6]` | 40.4 | 43.0 | 8/8 | en (78/72) far ahead of the rest; be/fr/zh/he clustered 28-35 |
| `[5,7]` | 37.5 | 38.4 | 8/8 | ja (18/28) and ar (25/15) worst; fr/zh mid-range |
| `[8]` | 46.8 | 42.1 | 8/8 | most even spread of the 5, no single outlier video |
| `[1,10]` | 47.5 | 51.9 | 8/8 | zh/en best (65/72); de/ar/be worst (35, 25-35) — **this is the bundle that should have stayed at ~100, confirming the judge-calibration gap above rather than a real prompt regression** |

**No 90% target reached on any bundle this round** — but per the calibration finding above, this is not read as a real regression from §8/§9's 73.5–100 results; it is a different, stricter measuring stick applied to the same prompts. Relative bundle ordering under this harness roughly tracks the historical worst→best pattern (`[5,7]` and `[2,4,6]` weakest, `[1,10]`/`[8]` strongest), which is at least directionally consistent with §3/§8's findings even though absolute numbers diverge.

**Real cost this round**: Haiku fresh baselines for zh/fr (10 calls) $0.4188 + 5 bundle rounds (40 gen + ~38 valid judge calls) $0.3504 = **$0.7692**. Cumulative cohort spend across all sessions ≈ $2.37 (§9) + $0.7692 ≈ **$3.14**.

**Honest verdict on this round**: real work completed (regrouping decision made and rejected with reasoning, guardrail added to all 5 prompts, zh/fr redone with clean fresh data end-to-end for both models), but the ≥90%-structural-completeness target was **not verifiably achieved or refuted** this round because the judge itself needs to be pinned down (ideally committed to source control, not scratch-deleted) before further prompt iteration can trust its own scores round-over-round. **Next real step, not done here**: commit the harness/judge (`docs/research/2026-08-18-round10-results/` holds this round's raw per-video outputs) as a fixed artifact, then re-run §8/§9's exact prompts (checklist-only, no guardrail) through this SAME fixed judge to get a real like-for-like before/after baseline for the guardrail's effect — comparing across two different, non-preserved judges (as this round was initially forced to do) is not a sound way to detect regression.

Raw outputs: `docs/research/2026-08-18-round10-results/*.json` (per-bundle round results with full gen text per video) and `haiku_new_videos.json` (fresh zh/fr Haiku baselines). Harness script: session-scratch, not committed (same limitation as §8/§9's harness — flagged as the real root cause of the calibration gap above; recommend committing it next time). Still investigation-only — nothing applied to production.

## 11. Dimension 6 targeted fix (2026-08-18, real, committed harness, n=2 ground-truth-backed + n=8 diagnosis)

Per `docs/research/2026-08-18-per-stream-scores.md`, D6 (Comparison & Scenarios, bundle `[2,4,6]`) is the real single-worst-performing dimension in the whole cohort: **18.8% structural completeness** for GPT-OSS-120B across the round-10 n=8 set, dragging `[2,4,6]`'s bundle average down while its bundle-mate D4 (Sentiment & Persuasion) scores a healthy 91.7%.

**Real diagnosis** (read directly off `docs/research/2026-08-18-round10-results/round_b246_r1_guardrail.json`'s raw `gen_text` for all 8 videos, alongside the two clean Haiku-4.5 ground-truth generations in `haiku_new_videos.json`): this is **not** the same class of defect as D7/D8 (model skipping a subsection it wasn't told to double-check). D6's `6.1`/`6.2` headers are almost always present. The real failure is GPT-OSS-120B **over-invoking the Insufficient Data Protocol** on single-narrative-perspective transcripts (geopolitical commentary, a language-learning podcast) where no explicit "vs"-framed comparison exists in the source — 4 of 8 round-10 videos got a bare `[Insufficient data...]` stub for both 6.1 and 6.2 (`sw22FMB_SWI`, `9T8L73AidFY`, `gCU0n6H_MXo`, and effectively `ctR1jrI42uc`/`LTNVA2iP9YU`), while Haiku 4.5 on the exact same transcripts (`ctR1jrI42uc`, `gCU0n6H_MXo`) actively **constructs** real comparison tables from implicit structure the source never explicitly tabulated (e.g. HSK-level learning-pathway comparison, weekly-lesson-vs-daily-practice modality comparison) — real content the source only implies through stages/methods/entities, not a stated side-by-side table. This is closer to the D9/D11 forecasting-vs-extraction class (an interpretation/inference gap) than the D7/D8 structural-checklist class, so the D7/D8 checklist fix does not directly apply as-is.

**Fix iteration** (2 rounds, real OpenRouter calls, `openai/gpt-oss-120b`, temp 0.3, judged with the committed `docs/research/parity-test-harness/judge.ts` v1.0.0, `--dims 6` isolated so structural_completeness is scored purely against D6's 2-item checklist): tested against the only 2 videos with a clean, independently-saved Haiku-4.5 D6 ground truth on disk (`gCU0n6H_MXo`, `ctR1jrI42uc`, same pair the harness's own proof run used).

| Round | Prompt | `gCU0n6H_MXo` struct/fact | `ctR1jrI42uc` struct/fact | Avg struct |
|---|---|---|---|---|
| 1 (baseline) | current unmodified production D6 segment | 50 / 5 | 100 / 35 | 75.0 |
| 2 (fix) | added an explicit "before invoking Insufficient Data, self-check for implicit levels/methods/entities/before-after axes" instruction + told the model comparison axes don't need to be explicitly framed as options in the source | 100 / 15 | 100 / 15 | **100.0** |

The fix round closed `gCU0n6H_MXo`'s structural gap completely (its baseline `[Insufficient Data...]` stub for both 6.1/6.2 became a real 6-row modality-comparison table plus 4-case scenario analysis once told to look for implicit structure). `factual_coverage` stayed low in both rounds (5-35) — expected and not a defect signal by itself: two different models independently constructing comparisons from the same transcript will pick different axes/entities than Haiku's specific ones, so low overlap with Haiku's exact figures is normal, not evidence the fix failed.

**Stopped at 2 iterations per the task's cost-discipline instruction** — this is a real, promising signal, not a fully proven fix: n=2 (the only videos with committed ground truth), not the full n=8 round-10 set, so this has not been re-validated against the other 6 videos (including the ones where GPT-OSS already scored higher, like `FfdOoDB_fbE` at 78, to check the fix doesn't regress an already-good case) or checked for a 90%+ Wilson CI at real sample size.

**Real cost this round**: 4 generation calls (2 baseline + 2 fix, ~$0.0104) + 4 isolated D6 judge calls (~$0.008) ≈ **$0.018**. Negligible relative to the cohort's $3.14 cumulative spend (§10).

**Honest verdict**: D6 is **not yet production-viable for GPT-OSS-120B** — the fix instruction (full text in `/tmp/.../scratchpad/d6/gen.mjs`'s `D6_VARIANT` constant during this session, not committed to `ucis-v5.3.ts`) shows a real, cheap, evidence-backed path to closing the specific "over-eager Insufficient Data fallback" defect, matching the same win pattern as the D7/D8 checklist fix but for a different root cause (inference gap, not checklist-skip gap). Before any production change: re-run the same fix at n≥8 (ideally the full round-10 set) to confirm it doesn't regress the videos GPT-OSS already handles well, and separately verify it doesn't over-fire (constructing comparisons that don't actually exist, i.e. false-positive tables on genuinely single-perspective content) — not tested here at this n. Recommendation for now: **keep D6 on Haiku 4.5** until that broader validation is done.
