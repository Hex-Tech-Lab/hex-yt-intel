# Per-Stream (Per-Dimension) UCIS Parity Scores — Re-Derived, Zero New Spend (2026-08-18)

**Status**: real, derived entirely from already-collected data. **Zero new LLM/judge calls.**
**Source**: `docs/research/2026-08-18-full-parity-final-scores.raw.json` (the same 40 real judge
calls behind `docs/research/2026-08-18-full-parity-final-scores.md`), re-aggregated at the
individual-dimension level per explicit user directive — bundle-level averaging hides which
specific dimension inside a bundle is actually failing.

## Method (read before trusting the table)

1. `docs/research/parity-test-harness/judge.ts` scores each bundle-pair call with two numbers:
   `structural_completeness` and `factual_coverage`, **both blended across every dimension in
   that bundle call** — the judge does not emit a separate factual-coverage number per
   dimension anywhere in the raw output.
2. It *does* emit `missing_subsections` as a flat list of strings prefixed `D<n>: <title>`
   (confirmed in `docs/research/parity-test-harness/required-subsections.ts`'s
   `requiredSubsectionsForBundle`, which tags every required subsection with its owning
   dimension before handing the checklist to the judge). That prefix is real, dimension-scoped
   ground truth already present in the source data.
3. **Structural completeness per dimension is real and re-derived here**: for each dimension
   `d`, `pct = (required_subsections[d] - missing_subsections_for_d) / required_subsections[d] × 100`,
   averaged across all 8 videos.
4. **Factual coverage per dimension is NOT separately available in the source data.** The judge
   never produced a per-dimension factual number — only a single blended score per bundle call.
   The table below reports the bundle-level blended factual score against each dimension for
   context only, explicitly labeled as such. Treat it as "factual coverage of the bundle this
   dimension ships in," not a per-dimension figure — reporting it as if it were dimension-specific
   would be fabrication.

## Real per-dimension structural completeness (worst → best, all 8 videos)

| Dim | Name | Bundle stream | Real structural completeness (avg/8 videos) | Bundle factual coverage (blended, NOT dimension-specific) |
|---|---|---|---|---|
| D6 | Comparison & Scenarios | `[2,4,6]` | **18.8%** | 41.2% |
| D2 | Metadata & Virality | `[2,4,6]` | **56.2%** | 41.2% |
| D3 | Deep Analysis | `[3,9,11]` | 70.8% | 61.9% |
| D11 | Monetization | `[3,9,11]` | 78.6% | 61.9% |
| D9 | Trends & Gaps | `[3,9,11]` | 80.0% | 61.9% |
| D7 | Implementation Playbook | `[5,7]` | 81.2% | 51.8% |
| D10 | Credibility & Risk | `[1,10]` | 91.7% | 58.9% |
| D4 | Sentiment & Persuasion | `[2,4,6]` | 91.7% | 41.2% |
| D5 | Priority Insights | `[5,7]` | 95.8% | 51.8% |
| D1 | Executive Digest | `[1,10]` | 100.0% | 58.9% |
| D8 | Knowledge Graph | `[8]` (solo stream) | 100.0% | 56.0% |

## What this changes vs. the bundle-level report

The bundle-level report (`2026-08-18-full-parity-final-scores.md`) said `[2,4,6]` was "the clear
outlier" at 60.0% structural, averaged flatly across its 3 dimensions. Breaking it down:

- **D6 (Comparison & Scenarios) is the real single worst performer in the entire cohort at
  18.8% structural completeness** — it is dragging the whole `[2,4,6]` bundle average down, not
  a flat 3-way underperformance. 6.1/6.2 subsections are missing in almost every video.
- **D2 (Metadata & Virality) is the second-worst at 56.2%** — genuinely weak on its own, not just
  collateral damage from D6.
- **D4 (Sentiment & Persuasion), also in the same `[2,4,6]` bundle, is actually fine at 91.7%
  structural** — the bundle-level 60.0% average was masking that D4 isn't the problem at all.

This is the exact reason the user asked for per-stream reporting: `[2,4,6]`'s prompt-iteration
fix needs to target D6 specifically (and D2 secondarily), not treat the bundle as a uniform
3-dimension failure.

## Cross-reference: dimension → real operational bundle-stream call

| Bundle stream (as actually called in production) | Dimensions inside |
|---|---|
| `[1,10]` | D1 (Executive Digest), D10 (Credibility & Risk) |
| `[8]` | D8 (Knowledge Graph) — solo stream |
| `[2,4,6]` | D2 (Metadata & Virality), D4 (Sentiment & Persuasion), D6 (Comparison & Scenarios) |
| `[5,7]` | D5 (Priority Insights), D7 (Implementation Playbook) |
| `[3,9,11]` | D3 (Deep Analysis), D9 (Trends & Gaps), D11 (Monetization) |

Reported individually above per-dimension; grouped here only to show which dimensions still
share one LLM call operationally (`web/lib/config/synthesis.ts` `STREAM_BUNDLES`).

## Honest limitations (do not skip)

- **Factual coverage is genuinely only available at the bundle-call level in this dataset.** No
  interpolation or estimate is offered per dimension — the column above is explicitly the
  bundle's blended number, repeated for every dimension in that bundle, not a real per-dimension
  breakdown. A real per-dimension factual score would require re-running the judge with a
  per-dimension-scoped prompt (new spend, out of scope for this zero-spend task).
- Structural completeness derivation assumes `missing_subsections` is a reliable, complete list
  (i.e., the judge never silently omits a missing subsection it should have flagged). This is
  the same assumption the original bundle-level report already depended on — no new risk
  introduced here.
- n=8 videos per dimension throughout (same 8 videos as the source report).

## Priority order for next prompt-iteration round (worst 3 → best 3)

**Worst 3 (fix first):**
1. **D6 — Comparison & Scenarios** (18.8% structural) — real, severe, isolated failure.
2. **D2 — Metadata & Virality** (56.2% structural).
3. **D3 — Deep Analysis** (70.8% structural).

**Best 3 (already at/near parity structurally, leave alone):**
1. **D8 — Knowledge Graph** (100.0% structural).
2. **D1 — Executive Digest** (100.0% structural).
3. **D5 — Priority Insights** (95.8% structural).

Note factual coverage (bundle-blended) sits at 41–62% everywhere regardless of structural score —
per the source report's own conclusion, format compliance is largely solved but substance
transfer is not solved anywhere, including the "best" structural performers.
