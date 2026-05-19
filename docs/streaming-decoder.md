# Unified SSE Streaming Decoder Architecture

**Location**: `web/lib/streaming/decoder.ts`  
**Version**: 2.0.0  
**Build**: feat/three-strikes-qstash-zustand-graphql  
**Timestamp**: Tuesday, 19 May 2026 at 2:25 PM EEST  
**Purpose**: Normalize Server-Sent Events (SSE) token extraction with guaranteed tail buffer processing and defensive malformed-chunk handling

---

## Architecture Overview

The streaming decoder provides a unified pipeline for consuming SSE responses from OpenRouter API calls. It guarantees that **no tokens are dropped** even if the stream ends with an incomplete line in the buffer, and it handles malformed JSON chunks defensively without crashing the client runtime.

### Key Design Principles

1. **Complete Tail Processing**: When the stream ends (`done=true`), any remaining data in the buffer is processed before the pipeline closes. This prevents data loss from final incomplete lines.

2. **Defensive Parsing**: Malformed JSON lines are caught and reported to Sentry without terminating the stream. Logging provides full observability without hard failures.

3. **Explicit Error Phases**: Errors are categorized as either `parse` (malformed JSON) or `read` (network/stream issues), allowing consumers to handle each phase appropriately.

4. **Zero Token Drops**: By explicitly processing the final buffer contents after `done=true`, we guarantee that the last token from the model is captured even if it arrives without a trailing newline.

---

## Public API

### `parseSSELine(line: string): string | null`

Parses a single SSE line and extracts the token.

**Parameters**:
- `line` (string): Raw text line from the stream (e.g., `"data: {...JSON...}"`)

**Returns**:
- `string`: Extracted token (non-null if valid data line)
- `null`: Line is empty, not a data line, or is a completion marker (`[DONE]`)
- **Throws**: `SyntaxError` if JSON is malformed

**Behavior**:
1. Trim whitespace
2. Return `null` if line is empty or doesn't start with `"data: "`
3. Return `null` if line is the completion marker `"data: [DONE]"`
4. Parse JSON from `line.substring(6)` (skips `"data: "` prefix)
5. Extract token from `json.choices[0].delta.content` or `json.choices[0].text`
6. Throw `SyntaxError` if JSON parsing fails

**Example**:
```typescript
parseSSELine('data: {"choices":[{"delta":{"content":"hello"}}]}')
// → "hello"

parseSSELine('data: [DONE]')
// → null

parseSSELine('data: {invalid}')
// → throws SyntaxError
```

---

### `consumeSSEStream(reader, onToken, onError?): Promise<void>`

Unified streaming decoder: consumes a `ReadableStream`, processes all tokens including the final incomplete line, and guarantees complete buffer drain.

**Parameters**:
- `reader` (ReadableStreamDefaultReader<Uint8Array>): Response body reader from `fetch`
- `onToken` (function): Callback invoked for each parsed token: `(token: string) => void`
- `onError` (function, optional): Callback for parse/read errors: `(error: Error, phase: 'parse' | 'read') => void`
  - If not provided, errors are rethrown
  - `phase: 'parse'` = malformed JSON line (non-fatal, logged as warning)
  - `phase: 'read'` = stream reading error (fatal, should terminate)

**Returns**: `Promise<void>` — resolves when stream is fully consumed and tail buffer is processed

**Behavior**:

1. **Initialize**: Create `TextDecoder` and empty buffer
2. **Loop**: Read chunks from the reader in a while-true loop
3. **Accumulate**: Append decoded chunk to buffer
4. **Process Lines**: Split buffer on `\n`, process complete lines, retain incomplete final line
5. **Parse Each Line**: Call `parseSSELine()` on each complete line, invoke `onToken()` if valid
6. **Handle Parse Errors**: If `parseSSELine()` throws, invoke `onError('parse')` if provided, else rethrow
7. **Check Stream Status**: If `done=false`, continue loop; if `done=true`, proceed to tail processing
8. **Tail Processing**: After stream closes, process any remaining buffer contents as the final line
9. **Final Cleanup**: Call `reader.cancel()` to release resources

**Invariants**:
- No tokens are dropped, even if the final token arrives without a trailing newline
- Parse errors do not terminate the stream unless `onError` rethrows
- The reader is always cancelled (via finally block) to prevent resource leaks

**Example Usage** (from `useAnalysisStore.ts`):

```typescript
let markdown = '';

await consumeSSEStream(
  reader,
  (token) => {
    markdown += token;
  },
  (error, phase) => {
    Sentry.captureException(error, {
      tags: { phase: `stream_${phase}` },
      level: phase === 'parse' ? 'warning' : 'error',
    });

    if (phase === 'read') {
      throw error;  // Fatal: propagate read errors
    }
  }
);

// At this point, `markdown` contains all tokens, including final incomplete lines
```

---

## Common Scenarios

### Scenario 1: Normal Stream Completion
```
Chunk 1: "data: {..."hello"}}\n"
Chunk 2: "data: {..."world"}}\n"
Chunk 3: "data: [DONE]"         ← No trailing \n
Buffer at done: ""
```

**Result**: Both "hello" and "world" are processed. The final `[DONE]` marker is processed as a line (and ignored because it matches the completion check).

### Scenario 2: Incomplete Final Token
```
Chunk 1: "data: {..."hello"}}\n"
Chunk 2: "data: {..."wor"
Stream ends (done=true)
Buffer at done: "data: {..."wor""
```

**Result**: 
1. First chunk processes normally, "hello" extracted
2. Second chunk appends to buffer: `"data: {...\"wor\""`
3. Split on `\n` produces empty lines array, buffer retains the incomplete line
4. Stream ends, tail processing invokes `parseSSELine("data: {...\"wor\"")`
5. JSON parse fails → `onError(SyntaxError, 'parse')` → Sentry logs warning
6. Stream closes without crashing

### Scenario 3: Multiple Chunks, No Final Newline
```
Chunk 1: "data: {..."hello"}}\ndata: {..."wor"
Chunk 2: "ld"}}"
Buffer after chunk 1: "data: {..."wor"
Buffer after chunk 2: ""
```

**Result**:
1. Chunk 1: Splits on `\n` → `["data: {...\"hello\"}", "data: {...\"wor"]` → Process first, retain tail
2. Chunk 2: Append to buffer → `"data: {...\"world\""` → No `\n` on next read
3. Next read returns `done=true` with no value
4. Tail processing: `parseSSELine("data: {...\"world\"}")` → "world" extracted
5. Both tokens captured

---

## Integration Points

### `web/store/useAnalysisStore.ts`
The `startAnalysis()` async function uses `consumeSSEStream()` to consume the response body from POST `/api/analyses`. All tokens are accumulated into the `markdown` variable, which is then stored in the analysis state.

### Error Observability
All parse errors are logged to Sentry with:
- **Tags**: `{ operation: 'startAnalysis', phase: 'stream_parse' }`
- **Level**: `'warning'` (non-fatal, stream continues)

All read errors are logged to Sentry with:
- **Tags**: `{ operation: 'startAnalysis', phase: 'stream_read' }`
- **Level**: `'error'` (fatal, rethrown)

---

## Testing & Validation

### Unit Testing (hypothetical)
```typescript
// Test: incomplete final line is processed
const lines: string[] = [];
await consumeSSEStream(
  mockReaderWithIncompleteLastLine(),
  (token) => { lines.push(token); }
);
expect(lines).toContain("final_token");

// Test: parse error doesn't crash stream
const errors: Error[] = [];
await consumeSSEStream(
  mockReaderWithMalformedJSON(),
  (token) => { /* noop */ },
  (error) => { errors.push(error); }
);
expect(errors.length).toBeGreaterThan(0);
```

### Production Monitoring
- **Sentry Dashboard**: Monitor `stream_parse` warnings to detect API format changes
- **Sentry Dashboard**: Monitor `stream_read` errors to detect network issues
- **Datadog**: Track `markdown` length histogram to detect token loss patterns (e.g., consistently short responses)

---

## Changelog

### v2.0.0 (2026-05-19)
- Added `consumeSSEStream()` unified decoder function
- Implemented guaranteed tail buffer processing on stream closure
- Improved defensive error handling for malformed JSON
- Deprecated inline streaming loop in `useAnalysisStore` (now uses `consumeSSEStream()`)

### v1.0.0 (2026-05-15)
- Initial `parseSSELine()` function for single-line token extraction
