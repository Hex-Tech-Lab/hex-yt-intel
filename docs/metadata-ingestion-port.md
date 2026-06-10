# MetadataIngestionPort Architecture Document

This document defines the responsibilities and contracts of the `MetadataIngestionPort` interface.

## Interface: `MetadataIngestionPort`

Handles the retrieval of video metadata and transcripts, and automated persona detection.

---

### Methods

#### `fetch`
- **Purpose**: Fetch video metadata and transcript.
- **Parameters**:
  - `videoId`: string
- **Returns**: `Promise<IngestionResult>`

#### `detectPersona`
- **Purpose**: Detect the target persona from video details.
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

---

## Implementation Details

Implementation specific details such as parallel fetching, transcript availability logic, and quota-refund behavior are managed by the `WorkerIngestionAdapter` and the corresponding Use Cases.
