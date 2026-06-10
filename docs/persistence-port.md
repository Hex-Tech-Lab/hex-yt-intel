# PersistencePort Architecture Document

This document defines the responsibilities and contracts of the `PersistencePort` interface.

## Interface: `PersistencePort`

Handles all Supabase persistence for the `analyses` and `knowledge graph` related tables:
- Cache-hit lookup (SELECT with dimension validation)
- Processing stub upsert (UPSERT on user_id + video_id conflict)
- Analysis result persistence (Markdown + JSON payload)
- Knowledge Graph persistence (Entities + Relations)
- User history and analysis retrieval
- User tier management

Current implementation uses `getSupabaseServiceClient()` and direct `.from('analyses')` calls.

---

### Methods

#### `findCachedAnalysis`
- **Purpose**: Look up the most recent analysis for a given `userId` and `videoId`.
- **Behavior**: Returns `null` if no row exists or the markdown is empty/stub (fails to meet the 8-dimension validation gate). The dimension count threshold (8) matches the worker's `validate12D` gate.
- **Parameters**: 
  - `userId`: string
  - `videoId`: string
- **Returns**: `Promise<CachedAnalysis | null>`

#### `upsertProcessingStub`
- **Purpose**: Upsert a processing stub row.
- **Behavior**: Uses `ON CONFLICT (user_id, video_id)` so re-analysis of the same video reuses the existing row instead of causing a unique constraint violation (error 23505).
- **Throws**: When the upsert fails (caller must refund the user quota).
- **Parameters**:
  - `videoId`: string
  - `userId`: string
  - `title`: string
  - `validationReport`: `ValidationReportInput`
- **Returns**: `Promise<AnalysisStub>`

#### `persistAnalysis`
- **Purpose**: Persist the final analysis result after worker completion.
- **Behavior**: Updates the analysis row with the markdown, payload, and validation status. Automatically calls `persistKnowledgeGraph` if KG data is present in the payload.
- **Parameters**:
  - `analysisId`: string
  - `analysisPayload`: `UCISPayloadV2 | null`
  - `analysisMarkdown`: string
  - `validationPassed`: boolean
- **Returns**: `Promise<void>`

#### `getUserHistory`
- **Purpose**: Fetch analysis history for the user. Limits to 50 items.
- **Parameters**:
  - `params`:
    - `userId`: string
- **Returns**: `Promise<Array<{ id: string; videoId: string; title: string; createdAt: string; status: 'completed' | 'processing' | 'incomplete' }>>`

#### `findAnalysisById`
- **Purpose**: Look up a single analysis by its ID and userId.
- **Parameters**:
  - `params`:
    - `userId`: string
    - `analysisId`: string
- **Returns**: `Promise<{ id: string; title: string; videoId: string; analysisMarkdown: string; createdAt: string } | null>`

#### `updateUserTier`
- **Purpose**: Update the user subscription tier.
- **Parameters**:
  - `params`:
    - `userId`: string
    - `tier`: 'pro' | 'free'
- **Returns**: `Promise<void>`

#### `findAnalysisForPersist`
- **Purpose**: Find analysis row for server-to-server persistence lookup (used by `/api/analyses/persist`).
- **Parameters**:
  - `params`:
    - `analysisId`: string
    - `videoId`: string
- **Returns**: `Promise<{ id: string; userId: string; title: string; validationReport: unknown; createdAt: string } | null>`

#### `updateAnalysisResult`
- **Purpose**: Update the analysis row with the final reasoning results and metadata.
- **Parameters**:
  - `params`:
    - `analysisId`: string
    - `markdown`: string
    - `payload`: `UCISPayloadV2 | null`
    - `model`: string | null
    - `validationPassed`: boolean
    - `validationReport`: unknown
- **Returns**: `Promise<void>`

#### `persistKnowledgeGraph`
- **Purpose**: Atomic persistence of extracted entities and relations.
- **Behavior**: Deletes existing KG data for the analysis before inserting new nodes and edges. Validates deletions and ensures referential integrity between entities and relations.
- **Parameters**:
  - `params`:
    - `analysisId`: string
    - `entities`: Array<{ label: string; type: string; weight: number }>
    - `relations`: Array<{ source: string; target: string; relation: string; strength: number }>
- **Returns**: `Promise<void>`

#### `getKnowledgeGraph`
- **Purpose**: Retrieve the Knowledge Graph structure for an analysis.
- **Parameters**:
  - `analysisId`: string
- **Returns**: `Promise<{ entities: Array<{ id: string; label: string; type: string; weight: number }>; relations: Array<{ source_entity_id: string; target_entity_id: string; relation_label: string; strength: number }> } | null>`
