# ChatPersistencePort Architecture Document

This document defines the responsibilities and contracts of the `ChatPersistencePort` interface.

## Interface: `ChatPersistencePort`

Handles all database operations for chat threads and messages, isolating the chat domains from the database engine.

---

### Methods

#### `getConversations`
- **Purpose**: List conversations for a user.
- **Parameters**:
  - `userId`: string
- **Returns**: `Promise<ChatConversation[]>`

#### `createConversation`
- **Purpose**: Start a new chat conversation.
- **Parameters**:
  - `params`:
    - `userId`: string
    - `analysisId`: string | null
    - `title`: string
- **Returns**: `Promise<ChatConversation>`

#### `getConversation`
- **Purpose**: Retrieve a single conversation.
- **Parameters**:
  - `params`:
    - `conversationId`: string
- **Returns**: `Promise<ChatConversation | null>`

#### `updateConversationTitle`
- **Purpose**: Update the title of a conversation.
- **Parameters**:
  - `params`:
    - `conversationId`: string
    - `title`: string
- **Returns**: `Promise<void>`

#### `getMessages`
- **Purpose**: Load history/messages for a thread.
- **Parameters**:
  - `params`:
    - `conversationId`: string
- **Returns**: `Promise<ChatMessage[]>`

#### `findMessageByClientMsgId`
- **Purpose**: Look up a message by its client-side unique identifier (for idempotency).
- **Parameters**:
  - `params`:
    - `conversationId`: string
    - `clientMsgId`: string
- **Returns**: `Promise<ChatMessage | null>`

#### `createMessage`
- **Purpose**: Persist a new message in a conversation.
- **Parameters**:
  - `params`:
    - `conversationId`: string
    - `userId`: string
    - `role`: 'user' | 'assistant'
    - `content`: string
    - `clientMsgId`?: string | null
- **Returns**: `Promise<ChatMessage>`

#### `findAssistantMessageAfter`
- **Purpose**: Find the first assistant message following a specific timestamp (used for idempotent retry logic).
- **Parameters**:
  - `params`:
    - `conversationId`: string
    - `timestamp`: string
- **Returns**: `Promise<ChatMessage | null>`

#### `getAnalysisGrounding`
- **Purpose**: Retrieve the analysis markdown and status for grounding a chat conversation.
- **Parameters**:
  - `params`:
    - `analysisId`: string
- **Returns**: `Promise<{ title: string; channelTitle: string | null; analysisMarkdown: string | null; status: string } | null>`
