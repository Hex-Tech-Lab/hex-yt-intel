# CryptographicTokenPort Architecture Document

This document defines the responsibilities and contracts of the `CryptographicTokenPort` interface.

## Interface: `CryptographicTokenPort`

Handles signing streaming access tokens bound to video, analysis job, and resolved models list. It generates HMAC-signed streaming tokens bound to their respective IDs and models.

---

### Methods

#### `signAnalysisToken`
- **Purpose**: Mint an HMAC-signed streaming token bound to `videoId` + `analysisId` + `models`.
- **Parameters**:
  - `videoId`: string
  - `analysisId`: string
  - `models`: string[]
- **Returns**: `StreamToken`

#### `signChatToken`
- **Purpose**: Mint an HMAC-signed chat token bound to `conversationId` + `userId` + `models`.
- **Parameters**:
  - `conversationId`: string
  - `userId`: string
  - `models`: string[]
- **Returns**: `StreamToken`
