# MetadataIngestionPort Architecture Document

This document defines the responsibilities and contracts of the `MetadataIngestionPort` interface.

## Interface: `MetadataIngestionPort`

Handles only the retrieval of video metadata and transcripts, and persona detection.

---

### Methods

#### `fetch`
- **Purpose**: Fetch video metadata and transcript in parallel.
- **Behavior**: Returns an `IngestionResult` where the transcript may be empty.
- **Throws**: When the metadata fetch fails (caller must refund user quota).
- **Parameters**:
  - `videoId`: string
- **Returns**: `Promise<IngestionResult>`

#### `detectPersona`
- **Purpose**: Detect the target persona from video title + channel, or use the explicit override.
- **Parameters**:
  - `params`:
    - `title`: string
    - `channelTitle`: string
    - `explicitPersona`?: `PersonaId`
- **Returns**: `PersonaId`

#### `buildJobMetadata`
- **Purpose**: Build the canonical `AnalysisJobMetadata` from raw video metadata.
- **Parameters**:
  - `metadata`: `VideoMetadata`
- **Returns**: `AnalysisJobMetadata`
