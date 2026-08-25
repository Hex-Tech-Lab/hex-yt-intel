# RAGraph Ontological Engine (ROE) — a real, working 3-layer hybrid reference architecture

**Sources**: Andrea Belvedere, "RAGraph Ontological Engine (ROE): Building a Hybrid Ontology-Driven Retrieval Engine for Technical Manuals" (Medium, 2026-06-30) and its real follow-up, "Someone Read My Article on ROE and Built a GraphRAG Engine Out of It. Here's What Happened" (2026-07-10) — the second documents an independent MIT-licensed reimplementation (TechRAG, github.com/FBR65/TechRAG) built by a reader, giving a genuine second real data point on the same architecture with different technology choices.
**Relevance to hex-yt-intel**: the most concrete, buildable reference architecture found in this whole research pass for the future Atlas/cross-video vision — more actionable than the more abstract "agentic KG" pieces.

## The architecture (real, working, two independent implementations)

Three complementary layers, combined at query time rather than any one replacing the others:
1. **Vector embeddings** (semantic search entry point)
2. **Domain ontology** (bootstrapped once from a sample of the corpus — directly analogous to our own tier-2 vocabulary generation plan)
3. **Knowledge graph** (entities as nodes, relationships as edges, extracted statements as "atomic facts" with source back-references)

At query time: vector search finds candidate chunks → the system extracts relevant semantic concepts from the query+chunks → graph context is expanded **with hard caps** (original ROE: ≤10 atomic facts, ≤24 nodes, ≤18 relationships, ≤12 paths) → everything is assembled into a compact context bundle, never the whole graph.

## The single most concrete, reusable number: hard caps on graph context injected per query

This is real, load-bearing detail neither the more theoretical articles nor our own chat-cascade design work has specified yet: **bound how much graph context gets pulled into any one LLM call, explicitly, with real numbers** (≤10 facts / ≤24 nodes / ≤18 edges / ≤12 paths in ROE's case). Directly relevant to the Atlas design once it starts — "how much of the graph do we inject per query" is a real, concrete decision this reference architecture already made and validated in production use, not something to invent from scratch.

## The independent reimplementation is the most valuable part

TechRAG (the reader's reimplementation) proves the architecture is **portable across completely different tech stacks**: original ROE used Neo4j + Qdrant + MongoDB + Docker; TechRAG replaced all of it with SQLite + LanceDB + a novel "SQLGraph" pattern (**modeling graph nodes/edges as plain relational tables, queried via SQL JOINs and a Python BFS traversal — no dedicated graph database at all**) and a model 17x smaller (7B vs 120B parameters), with comparable real results (263 entities, 213 facts extracted from a 50-chunk test PDF, `evidence_coverage=0.6`).

**Directly relevant to hex-yt-intel**: we already use this exact "graph modeled in a relational database" pattern (`kg_entities`/`kg_relations` in Postgres, not a dedicated graph database) — this is real, independent, working confirmation that the SQLGraph approach is a legitimate, production-viable choice, not a compromise forced by not having "a real graph database." Directly rebuts the more RDF/OWL-evangelist position found in a different researched article (Niklas Emegård's piece, see the Doil Kim research file) that argues labeled-property-graph-without-formal-ontology approaches are inadequate — here is a real, working counter-example with quantified results.

## Author's own reflection, worth carrying forward as project guidance

Belvedere's own conclusion from watching his architecture get reimplemented: "sometimes the simpler choice... is the right one to start with... it made me reflect on how often, as developers, we tend to over-engineer infrastructure when the problem we're solving doesn't require it." A real, first-person confirmation of the same "don't over-scope" principle already independently found across multiple other sources in this research pass (Thoughtworks' competency-questions gate, Doil Kim's "start where the value justifies the cost").
