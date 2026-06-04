# Dashboard Container

The `DashboardContainer` is the primary orchestrator for the analysis workflow.

## UI Sections
- **Analysis Hero**: Video URL input and analysis triggering.
- **Bento Metadata**: High-level video statistics.
- **Tab Bar**: Toggles between the **Synthesis Grid** (bento view of dimensions) and the **Knowledge Graph** (semantic relationship visualization).
- **Intelligence Panel**: Right-side panel surfacing relational insights and node-specific details.
- **Chat Dock**: Contextual AI chat interface.

## Behavior
- **Dimension Expansion**: Clicking a dimension card opens the `DimensionDrawer`.
- **Knowledge Graph**: Interactive force-directed graph showing lexical and stance relations.
- **History**: Allows restoration of past analysis sessions into the live state.
