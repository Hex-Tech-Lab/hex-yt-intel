# RCA: Why the Wave 0 Contract Audit Missed the KG Weight/Strength Scale Bug

**Date**: 2026-07-23
**Trigger**: User asked why a full-spectrum E2E contract audit (Wave 0, 2026-07-08) didn't
catch the KG `weight`/`strength` schema-vs-prompt scale mismatch found and fixed tonight
(commits `22397b2e`/`21bab85a`), given the audit specifically assigned an agent to KG/Relations
contracts and produced 53 test cases for exactly that surface.

---

## 1. What the prior audit actually checked (and did well)

Wave 0 Agent 4 (`docs/audit/WAVE0_KG_RELATIONS_FINDINGS.md`) ran a real audit against a real,
explicit methodology (documented in `WAVE0_WAVE2_EXECUTIVE_SUMMARY.md` line 268-279):

> **Contracts = Sender Emits + Receiver Expects**
> 1. Sender: what data does the client/upstream system emit?
> 2. Schema: what does the schema allow?
> 3. Receiver: what does the downstream system expect?
> 4. Mapping: do field names, types, optionality match 1:1?

This is a **shape contract** methodology — field names, types, optionality, endpoint-to-endpoint
consistency. Under this lens it found real, serious bugs and they were fixed:

- Edge-mapping-by-label bug in `AggregateGlobalGraphUseCase` (nodes keyed by mutable `label`
  instead of immutable `id`, causing cross-analysis edge collisions). **Confirmed fixed** —
  current code uses `nodesById` throughout.
- Per-analysis (`{entities, relations}`) vs global-graph (`{nodes, edges}`) shape inconsistency.
- Orphaned edges on node dedup, missing webhook input validation, vector-dedup return-type gaps.

53 contract tests were written (`web/lib/__tests__/contracts/kg-relations.contract.test.ts`,
still in the repo) and the audit was marked 100% complete across all 5 Wave 0 agents.

## 2. What it never checked — and the smoking gun

The methodology above checks **shape** (do field names/types/optionality match between two
sides of an API boundary). It never asks a second, orthogonal question: **does the *value
domain* the prompt promises match the value domain the schema enforces** — i.e., not just "is
there a `weight` field of type `number`," but "is a `weight` of `8` actually valid."

The evidence this was structurally out of scope, not just missed by chance: the audit's own
hand-authored test fixtures in `kg-relations.contract.test.ts` use `weight: 1.5`, `weight: 1.2`,
`weight: 0.9` — i.e. **the audit's own mocks already assumed values could exceed 1**, which
would have failed the real `UCISPayloadV2Schema`'s old `.max(1)` bound the moment they were
run through it. Nobody ever did that cross-check, because:

- The contract tests validate shape against **hand-written mocks**, not against the real
  `UCISPayloadV2Schema` used at persist time, and not against real LLM-generated payloads.
- The prompt (`web/lib/prompts/ucis-v5.1.ts`) explicitly documents the intended range
  ("`weight`: Importance (1-10)", "`strength`: Connection strength (1-10)") but nothing in the
  audit process ever diffed that prose against the schema's numeric literals.

**Net conclusion**: this wasn't a slip inside the audit's own methodology — it's a category of
contract ("prompt-documented value semantics ↔ schema-enforced value bounds") that no Wave 0
agent was ever assigned to check, because the audit's definition of "contract" stopped at shape.

## 3. Quantifying the gap

- `web/lib/validators/synthesis.ts` has 38 `.min(`/`.max(` numeric/length constraints.
- Of these, only 2 fields (`weight`, `strength`) have an explicit, greppable prompt-side range
  annotation ("(1-10)") that could even be mechanically cross-checked. **Both were wrong** — a
  100% failure rate on the one subset of fields where this check was actually cheap to do.
- The remaining ~36 constraints (confidence 0-1, persona weights 0-1, polarity -1..1, string
  length minimums, array size caps) have no explicit prompt-side range annotation to diff
  against — they're either correct by unstated convention or simply unauditable without
  runtime sampling. That itself is a finding: most of the schema's numeric contracts aren't
  self-documenting enough for even a manual side-by-side check.
- Blast radius of the actual bug: every analysis with a non-empty knowledge graph — in
  practice, the large majority of "Partial/Incomplete" rows in Analysis History tonight.

## 4. Settings-schema-as-single-source-of-truth — current real state

The vision (per `web/lib/types/settings.ts`'s own header comment: *"Settings are the single
source of truth for all configuration values. No hard-coded configuration values should exist
in the codebase."*) is **~15-20% realized**, and only for one narrow slice:

- `AdminSettings`/`UserSettings` types + a Supabase-backed adapter (`settings-adapter.ts`) do
  exist, covering: dimension count, stream bundles, model cascade, timeouts, retry policy.
- **But `useSettings()`/the settings context is referenced nowhere else in the entire web app**
  outside its own provider file (verified: zero call sites in `web/lib`, `web/app`,
  `web/components`). It is fully wired but **entirely unconsumed** — a dead layer, not an
  underused one.
- Zero value-domain contracts (KG weight/strength bounds, persona enums, dimension content
  length minimums, cache TTLs, size caps) route through it. They live as hardcoded literals
  scattered across `validators/synthesis.ts`, `prompts/ucis-v5.1.ts`, and UI normalization code
  (e.g. `KnowledgeGraphCanvas.tsx`'s `node.weight / 10`), fully disconnected from each other and
  from any settings page. There is no single place to open and see "this is the contract for
  weight" — which is exactly the blind spot being described.

## 5. Grading

| Dimension | Rating | Basis |
|---|---|---|
| Severity of this bug class | **HIGH** | Silently downgrades complete, correctly-generated analyses to failed/partial billing status; user-facing trust hit; possible billing-accuracy impact |
| Detectability by shape-only contract audit | **LOW** | Requires either manual prompt-vs-schema prose diffing, or running real payloads through the schema — neither was in Wave 0's scope |
| Blast radius (this specific bug) | **HIGH** | Majority of KG-bearing analyses, ongoing since whenever weight/strength schema was written |
| Settings-as-single-source-of-truth maturity | **~15-20%** | Real for pipeline/operational config; ~0% for value-domain/data-shape contracts |
| Risk of recurrence without a new check | **HIGH** | Nothing currently prevents a future prompt edit or schema edit from drifting apart silently again |

---

## 6. Waves and Tasks

### Wave A — Close tonight's specific gap (mostly done)
- **A1.** [DONE] Fix `weight`/`strength` schema bounds to 1-10 (`22397b2e`/`21bab85a`).
- **A2.** Spot-check `kg-relations.contract.test.ts` and sibling contract-test fixtures for
  other stale values assuming the old (wrong) range — the same fixtures that already contained
  the tell (`weight: 1.2/1.5`) may have other silent drift. ~1 hr.
- **A3.** Decide + execute on re-running previously "Partial" analyses (pending separately).

### Wave B — The missing audit category: prompt↔schema value-contract verification
- **B1.** Script: extract every explicit numeric-range annotation from prompt files (regex for
  `(N-M)`/`(N–M)` patterns) and cross-reference against the corresponding Zod field's
  `.min()`/`.max()`. Flag mismatches automatically, not by hand. ~1 day.
- **B2.** For fields with no explicit prompt annotation, sample real production
  `analysis_payload` rows (not test fixtures) and check observed value ranges against schema
  bounds — a field whose observed max sits exactly at the schema's declared max is a signal of
  either silent clipping or an undiscovered second instance of this bug class. ~1 day.
- **B3.** Wire B1 into CI (a real, permanent gate) so a future prompt edit or schema edit can't
  silently drift apart again without this being a one-time cleanup. ~0.5-1 day.

### Wave C — Contract-test fixture integrity (same drift risk, wider surface)
- **C1.** Audit all five `web/lib/__tests__/contracts/*.test.ts` suites' hand-authored fixture
  literals against the schemas they're meant to validate against — any fixture value that would
  fail today's real schema is itself a live signal of an undiscovered mismatch or a fixture that
  went stale after a later schema change. ~1-2 days across all suites.

### Wave D — Settings-schema centralization (the structural ask)
This is the larger, multi-day initiative behind the question, separate from the bug itself:
- **D1.** Inventory every hardcoded contract-relevant literal across `validators/`, `prompts/`,
  and UI-normalization code — numeric ranges, enums, length limits, TTLs, cascade orders — into
  a single manifest. ~1 day.
- **D2.** Design the settings-schema extension: for each manifest entry, assign an owner
  (system-fixed constant / admin-configurable / user-preference) per the rights-matrix model,
  and which page it should surface on (admin/user/system). ~1-2 days design.
- **D3.** Migrate literals into the settings schema in priority order — start with anything that
  has a natural-language "contract" documented in a prompt, since that's exactly the class that
  just caused a real incident. Ship incrementally, not as one big-bang migration. ~3-5 days.
- **D4.** Build the actual settings UI surfaces so values are visible/inspectable in one place,
  per the "open the settings page and see everything" requirement. ~2-3 days, scope depends on D2.

---

## 7. Bottom line

Waves A/B/C are the direct, proportionate response to tonight's specific finding — mechanical,
high-confidence, a few days total. Wave D is the real structural initiative (settings-as-truth +
rights matrix) that's been circling for a while; it's not a bug fix, it's its own multi-week
initiative and deserves its own kickoff rather than being squeezed in as a tail task on tonight's
incident. B1 (the automated prompt↔schema cross-check script) is the highest-leverage next step
if the goal is preventing a repeat of exactly this failure mode before Wave D lands.
