# Full UCIS Parity Re-Score — Fixed Harness, All 8 Videos × All 5 Bundles (2026-08-18)

**Status**: real, final for this cohort under `judge.ts` `JUDGE_PROMPT_VERSION 1.0.0`.
**Supersedes**: §8/§9/§10 of `docs/research/2026-08-18-full-dimension-parity-batch-test.md` —
those numbers are judge-drift-affected (identical `[1,10]` output scored 100.0 under §8/§9's
judge and 47.5 under §10's from-scratch-rebuilt judge, with no real prompt change in between).
Treat §8-10 as historical only; do not compare their numbers to this table.

## What was scored

- **Candidate**: GPT-OSS-120B, guardrail-added + checklist-fixed prompt (the latest real
  version), from `docs/research/2026-08-18-round10-results/round_b*.json`
  `perVideo[<lang>].gen_text` — already covered all 8 videos × 5 bundles, no regeneration
  needed.
- **Ground truth**: Haiku 4.5.
  - `fr` (gCU0n6H_MXo) and `zh` (ctR1jrI42uc): `haiku_new_videos.json` per-bundle `text`.
  - The other 6 videos (`ja`/9T8L73AidFY, `ar`/vEC6e5dBi4Y, `he`/sw22FMB_SWI,
    `be`/wcgvQs_9Yx8, `en`/FfdOoDB_fbE, `de`/LTNVA2iP9YU): built by concatenating the
    per-dimension `haiku_output` fields already saved in
    `docs/research/2026-08-18-parity-batch-results.json` for the dims in each bundle. No new
    Haiku generations were needed — this was the one real gap the harness's README flagged as
    "known limitation, not done", closed here by reading the existing schema rather than
    regenerating anything.
- **Judge**: `docs/research/parity-test-harness/judge.ts` (`judgeBundlePair`), unmodified,
  `anthropic/claude-haiku-4.5` at `temperature: 0`, fixed system prompt + fixed
  required-subsections checklist. 40/40 real calls succeeded, 0 missing/skipped pairs.
- Raw per-call output: `docs/research/2026-08-18-full-parity-final-scores.raw.json`.

## Real final scores per bundle (averaged across all 8 videos)

| Bundle | structural_completeness (avg) | factual_coverage (avg) |
|---|---|---|
| `[1,10]` | 95.8 | 58.9 |
| `[8]` | 100.0 | 56.0 |
| `[2,4,6]` | 60.0 | 41.2 |
| `[5,7]` | 87.5 | 51.8 |
| `[3,9,11]` | 80.8 | 61.9 |
| **Overall (all 40)** | **84.8** | **54.0** |

## Per-video breakdown

| Bundle | ja/9T8L73AidFY | fr/gCU0n6H_MXo | ar/vEC6e5dBi4Y | he/sw22FMB_SWI | be/wcgvQs_9Yx8 | zh/ctR1jrI42uc | en/FfdOoDB_fbE | de/LTNVA2iP9YU |
|---|---|---|---|---|---|---|---|---|
| `[1,10]` | 100/62 | 83/62 | 100/25 | 100/65 | 100/45 | 100/78 | 100/72 | 83/62 |
| `[8]` | 100/72 | 100/72 | 100/35 | 100/35 | 100/65 | 100/45 | 100/62 | 100/62 |
| `[2,4,6]` | 56/35 | 44/35 | 56/35 | 56/35 | 56/35 | 56/45 | 100/75 | 56/35 |
| `[5,7]` | 40/35 | 100/72 | 100/5 | 100/72 | 100/35 | 100/72 | 100/78 | 60/45 |
| `[3,9,11]` | 73/62 | 87/72 | 47/15 | 93/72 | 93/85 | 93/82 | 87/72 | 73/35 |

(cells are `structural_completeness/factual_coverage`)

## Cost of this round

40 judge calls (`claude-haiku-4.5`, temp 0, ~1-4K input tokens each — bundle text pairs plus
checklist — max 1600 output tokens). Per-call usage wasn't logged individually in this run's
runner script; based on this project's own prior comparable judge-call costs (round-10 files'
`judgeCost` for 8-call single-bundle batches ranged ~$0.05–$0.09), a straight 5x scale-up for
40 calls puts this round at **roughly $0.25–$0.45**. No new LLM generation cost — all candidate
and ground-truth text was reused from already-paid-for prior rounds, per the cost-discipline
directive.

## Honest verdict on checklist-fix parity with Haiku 4.5

**No — the checklist-fix approach does not achieve real parity across all 5 bundle groups,**
even scored under the corrected, non-drifted judge:

- `[8]` (structural 100.0, factual 56.0) is genuinely strong on structure but caps near 56%
  factual overlap — the checklist fix reliably produces every required subsection, but roughly
  half the concrete facts/entities/figures Haiku surfaces are still missing or not carried
  over.
- `[1,10]` and `[5,7]` are close on structure (95.8 / 87.5) but still sit at 51–59% factual
  coverage — the same pattern: format compliance is largely solved, substance transfer is not.
- `[2,4,6]` is the clear outlier and the real remaining gap: only 60.0 structural / 41.2
  factual — 5 of 8 videos landed at 44-56 structural, well below the checklist-fix bundles'
  usual ceiling, with `en` (100/75) the sole video that actually hit target. This bundle's
  checklist fix has not generalized the way `[8]`'s did.
- `[3,9,11]` sits in between (80.8/61.9), dragged down almost entirely by `ar`/vEC6e5dBi4Y
  (47/15) — a single-video outlier rather than a systemic bundle problem, but real and
  unresolved.
- Cross-cutting: `ar` (vEC6e5dBi4Y, Arabic) is the weakest video across nearly every bundle
  (25, 35, 35, 5, 15 factual) — this reads as a genuine, still-open language/transcript-quality
  gap for Arabic specifically, not noise.

**Bottom line**: the checklist-fix + guardrail changes reliably fixed *structural* completeness
for most bundles (4 of 5 average ≥80% structural) but did **not** close the *factual* gap with
Haiku 4.5 anywhere — every bundle's factual average sits between 41% and 62%, well short of
parity. `[2,4,6]` additionally has an unresolved structural regression that needs its own
targeted fix, and Arabic needs separate investigation as a likely language-specific weak point.
