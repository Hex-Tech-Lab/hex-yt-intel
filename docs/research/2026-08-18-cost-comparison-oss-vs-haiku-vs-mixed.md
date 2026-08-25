# Real Per-1000-Analyses Cost Comparison: Haiku-only vs GPT-OSS-120B-only vs Mixed

**Date**: 2026-08-18
**Status**: Arithmetic/presentation only — no new API calls, no new spend. All dollar figures below are real numbers pulled verbatim from three already-completed test docs, cited by exact source line. One derived figure (the per-bundle cost split inside Option C) is flagged explicitly as a proportional estimate, because the real source data does not break generation cost down by bundle — only by whole-batch total and by per-bundle *quality* score.

## 0. What is real vs. derived, stated up front

| Figure | Status |
|---|---|
| Haiku 4.5 total generation cost, all 5 bundles, 8 videos (40 calls) | **Real** — `2026-08-18-full-dimension-parity-batch-test.md` §5: "$1.4115" |
| GPT-OSS-120B checklist-fixed total generation cost, all 5 bundles, 8 videos (40 calls) | **Real** — same file, §8: `genCost: 0.03671843999999999` (`docs/research/2026-08-18-parity-batch-results.json`, key `checklist_fix_retest_2026_08_18.genCost`) |
| Haiku 4.5 digest cost/row (n=14) | **Real** — `2026-08-18-digest-fresh-haiku-baseline-fidelity-test.md` §"Real cost comparison": "$0.01085" |
| GPT-OSS-120B digest cost/row (n=14) | **Real** — same file: "$0.00272" |
| Per-bundle quality (structural_completeness) scores | **Real** — `2026-08-18-full-dimension-parity-batch-test.md` §3 (before) and §8 (after checklist fix) |
| Per-bundle *dollar* split within the $1.4115 / $0.03672 batch totals | **NOT in the source data.** Neither the .md files nor the raw JSON (`parity-batch-results.json`) record cost per individual bundle — only the whole-batch total (`checklist_fix_retest_2026_08_18` has no per-bundle cost keys, confirmed by direct inspection) and per-pair judge scores. Option C below therefore uses a disclosed, labeled **proportional estimate** (real total × dimension-count share) to split cost between the GPT-OSS bundles and the one Haiku-routed bundle. This is the one number in this table that is not a directly-cited real dollar figure — flagged, not hidden. |

## 1. Real per-bundle quality picture (structural_completeness, n=8, checklist-fixed where noted)

Source: `2026-08-18-full-dimension-parity-batch-test.md` §3 and §8.

| Bundle | Dims | Before (unmodified) | After checklist fix | Generalizes? |
|---|---|---|---|---|
| `[1,10]` | 2 | 60.2 | **100.0** | Yes |
| `[8]` | 1 | 35.4 | **84.4** | Mostly |
| `[2,4,6]` | 3 | 37.9 | **80.0** | Mostly |
| `[5,7]` | 2 | 44.1 | **81.3** | Mostly |
| `[3,9,11]` | 3 | 44.5 | **49.9** | **No — barely moves** |

`[3,9,11]` is the one bundle where GPT-OSS-120B, even checklist-fixed, does not reach parity with Haiku — this is the real, cited reason Option C routes that bundle to Haiku.

## 2. Real aggregate costs used

| Item | Value | Source |
|---|---|---|
| Haiku 4.5, all 5 bundles, 8 videos (40 calls) | $1.4115 | parity test §5 |
| Haiku 4.5, per video (all 5 bundles) | $1.4115 / 8 = **$0.17644** | derived (division only, no new assumption) |
| GPT-OSS-120B checklist-fixed, all 5 bundles, 8 videos (40 calls) | $0.03672 | parity test §8 / JSON `genCost` |
| GPT-OSS-120B checklist-fixed, per video (all 5 bundles) | $0.03672 / 8 = **$0.00459** | derived |
| Haiku 4.5 digest, per analysis | **$0.01085** | digest fidelity test, real n=14 avg |
| GPT-OSS-120B digest, per analysis | **$0.00272** | digest fidelity test, real n=14 avg |

## 3. Option A — Haiku 4.5 only (current production baseline)

| Bundle group | Real per-video cost |
|---|---|
| All 5 bundles (`[1,10]`,`[8]`,`[2,4,6]`,`[5,7]`,`[3,9,11]`) | $0.17644 (whole-batch real figure; no real per-bundle split exists) |
| Digest | $0.01085 |
| **Total / analysis** | **$0.18729** |
| **Total / 1000 analyses** | **$187.29** |

## 4. Option B — GPT-OSS-120B only, checklist fix on all 5 bundles

| Bundle group | Real per-video cost |
|---|---|
| All 5 bundles (checklist-fixed) | $0.00459 |
| Digest | $0.00272 |
| **Total / analysis** | **$0.00731** |
| **Total / 1000 analyses** | **$7.31** |

**Quality caveat (not a cost gap — flag per task instructions)**: `2026-08-18-full-dimension-parity-batch-test.md` §8 is the latest section on this file as of this read — no newer section exists beyond §8. The checklist fix leaves `[3,9,11]` at 49.9 structural_completeness (vs Haiku's 100 baseline on that bundle) — Option B is real-cheap but ships a known, unresolved quality gap on the Architecture/Forward-Looking/Monetization dimensions (D3, D9, D11) if adopted as-is.

## 5. Option C — Mixed: GPT-OSS-120B (checklist-fixed) for `[1,10]`,`[8]`,`[2,4,6]`,`[5,7]` + digest; Haiku 4.5 for `[3,9,11]`

Real total dollars exist only at the whole-5-bundle-batch level for each model, not per-bundle. To blend, this option splits each model's real batch total in proportion to dimension count in the routed bundles — **disclosed estimate, not a directly observed dollar figure**:

- GPT-OSS-120B side covers `[1,10]`+`[8]`+`[2,4,6]`+`[5,7]` = 2+1+3+2 = **8 of 11 dimensions**.
  Estimated cost = $0.03672 × (8/11) = $0.02671 per 8 videos → **$0.003339/video**
- Haiku 4.5 side covers `[3,9,11]` = **3 of 11 dimensions**.
  Estimated cost = $1.4115 × (3/11) = $0.38495 per 8 videos → **$0.048119/video**

| Bundle group | Model | Real or estimated per-video cost |
|---|---|---|
| `[1,10]`,`[8]`,`[2,4,6]`,`[5,7]` (8 dims) | GPT-OSS-120B checklist-fixed | $0.003339 (estimated split of real $0.03672 total) |
| `[3,9,11]` (3 dims) | Haiku 4.5 | $0.048119 (estimated split of real $1.4115 total) |
| Digest | GPT-OSS-120B | $0.00272 (real) |
| **Total / analysis** | | **$0.054178** |
| **Total / 1000 analyses** | | **$54.18** |

## 6. Summary table

| Option | Total / 1000 analyses | vs Option A |
|---|---|---|
| A — Haiku 4.5 only | **$187.29** | baseline |
| B — GPT-OSS-120B only (checklist-fixed) | **$7.31** | -96.1% (quality gap on `[3,9,11]` unresolved) |
| C — Mixed (GPT-OSS + Haiku on `[3,9,11]`) | **$54.18** | **-71.1%** |

## 7. Caveats, stated plainly

1. All figures scale a real n=8 batch linearly to n=1000 — no real n=1000 test exists; this is arithmetic extrapolation, not a new measurement.
2. Option C's per-bundle dollar split is a disclosed proportional estimate (by dimension count), not a directly observed real dollar figure — the source data has no per-bundle cost breakdown to cite directly.
3. Option B is cheapest but ships with `[3,9,11]` at 49.9/100 structural_completeness — a real, unresolved quality gap, not a cost consideration.
4. Neither the checklist fix nor any routing change has been applied to production (per the source doc's explicit constraint) — this table is investigation-only.
