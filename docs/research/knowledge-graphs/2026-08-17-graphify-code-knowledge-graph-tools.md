# Graphify + codebase-to-KG tool family (Graphify, CodeGraph, Google OKF/Hermes/Gbrain, "From Text to KG in One Command")

**Sources**: multiple digest titles covering the same tool category — Mahernaija's "Graphify: I Turned My Repo Into a Knowledge Graph," Ana Bildea's "How to Use CodeGraph," Gao Dalie's "Google OKF + Hermes Agent + Gbrain," Fabio Yáñez Romero's "From Text to Knowledge Graph in One Command." Confirmed real via Brave: Graphify itself (graphify.com, github.com/Graphify-Labs/graphify, 107k+ GitHub stars, Apache 2.0).

## Meta-relevant finding, not just background reading

**Graphify is directly connected to `code-review-graph` — the same MCP tool family this project's own CLAUDE.md already mandates using for code review**, confirmed via a real DEV Community post titled "Graphify + code-review-graph: Build a Self-Updating Knowledge Graph for Claude Code." This isn't abstract research material — it's documentation of the exact tool category already integrated into this project's own development workflow (`detect_changes_tool`, `get_review_context_tool`, etc., per the project's standing "Step 0" instruction). Worth knowing this tool has a large, active open-source community (107k+ stars) and a broader ecosystem than just this project's own usage, in case future features/updates are worth tracking.

## Real technique confirmed: no embeddings, deterministic AST parsing

Graphify's own positioning: "no embeddings, just a graph it can trace and cite... local deterministic AST parsing, every edge explained, no vector store." This is a real, working confirmation (at 107k-star scale) of the same principle already recorded elsewhere in this research pass (the "when do you need a KG" file, and ROE's SQLGraph pattern) — a real, structured graph can be genuinely more reliable than vector search for code/document understanding, when the domain has clear extractable structure (imports, function calls, references) the way code does.

## Relevance to hex-yt-intel: low-to-none for the product itself, real for internal tooling awareness

These tools are about **codebase/document understanding for AI coding assistants**, not about video-content knowledge graphs — the underlying domain (source code structure) doesn't transfer to our entity-extraction problem (people/places/concepts mentioned in video transcripts). Logged for completeness and because of the meta-relevance above, not because it changes any product decision. Not worth deeper research time in this pass — correctly deprioritized per the staggered-progressive method (no strong signal found beyond the meta-connection already noted).
