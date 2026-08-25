# Synthesis: Knowledge Graph Strategy Research — Cross-Article Findings

**Purpose**: input material for a future LLM Council session on hex-yt-intel's knowledge-graph strategy (visualization quality now; tier-2 vocabulary + Atlas cross-video vision later). Synthesizes 10 real, individually-researched articles (see `docs/research/knowledge-graphs/2026-08-17-*.md`) plus the two files from the prior research pass (yFiles/Neo4j visualization; "when do you need a KG"). Not a book report — organized by decision-relevant theme, with explicit convergence/tension flagged.

**Method note**: all 10+ sources found via multi-engine search (Exa, Brave, Bright Data, Decodo, SerpAPI), most retrieved in full despite Medium's "member-only" gate — confirmed working repeatedly. A meaningful minority of the original ~25 titles were not individually deep-researched (see "Not yet researched" at the end) — staggered-progressive method applied: deep-dived where real signal appeared, logged as pointers where the title suggested lower relevance or time didn't allow full treatment.

---

## Theme 1: Our existing architecture is independently validated, not just convenient

**Convergence across 6+ independent sources** (Thoughtworks, dataarchitect.studio, Thilo Hermann, Doil Kim, Shereshevsky's agent-memory survey citation, XMPro): the ontology (schema/meaning, "TBox") vs. knowledge graph (instance data, "ABox") split is standard, not a workaround. Doil Kim's "board game" analogy is the clearest plain-language version found: *the ontology is the design of a board game — pieces, legal moves, rules; the knowledge graph is the current game on the board.*

**This maps exactly onto hex-yt-intel's own architecture**: POLE+O (ontology/tier-1, ADR-027) vs. `kg_entities` (instance data). Independent confirmation, not coincidence.

**Also validated**: our Postgres-based `kg_entities`/`kg_relations` storage (not a dedicated graph database) is a real, production-proven pattern — TechRAG's "SQLGraph" reimplementation (nodes/edges as relational tables, SQL JOINs + Python BFS traversal) got comparable real results to a Neo4j-based original, at 17x smaller model size. Direct rebuttal to the one dissenting voice found (Niklas Emegård's RDF/OWL-evangelist piece, via the Doil Kim file) arguing labeled-property-graphs without formal RDF/OWL ontologies "aren't real knowledge graphs" — real, working counter-evidence exists, this is a genuine unsettled tension in the field, not a fringe opinion to dismiss, but not a reason to change our approach either.

## Theme 2: Scope discipline — converging from 4+ independent sources

**"Don't build ontology/graph infrastructure speculatively"** is the single most repeated finding across this entire research pass, from sources that don't cite each other:
- Thoughtworks: "make competency questions a funding gate — before anyone models a single class, ask the business to name the precise questions the system cannot answer today."
- Doil Kim: "start with domains where semantic precision and connected reasoning create enough value to justify the maintenance cost."
- Belvedere (ROE follow-up, watching his own architecture get reimplemented simpler): "sometimes the simpler choice is the right one to start with... we tend to over-engineer infrastructure when the problem doesn't require it."
- The "when do you need a KG" synthesis (prior pass): "a knowledge graph earns its cost only when specific conditions hold" — recurring multi-hop relational questions, provenance requirements, connections that matter *repeatedly*.

**Direct application already made**: this is why tier-2 vocabulary work stays scoped to KG-visualization-richness only (not applied to time-seek/digest, confirmed via direct code check they don't need it) — four independent sources now back this scoping decision, not just internal judgment.

## Theme 3: Visualization quality — the actionable-now work stream

From the yFiles/Neo4j piece (prior pass): **vary layout algorithm by what's being shown** — hierarchical for taxonomy depth, organic/force-directed for relationship clustering, circular for isolating small detected patterns. Real, concrete, unanswered question for KnowledgeGraphCanvas: should it switch layout when a user filters to one entity's connections vs. viewing everything?

Graphify (107k-star real tool, connected to this project's own `code-review-graph` tooling) independently confirms **deterministic structure-based rendering (no embeddings) can outperform vector-similarity approaches** when the domain has clear extractable structure — relevant validation for why our POLE+O-structured graph, done well, is a real asset worth polishing rather than replacing.

## Theme 4: Hallucination reduction — a concrete technique, not yet actionable

Akash Goyal's verbalization-template technique (attach a fixed phrasing template to each *relationship type* in the ontology, verify entity existence with plain Python before returning generated text) is genuinely more specific than "grounding helps" — it targets a specific hallucination mode (subtle meaning-shift during paraphrase). **Real, cheap to build, but gated on tier-2/relationship-type work existing first** — worth designing the eventual tier-2 schema with a `verbalizationTemplate`-style field from day one so this doesn't require a later migration.

## Theme 5: Agent memory / Atlas — real reference architectures, not just theory

**Graphiti** (Apache-2.0, Neo4j-backed, bi-temporal) is now confirmed by 3+ independent sources (this pass and the prior one) as the most-cited real starting point for cross-session agent memory — treat as the default first evaluation when Atlas work resumes, not a from-scratch build.

**ROE (RAGraph Ontological Engine)** is the most concrete, buildable 3-layer reference architecture found (vector + ontology + graph, with real hard caps on context injected per query — ≤10 facts/≤24 nodes/≤18 edges/≤12 paths in the original). Independently reimplemented by a reader with a completely different, simpler stack (SQLite/LanceDB vs. Neo4j/Qdrant/MongoDB) with comparable results — real evidence the *pattern* matters more than the specific tech stack, directly relevant given our own Postgres-based (not Neo4j) implementation.

**Genuinely new idea, not previously on record**: Mysore's "agentic KG as communication protocol" — ephemeral, per-reasoning-cycle subgraphs exchanged between agents instead of prose, making disagreement visible as graph topology. Not applicable to hex-yt-intel today (no multi-agent orchestration in the pipeline), but worth remembering if the worker's multi-model cascade is ever reframed as coordinating agents.

## Theme 6: Where the sources genuinely disagree — real tensions for the Council, not resolved here

1. **RDF/OWL formalism vs. lighter-weight labeled-property-graphs**: Emegård argues formal ontologies are necessary for "real" semantic reasoning; ROE/TechRAG and our own architecture prove lighter-weight approaches work in practice. Not resolved — a real methodological fork the field itself hasn't settled.
2. **How much retrieval complexity a given model tier can handle**: Dylan Tartarini's own repo documents his most thorough retrieval strategy as explicitly risky for smaller models ("might get complicated... to handle the complexity") — directly relevant to our GPT-OSS-120B/Haiku-4.5 chat-cascade tiering decision (pricing master model §6j/6k), a real, named constraint from a practitioner, not hypothetical.

## Not yet individually researched (titles logged, not deep-dived this pass)

"Stop Mixing CDM, Ontology, and Knowledge Graphs" (Thilo Hermann — substantively covered already, inline, in an earlier pass), "Knowledge Graph Basics for LLM Builders" (QuarkAndCode), "FORGET Loop Engineering" (Gao Dalie), "Documents to Knowledge Graphs: Enterprise GraphRAG" (QuarkAndCode), "How I Built a Microsoft Graph RAG System" (Shweta Lodha — Brave rate-limited mid-fetch, not retried this pass), "How to Turn Any Network Into an Interactive Knowledge Graph" (Erdogan T), "I Built a Triplestore Knowledge Graph for Our System — V2" (Munaf). Genuinely deprioritized per the staggered-progressive method after strong convergent signal was already found across the 10 researched — not fetched due to time, not because they're judged irrelevant. Worth a follow-up pass if the Council session wants fuller coverage before convening.
