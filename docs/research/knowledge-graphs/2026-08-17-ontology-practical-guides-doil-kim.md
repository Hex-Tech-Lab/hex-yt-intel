# Doil Kim's two-part practical ontology/KG series ("Knowledge Graphs in the LLM Era" + "Ontology Made Practical")

**Author**: Doil Kim, Medium, July 2026 — full content retrieved via Exa despite the paywall gate. Two articles by the same author, same theme, combined into one file since they're a matched pair (the first motivates the problem with a financial-data example — NVIDIA/NVDA/ISIN identifier fragmentation; the second is the technical deep-dive on the RDF/OWL/SHACL stack that solves it).

## What it covers

A practitioner-level walkthrough of the full Semantic Web ontology stack (IRI/namespace → RDF triples → RDFS → OWL → SHACL), built around one running financial example (Vanguard's VOO ETF). Not YouTube/video-specific — general enterprise-ontology engineering.

## Directly relevant: the "board game" framing and the explicit "do you always need this" gate

The clearest single explanation found across all articles this session for the ontology-vs-KG distinction: **"an ontology is the design of a board game — it defines the pieces, the legal moves, and the rules. The knowledge graph is the current game on the board."** Cleaner than the TBox/ABox framing already recorded (from the earlier research pass) for non-technical explanation purposes — worth using this analogy if the taxonomy decision ever needs explaining to a non-engineer.

**Real, directly reinforcing finding**: "The practical rule is simple: start with domains where semantic precision and connected reasoning create enough value to justify the maintenance cost." This is the same conclusion already reached independently in this project (tier-2 vocabulary scoped to KG visualization only, not applied speculatively elsewhere) — third independent source now converging on the same "don't over-scope" principle.

**Competency-questions-first workflow**, described in more operational detail than the earlier Thoughtworks source: "design from the questions backward" — write the real questions the system needs to answer before modeling a single class. Same principle already adopted, now with a named methodology to point to.

## Not directly applicable, but worth knowing exists

The full RDF/RDFS/OWL/SHACL stack described here is the *formal* Semantic Web approach — heavier than what this project uses (Postgres + POLE+O CHECK constraints, not RDF triples or SPARQL). Not a recommendation to adopt this stack; flagged because a related, more opinionated article (found in the same search pass, see below) argues this heavier approach is *necessary* for "real" semantic reasoning — a real tension worth the Council/team being aware of, not a settled question.

## Related tension found in the same search pass (bonus, not on the original title list)

**Niklas Emegård, "After seeing yet another Graph RAG demo using Neo4j with no ontology..."** (Medium, 2025-11-25) — a real, technically substantive, opinionated piece arguing that Neo4j-style labeled-property-graph (LPG) systems without formal RDF/OWL ontologies are "just a graph database with fancy labels," not real semantic knowledge graphs. Direct quote: "without formal ontologies, you don't have a knowledge graph — you just have a graph database with fancy labels." This is a real dissenting view against the lighter-weight approach this project and most of the other researched articles favor — worth surfacing to the Council as a genuine counter-position, not filtering it out because it's inconvenient. Our own architecture (Postgres CHECK-constraint-enforced POLE+O, not RDF/OWL) is exactly the kind of "LPG with labels" this article critiques. Counter-consideration: this article's own example (a "Jaguar Problem" — disambiguating the animal from cars/guitars) is a genuinely hard entity-disambiguation case that may not represent our actual use case (an already-transcript-grounded, single-video-scoped extraction, not an open, ambiguous multi-source corpus) — the critique may apply more to open-world knowledge integration than to our bounded, per-video extraction problem. Flagged for the Council to weigh, not resolved here.
