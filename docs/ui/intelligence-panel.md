# Intelligence Panel

The `IntelligencePanel` provides a detailed view of the relationships within the knowledge graph.

## Sections
- **Graph Overview**: High-level statistics (nodes, edges) and the identified foundational dimension.
- **Node Intelligence**: When a node is selected, shows its lexical relations (Related, Similar, Tangent, Contrarian) and key terms.
- **Stance Intelligence**: Surfacing LLM-derived tensions and adjacent threads (`RelationInsight`).

## Component Structure
- **StanceSection**: Renders `RelationInsight` cards with specific styling for tangent vs contrarian kinds.
- **Card**: Generic container for relation lists.
- **StrengthBar**: Visual indicator of relationship strength (lexical).
- **RefRow**: Row item for lexical relations, allowing navigation to related nodes.
