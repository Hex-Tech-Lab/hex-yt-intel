# n=8 Validation — Exhaustive-Extraction Mandate + Structural Fixes, All 5 Bundles × All 8 Videos (2026-08-18)

**Status**: real, n=8, all 40/40 generation + 40/40 judge calls completed this session. Extends
`docs/research/2026-08-18-factual-coverage-gap-investigation.md`'s n=1 isolate test.

## Honest caveat on prompt reconstruction (read first)

The exact combined prompt run here uses:
- The **verbatim** SELF-VERIFICATION CHECKLIST sentence template (recovered from
  `docs/research/2026-08-18-full-dimension-parity-batch-test.md` line 97), filled per-bundle
  with the real `required-subsections.ts` checklist.
- **Reconstructed, not verbatim**, versions of the HALLUCINATION GUARDRAIL, the D3/9/11
  ESTIMATION MANDATE, and the EXHAUSTIVE EXTRACTION MANDATE. The actual wording used in prior
  sessions' scratch scripts was never committed to disk (same recurring gap this cohort's own
  README warns about) — only prose descriptions of what each block does survived. I rebuilt
  each block as closely as the prose descriptions specify (anti-fabrication + estimate
  carve-out; D3/9/11 "estimate, don't bail to Insufficient Data"; anti-paraphrase + "template's
  `1.` is a format example, not a stop instruction" + explicit named sub-fields). This is a
  real, flagged deviation from the task's "use it verbatim" instruction — it could not be
  satisfied because the verbatim text does not exist anywhere on disk. Full text of all four
  fix blocks as actually used: `docs/research/n8-runner/run.mjs` (`GUARDRAIL`, `ESTIMATE_FIX`,
  `EXHAUSTIVE_MANDATE`, `checklistFor()`).

## What was run

- **Candidate**: `openai/gpt-oss-120b`, temperature 0.3, max_tokens 16000, fresh generation
  (not reused) — combined prompt = base UCIS v5.3 + PromptBuilder's real segment instruction +
  hallucination guardrail + self-verification checklist (per-bundle) + D3/9/11 estimation
  mandate (only when 3/9/11 present) + exhaustive-extraction mandate. All 5 `STREAM_BUNDLES`
  groupings, all 8 canonical videos. 40/40 calls returned `finish_reason: "stop"` (zero
  truncation).
- **Ground truth**: Haiku 4.5, same sourcing as `2026-08-18-full-parity-final-scores.md` (fresh
  per-bundle text for `fr`/`gCU0n6H_MXo` and `zh`/`ctR1jrI42uc`; concatenated per-dimension
  `haiku_output` for the other 6 videos from `2026-08-18-parity-batch-results.json`). No new
  Haiku generation needed or performed.
- **Judge**: `docs/research/parity-test-harness/judge-prompt.ts`'s `JUDGE_SYSTEM_PROMPT`
  verbatim, `JUDGE_PROMPT_VERSION 1.0.0`, `anthropic/claude-haiku-4.5`, temperature 0 — inlined
  in `docs/research/n8-runner/judge_all.mjs` (unmodified copy; `judge.ts` itself couldn't be
  imported as a module because its CLI `main()` runs unconditionally on import) — 40/40 calls
  succeeded, 0 parse failures.
- Raw outputs: `docs/research/n8-runner/results/gen_*.json` (candidate generations),
  `docs/research/n8-runner/results/judged_*.json` and `judged_all.json` (scored).

## Real final scores per bundle (n=8, this round)

| Bundle | structural_completeness (avg) | factual_coverage (avg) |
|---|---|---|
| `[1,10]` | 97.9 | 53.0 |
| `[8]` | 87.5 | 42.1 |
| `[2,4,6]` | 72.5 | 45.5 |
| `[5,7]` | 47.5 | 30.6 |
| `[3,9,11]` | 85.0 | 62.8 |
| **Overall (all 40)** | **78.1** | **46.8** |

## Comparison vs. pre-mandate baseline (`2026-08-18-full-parity-final-scores.md`, checklist+guardrail only)

| Bundle | Baseline structural | This round structural | Δ | Baseline factual | This round factual | Δ |
|---|---|---|---|---|---|---|
| `[1,10]` | 95.8 | 97.9 | +2.1 | 58.9 | 53.0 | **−5.9** |
| `[8]` | 100.0 | 87.5 | **−12.5** | 56.0 | 42.1 | **−13.9** |
| `[2,4,6]` | 60.0 | 72.5 | +12.5 | 41.2 | 45.5 | +4.3 |
| `[5,7]` | 87.5 | 47.5 | **−40.0** | 51.8 | 30.6 | **−21.2** |
| `[3,9,11]` | 80.8 | 85.0 | +4.2 | 61.9 | 62.8 | +0.9 |
| **Overall** | **84.8** | **78.1** | **−6.7** | **54.0** | **46.8** | **−7.2** |

**The n=1 result did not hold at n=8.** The mandate does not reproduce a factual_coverage
improvement anywhere in this run — 3 of 5 bundles regressed on factual_coverage, and `[5,7]`
(the exact bundle the n=1 test was run on) regressed hardest of all, both structurally (−40.0)
and factually (−21.2). This is the same "looked strong at n=1-2, regressed/needed a carve-out
at n=8" pattern this cohort has now hit four times (§6m-vii's estimate fix, §6m-xi's D6 fix,
and now this).

## Per-video breakdown (structural/factual)

| Bundle | en/FfdOoDB_fbE | ar/vEC6e5dBi4Y | be/wcgvQs_9Yx8 | he/sw22FMB_SWI | ja/9T8L73AidFY | de/LTNVA2iP9YU | fr/gCU0n6H_MXo | zh/ctR1jrI42uc |
|---|---|---|---|---|---|---|---|---|
| `[1,10]` | 100/75 | 100/15 | 100/35 | 100/45 | 100/45 | 100/72 | 83/72 | 100/65 |
| `[8]` | 75/62 | 75/25 | 100/45 | 100/15 | 100/35 | 75/65 | 75/45 | 100/45 |
| `[2,4,6]` | 78/72 | 56/25 | 78/45 | 89/62 | 78/45 | 89/45 | 56/35 | 56/35 |
| `[5,7]` | 60/65 | **0/0** | 40/35 | 100/45 | 40/25 | 40/15 | 40/25 | 60/35 |
| `[3,9,11]` | 93/75 | 87/62 | 87/62 | 100/72 | 73/62 | 53/35 | 87/72 | 100/62 |

## Real root cause of `[5,7]`'s collapse (read the actual data, not just the score)

`vEC6e5dBi4Y` (`ar`) scored **0/0** in `[5,7]` — its raw generation is only 384 characters
(`docs/research/n8-runner/results/gen_5_7.json`), consistent with the same over-eager
Insufficient-Data bail-out already documented as a known separate failure mode in the n=1
report's "honest caveat on the control." The mandate did not fix that failure mode — it appears
to have made `[5,7]` collapse into it *more* often across the 8-video set (avg structural 47.5,
half the bundles' videos at ≤40 structural), the opposite of the n=1 result. `[8]`'s regression
(-12.5/-13.9) is smaller but real and consistent across most videos, not one outlier.

## Real cost

- Generation: 40 calls, `openai/gpt-oss-120b`, 661,585 prompt tokens + 116,648 completion
  tokens total (from OpenRouter `usage` on every call). Exact per-token billing wasn't
  requested via a cost-accounting call; at this cohort's own previously-observed GPT-OSS-120B
  rates this is roughly **$0.05-$0.15**, an order-of-magnitude estimate, not exact billing —
  flagged honestly rather than presented as precise.
- Judging: 40 calls, `anthropic/claude-haiku-4.5`, temp 0, ~1-4K input + up to 1600 output
  tokens each — comparable in scale to the pre-mandate round's 40-call judging cost
  (**~$0.25-$0.45** per that round's own estimate).
- **Total this round: order of magnitude $0.30-$0.60.** Well within the authorized real-spend
  budget.

## Final verdict

**GPT-OSS-120B + this combined prompt fix is NOT production-viable across the board.** The
exhaustive-extraction mandate's n=1 win does not generalize:

- It **regressed** 3 of 5 bundles on factual_coverage and 2 of 5 on structural_completeness,
  including a severe regression on `[5,7]` (the bundle it was validated on at n=1) and a
  meaningful regression on the previously-strongest bundle `[8]`.
- It gave small real gains on `[2,4,6]` (+12.5 structural, +4.3 factual) and `[3,9,11]`
  (+4.2/+0.9), and was roughly flat on `[1,10]` structurally while losing factual_coverage
  there too.
- Overall factual_coverage across all 40 pairs is 46.8 post-mandate vs. 54.0 pre-mandate — a
  net regression, not the hoped-for fix.
- Root failure mode is the same over-eager Insufficient-Data-Protocol bail-out this cohort has
  now documented three separate times (§9's D6 finding, the n=1 report's own control-run
  caveat, and now `[5,7]`'s `ar` collapse here) — the "fill every slot" instruction appears to
  interact badly with that pre-existing bail-out tendency rather than curing it, likely because
  a model already primed to bail can interpret "don't stop at the first example" as reason to
  bail even earlier when it's uncertain it can sustain the demanded exhaustiveness.

**Recommendation**: do not ship the exhaustive-extraction mandate as-is. Do not adopt it for
`[5,7]` or `[8]` under any circumstances (both regressed). If pursued further, the real next
step is fixing the Insufficient-Data-Protocol over-eagerness directly (a guardrail against
bailing when partial extraction is possible) before layering an exhaustiveness instruction on
top of it — the current ordering (mandate first, bail-out tendency unaddressed) is what broke
`[5,7]`. Keep the pre-mandate checklist+guardrail fix (`2026-08-18-full-parity-final-scores.md`)
as the current best-known production prompt; GPT-OSS-120B is not at Haiku-4.5 factual parity on
any bundle under either version.
