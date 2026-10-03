# S1–S6 Structural Taxonomy (v1)

Phase B Layer 0 — Jev classification gate: structural class taxonomy for
transcript routing. Status: **v1 draft, user-approved 2026-10-03**, design
only (ADR 038 forbids pipeline implementation until a route passes the
bake-off).

## Classes

| Code | Id | Definition | Action (PROPOSED) |
|------|----|------------|-------------------|
| S1 | `S1_monologue_direct` | One primary speaker. | Maximize chunk size (W=500, S=250); skip expensive speaker diarization. |
| S2 | `S2_interview_qa` | Two distinct speakers with clear turn-taking. | Enforce speaker-attribution tracking; moderate chunk sizes. |
| S3 | `S3_panel_multi_speaker` | Highly dynamic, overlapping dialogue. | Reduce chunk size to prevent context mixing; enforce turn attribution. |
| S4 | `S4_procedural_screen_share` | Highly sequential "how-to" steps. | Enforce strict chronological preservation; forbid step merging/reordering. |
| S5 | `S5_narrative_documentary` | Heavily edited voiceovers mixed with ambient clips. | Flag high extrapolation risk and missing visual context. |
| S6 | `S6_unstructured_vlog` | Stream of consciousness, high noise-to-signal ratio. | Apply aggressive pre-filtering and sponsor/fluff pruning. |

**All numeric Action parameters are PROPOSED and must become `analysis.layer0.*`
Settings Registry keys when Phase B is built — never constants
(no-hardcoded-tunables, AGENTS.md §5.0.1).**

Units of W and S: the closest precedent in this repo is the Jev boundary
engine's sliding-window config — `windowWords` (window size in words, default
100) and `windowStrideWords` (stride in words, default 100) in
`web/lib/config/jev.ts:29-30`, clamped via
`analysis.jev.windowWords` / `analysis.jev.windowStrideWords`
(web/lib/config/jev.ts:45-46, registered at :112). W and S in the taxonomy
are most plausibly the same word-based units for a Layer-0-routed window
(window size W=500 words, stride S=250 words). **Units unconfirmed** — the
POC that produced W=500/S=250 did not record them; confirm before any
registry seed is written.

## Provenance

The 2026-09-26/27 Jev classification POC saved ONLY per-video results:
`/tmp/opencode/pool_classification.json` = `{videoId: {class: "S1".."S6",
multiSpeaker: 0–1, inventRisk: 0–9 scale}}` for the 14 pool videos
(S1×6, S3×4, S4×1, S5×2, S6×1 — no S2). The keyed criteria text the POC sent
to Jev was never saved (`/tmp/opencode/articulation-exercise.mts` has no
S1–S6 criteria; ledger line 1429 and
`docs/history/HANDOVER_2026-09-27-OC-BAKEOFF-PIPELINE-REENGINEERING.md:25`
only describe the API shape: choice-type needs keyed criteria record; noul
needs {true,false} object; score needs array criteria, max 10 levels, 0–9
scale, ×(9→100)).

**This v1 taxonomy is a user-approved 2026-10-03 reconstruction, NOT a copy
of the POC's criteria text.** The Decisions API request/response *shape*
(copied from `worker/src/services/JevCommentClassifier.ts` — `choice`
criteria record, `noul` {true,false} object, `score` criteria array) is
verified; the *wording* below is the reconstruction. Agreement between the
reconstructed criteria and the POC labels was measured on 2026-10-03 — see
`docs/architecture/S1_S6_POOL_RECLASSIFICATION.json` and the §7 Q3 line in
`docs/architecture/DESIGN-036-phase-b-layer0-layer1.md`.

## Pool re-classification result (2026-10-03)

Run by `scripts/jev-classify-pool.ts` over the 14-video pool
(`CURATED_VIDEO_IDS`, scripts/bakeoff-l2-evaluator.ts:60). Raw results:
`docs/architecture/S1_S6_POOL_RECLASSIFICATION.json`.

- Videos classified: **12 / 14** (2 skipped — transcript not cached in
  `/tmp/opencode/transcripts`, not fetched per dispatch: `Z6l4HpuyyP0`,
  `GOLgLU54b5s`; their POC labels are recorded but unverified against a
  fresh Jev call)
- **Class agreement: 4 / 12 (33%)** — LOW. Disagreements (POC → v1):

  | Video | POC | v1 | POC multiSpeaker | v1 multiSpeaker |
  |-------|-----|----|------------------|-----------------|
  | MoBr0nQtOnA | S3 | S2 | 0.84 | 0.99 |
  | _LCeJZFIsd4 | S6 | S2 | 0.31 | 0.97 |
  | DlNWYzaL_F0 | S3 | S2 | 0.85 | 0.87 |
  | LTNVA2iP9YU | S3 | S2 | 0.92 | 0.94 |
  | yB92mx97A8s | S5 | S3 | 0.59 | 0.99 |
  | EoKdX13w7SI | S5 | S1 | 0.50 | 0.80 |
  | uZ5kJ9CBbv0 | S3 | S1 | 0.87 | 0.06 |
  | 39hqY3nH5ug | S4 | S3 | 0.96 | 0.99 |

- Pattern in the disagreements: the v1 criteria text (a reconstruction, not
  the lost POC wording) draws the S1/S2/S3 boundaries differently — several
  POC S3 panels land in S2 under v1, and the two S5s split to opposite
  ends. The multiSpeaker signal itself broadly agrees (e.g. the S3→S2
  disagreements carry multiSpeaker ≥0.84 in BOTH runs — both runs saw
  multiple speakers; the criteria disagree on panel-vs-interview
  distinction, which is exactly the kind of wording sensitivity the
  agreement check exists to surface).
- multiSpeaker deltas: 7/12 within ±0.20; largest reversals: uZ5kJ9CBbv0
  (0.87 → 0.06), _LCeJZFIsd4 (0.31 → 0.97). inventRisk: 1/12 within ±1.0 on
  the 0–9 scale — the reconstructed risk-criteria wording diverges sharply
  from the POC's; see JSON `inventRiskDelta`.
- Total cost: **$0.0037** (12 calls, $0.0002–0.0007 each; no single call
  > $0.01, total < $0.10 cap).

**Interpretation (v1 caveat):** 33% agreement means the reconstructed v1
criteria are NOT yet equivalent to the lost POC criteria as a classifier.
Before Phase B relies on Layer 0 routing, either (a) tighten the v1
criteria wording (especially the S2/S3 two-speaker-vs-panel boundary and
the S5 voiceover signal) and re-run this script, or (b) treat the v1 labels
as the new baseline and re-derive routing rules against them. This decision
is flagged in DESIGN-036 §7 Q3 — it needs a user call.


## Codified shape (web/lib/jev/taxonomy.ts)

`STRUCTURAL_CLASSES` (const tuple), `StructuralClass` type,
`CLASS_CODE_BY_ID` / `CLASS_ID_BY_CODE` mapping, and
`JEV_STRUCTURAL_CRITERIA` — the keyed criteria record for the Decisions API
`choice` question. Descriptions only; no action parameters in code.
