# Agentic Knowledge Graphs / Agent Memory (3 combined articles)

**Sources**: Andrea Belvedere, "Agentic Knowledge Graphs: why Graphs are becoming the memory layer of AI Agents" (Medium, 2026-07-26); Alexander Shereshevsky, "Why AI Agents Need Ontologies — and Graphs to Store Them" (Graph Praxis, Medium, 2026-02-07, found as a bonus while researching Belvedere's piece — same theme, different author, cites a real 200+ work academic survey); Vishal Mysore, "Agentic Knowledge Graphs as a Communication Protocol Between AI Agents" (Medium, 2026-03-17, bonus find). Combined into one file — all three converge on the same core claim from different angles.
**Relevance to hex-yt-intel**: the future Atlas/cross-video second-brain vision, not current-scope work.

## The converging real claim across all three

**Ontology-structured graphs beat flat/vector-only memory specifically for agents that need to reason across sessions, not just answer one question.** Shereshevsky's piece cites a real academic source (a 200+ work survey from Hong Kong Polytechnic University) distinguishing **knowledge memory** (stable, ontological — "the scaffolding") from **experience memory** (dynamic, instance-level — "what actually happened"). Direct quote: "without the ontological layer, experience memory is just a log." This maps cleanly onto our own existing POLE+O (ontology/knowledge memory) vs. `kg_entities` (instance/experience memory) split — third and fourth independent sources now confirming the same architectural pattern already adopted in ADR-027.

## When an agentic KG is actually justified (Belvedere's explicit gate)

Direct, useful checklist — an Agentic Knowledge Graph "makes sense when at least one of these conditions is true": relationships between entities are central to the task, multiple agents need shared state/coordination, or long-horizon memory across many sessions matters. **None of these currently apply to hex-yt-intel's per-video chat** (single session, single agent, bounded corpus) — consistent with the already-established finding that the current chat design correctly doesn't need this. They would start applying once Atlas (cross-video, persistent, potentially multi-agent) is real.

## A genuinely new, concrete idea worth flagging: graphs as agent-to-agent communication, not just storage

Mysore's piece describes a different pattern than the others — **ephemeral, per-reasoning-cycle subgraphs exchanged between agents as the actual communication medium**, not persisted knowledge. Agents "extend nodes, add edges, annotate risk" on a shared graph instead of exchanging prose; disagreement becomes visible as graph topology (e.g., two agents attaching conflicting confidence weights to the same edge) rather than buried in text. **Not directly applicable to hex-yt-intel today** (no multi-agent orchestration in the current pipeline), but worth remembering if the worker's own multi-model cascade (LLMCascade, remediation, comments classification, etc.) is ever reframed as coordinating "agents" rather than independent calls — this is a real, named pattern for that scenario, not a hypothetical.

## Practical takeaway for Atlas planning (when it resumes)

Both Belvedere and Shereshevsky independently point at **Graphiti** (already recorded in ADR-027 from an earlier research pass) as the concrete, real implementation of "ontology-structured + temporal graph memory" — this is now confirmed by multiple independent sources as the most-cited real tool in this space, not a one-off mention. Worth treating as the default starting point to evaluate first when Atlas work resumes, rather than building from scratch.
