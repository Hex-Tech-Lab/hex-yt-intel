# ADR 039: Phase C Sensor Fusion Engine & Resilient A/V Probing

**Status:** Accepted
**Context:** Text-only structural classification (Phase B) degraded to 57% agreement due to semantic hallucination (e.g., misclassifying informal monologues as vlogs). To achieve deterministic S1-S6 routing, the system will aggregate acoustic metadata, visual cues, and semantic text heuristics.

### 1. Architectural Decisions

*   **1.1 The Sensor Fusion Matrix:** We abandon raw-text LLM classification for structural topology. We aggregate three signals: (1) Diarization Metadata (speaker count, turn entropy), (2) Text Heuristics (semantic intensity scores and literal turn markers), and (3) Multimodal Probes (visual UI detection, acoustic debate prosody). `routeFusion` uses deterministic overrides, pre-rules, and weighted scoring to evaluate this metadata JSON and output a strict S1-S6 Choice.
*   **1.2 Resilient Ephemeral Storage (Legal Firewall):** To survive network drops without violating YouTube ToS or Copyright, `yt-dlp` extracts will be written to a Cloudflare R2 bucket (`vintel-ephemeral-probes`) with a strict **24-hour Object Lifecycle TTL**. QStash will manage the async extraction/analysis queue. Workers will explicitly delete the R2 object immediately upon metadata extraction (early GC).
*   **1.3 Dynamic Duration-Based Sampling:** We abandon static 5-segment probes. The sampler duration clamps to 3-15 chunks, with exactly 1 chunk if video duration is under 16s. Samples are distributed evenly, excluding the first and last 3%.
*   **1.4 JEV-Driven Semantic Text Heuristics:** Complex Regular Expressions and brittle hardcoded array scanners are deprecated. JEV will be utilized as a strictly typed semantic NLP helper to extract heuristic intensity scores (e.g., direct address, procedural phrasing, tangential fluff) from text chunks. Purely typographic markers (e.g., `>>` speaker turns) will remain as simple literal string counts.
*   **1.5 Namespace Encapsulation:** All Phase C logic is strictly isolated in `worker/src/services/sensor-fusion/` (Sub-modules: `/probes`, `/heuristics`, `/matrix`).
