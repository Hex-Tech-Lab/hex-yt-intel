# PersistencePort Architecture Document

This document defines the responsibilities and contracts of the `PersistencePort` interface.

## Interface: `PersistencePort`

Handles all Supabase persistence for the `analyses` table:
- Cache-hit lookup (SELECT with dimension validation)
- Processing stub upsert (UPSERT on user_id + video_id conflict)

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
- **Behavior**: Updates the analysis row with the markdown, payload, and validation status.
- **Parameters**:
  - `analysisId`: string
  - `analysisPayload`: `UCISPayloadV2 | null`
  - `analysisMarkdown`: string
  - `validationPassed`: boolean
- **Returns**: `Promise<void>`
