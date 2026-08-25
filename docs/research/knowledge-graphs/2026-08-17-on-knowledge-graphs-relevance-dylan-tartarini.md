# On Knowledge Graphs and their relevance (+ companion repo)

**Author**: Dylan Tartarini, Medium (2025-03-24), plus his open-source companion repo (`DylanTartarini1996/knowledge-graphs`, GitHub) — both retrieved in full via Exa.

## What it covers

General KG/GraphRAG relevance piece, paired with a real working repo implementing 5 distinct retrieval strategies over a knowledge graph.

## Directly useful: a real, concrete comparison table of retrieval strategies

The companion repo documents 5 real strategies with tradeoffs (token usage, latency, when each wins) — the most concrete, decision-ready material found on "how do you actually query a KG once it exists," which none of the more theoretical articles covered:

| Strategy | What it does | Token cost | Latency | When it wins |
|---|---|---|---|---|
| `answer_with_cypher` | Pure graph-query chain, no vector search | Medium | Low | Best when the graph schema is well-defined |
| `answer_with_context` | Vanilla vector RAG, optional adjacent-chunk graph lookup | Low | Low | Depends entirely on chunk quality |
| `answer_with_community_reports` | Queries community-report + chunk indexes together | Medium | Low/Medium | Enhanced similarity search |
| `answer_with_community_subgraph` | Reads community reports → fetches chunks → follows MENTIONS → fetches subgraph → reconciler agent decides | High | Medium | Can get "chaotic" per the author's own note — most complex, not always best |
| `answer` (combined) | Vector search + Cypher queries, synthesized together | High | High | "Generally the best (most on point)" per the author, but "might get complicated for smaller models to handle" |

**Directly relevant finding**: the author's own explicit tradeoff note — the most thorough strategy is also explicitly flagged as risky for smaller models ("might get complicated... to handle the complexity"). Directly relevant to the chat-cascade escalation design already in progress (pricing master model §6k/6j): a cheap/fast model (GPT-OSS-120B) attempting the most complex retrieval strategy is a real, named failure mode from a practitioner, not a hypothetical — reinforces that complexity of retrieval strategy and model capability tier should scale together, not be decided independently.

## Core relevance argument (nothing new, but a clean restatement)

"Vector similarity alone relies on explicit mentions... at the intra-document level, while representing Knowledge as graphs enables reasoning at a global dataset level (inter-document level)." This is the cleanest one-line version of the "graph vs. vector" distinction found across all researched articles — worth using as the canonical explanation if this needs stating simply later.
