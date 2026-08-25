# Advanced/tangential: Causal Inference on KGs + Bayesian Knowledge Graphs

**Sources**: Alexander Shereshevsky, "Causal Inference on Knowledge Graphs: The Fourth Layer of Context Blindness" (Graph Praxis, Medium, 2026-04-25); Sixing Huang, "DuckBay: The Bayesian Knowledge Graph App" (Medium, 2026-04-23, plus real MIT-licensed companion repo `dgg32/gemini_bayesian`). Both retrieved in full via Exa. Honest assessment upfront: **both are real and sophisticated, but low near-term relevance to hex-yt-intel** — logged for completeness per the staggered-progressive method, not because either changes a current decision.

## Causal Inference on KGs — real, sophisticated, but the wrong shape for our use case

Real, rigorous framework extending ontology-grounded GraphRAG with causal semantics (Judea Pearl's ladder: association → intervention → counterfactual), including a working `DO()` Cypher extension implemented in FalkorDB. The core distinction: a normal knowledge graph records that entities *co-occur or relate*; a causal knowledge graph records that changing one *would change* another, with typed `CAUSES` edges carrying mechanism/strength/confidence metadata.

**Why this doesn't apply to hex-yt-intel today**: this framework is explicitly built for **agents that act in the world and need to predict intervention outcomes** ("if we do X, what happens to Y" — e.g., an agent deciding whether to send a marketing email and needing to predict the effect). hex-yt-intel's entity extraction is descriptive (what does this video discuss, who/what is mentioned), not an acting agent making interventions whose effects need modeling. No current or near-term feature (time-seek, digest, chat, even the future Atlas as currently envisioned) has this "predict the effect of an action" shape. Flagged as real and worth knowing exists, not as something to build toward.

## DuckBay — real, working, elegant single-storage pattern, wrong domain

A real, working system (MIT-licensed, tested against a real 70-node/123-edge clinical Bayesian network) unifying knowledge-graph storage and Bayesian-network probabilistic inference in a single DuckDB file, avoiding the "constant format conversion between tools" problem of the author's earlier prototype. Real, reusable architectural idea (single storage engine, multiple query/view modes over the same data) — but Bayesian conditional-probability networks aren't a natural fit for our entity/relationship data (we don't have conditional-probability relationships between entities in mind, e.g. "P(mentioned concept X | mentioned concept Y)"). Interesting for cross-domain awareness, not directly actionable.

## Why these are logged rather than deep-dived further

Per the staggered-progressive method: both are real signals worth having on record, but neither changes a near-term decision for hex-yt-intel, and going deeper on either (implementing causal edges or Bayesian inference) would be solving a problem this product doesn't currently have. Correctly deprioritized after the initial skim confirmed low direct relevance.
