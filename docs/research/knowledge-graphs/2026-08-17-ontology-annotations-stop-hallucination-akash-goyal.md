# How Ontologies and Graphs Stop LLMs from Hallucinating using Annotations

**Author**: Akash Goyal, Medium (2026-02-17) — full content retrieved via Exa (much richer than the snippet found in an earlier, shallower pass this session).
**Relevance to hex-yt-intel**: a concrete, code-level technique for the future chat-grounding hallucination-reduction enhancement already flagged in ADR-027 (currently theoretical there — this makes it concrete).

## The concrete technique: verbalization templates attached to relationship types, not just entity grounding

The core, genuinely useful idea, more specific than the general "grounding reduces hallucination" claim already recorded: **attach a fixed natural-language template directly to each relationship TYPE in the ontology**, e.g. the relationship `worksAt` carries an annotation `"[Subject] is employed by [Object]"`. When the system needs to describe that relationship in prose, it fills the template rather than letting the LLM freely phrase it — eliminating the specific hallucination mode where an LLM subtly shifts meaning while paraphrasing a true fact ("Alice works hard at TechCorp" vs. "Alice is employed by TechCorp" — same underlying fact, different and potentially misleading connotation).

## The 3-node verify pattern (real, implemented in LangGraph, code shown in the article)

1. **Retrieve** (neural) — fetch the relevant graph data.
2. **Enrich** (symbolic/lookup) — fetch the ontology's verbalization template for whatever relationship type was retrieved.
3. **Generate** (neural, template-constrained) — fill the template rather than freely generating prose.
4. **Verify** (symbolic, non-neural) — a plain Python check confirms every entity named in the generated text actually exists in the source data before the output is returned.

**Why this is more concrete than our current chat-grounding approach**: ADR 008's existing chat-grounding design constrains the LLM's *source material* (grounded only in the analysis), but doesn't constrain *how relationships get phrased* once retrieved. This technique adds a second, narrower layer — not just "don't invent facts" but "don't even paraphrase a real relationship in a way that shifts its meaning."

## Direct relevance and a real scoping caveat

This is real, implementable, and not expensive (the verification step is plain Python, not another LLM call) — but it requires the ontology to define verbalization templates per relationship *type*, which only exists once tier-2/relationship-type work is real (post-Council, per ADR-027's existing Phase 2 gating). **Not actionable before Phase 2's tier-2 vocabulary exists** — but worth designing the tier-2 schema with a `verbalizationTemplate`-style field from the start, so this hallucination-reduction technique doesn't require a schema migration later when it's eventually built. A cheap, real "build it right the first time" consideration to carry into the Phase 2 vocabulary schema design.
