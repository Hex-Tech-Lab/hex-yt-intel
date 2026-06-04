# Stance Relations Engine

The stance relations engine is the LLM-backed intelligence layer of the knowledge graph. 

## Relationships
- **Tangent**: Dimension A opens an adjacent thread that dimension B leaves unresolved or pulls away from (novel/divergent, not opposed).
- **Contrarian**: Dimensions A and B sit in genuine tension — a claim vs a risk/limitation/counter-point.

## Implementation
Related and Similar relationships stay lexical (using TF-IDF), while Tangent and Contrarian are judged by fast, non-reasoning models (Gemini Flash, Nemotron). The engine is computed post-analysis and results are cached.

Currently, the candidate set is restricted to intra-analysis (within the same video's dimensions). Future corpus expansion will widen the search to cross-corpus neighbors.
