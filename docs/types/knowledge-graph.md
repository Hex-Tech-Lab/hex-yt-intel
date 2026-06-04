# Knowledge Graph Domain Types

This document describes the data model for the YouTube Synthesis Knowledge Graph.

## Core Concepts
- **GraphNode**: A dimension rendered as a node. Includes weight, polarity, and key terms.
- **GraphEdge**: A weighted, typed relationship between dimensions.
- **RelationKind**:
  - `similar`: near-duplicate framing.
  - `related`: shares core concepts.
  - `tangent`: adjacent but divergent.
  - `contrarian`: topically connected but opposite polarity.

## Stance Relations (LLM-Derived)
- **RelationInsight**: Judged by a model (tangent vs contrarian).
- **RelationsResult**: Cached output of the stance relations engine.
