/**
 * Hexagonal Decoder: Pure utility for SSE stream decoding
 * Isolated from React/framework concerns - unit testable and reusable
 * Decodes Claude 4.5 SSE format into markdown tokens
 */

export interface SSEMessage {
  token: string;
  isComplete: boolean;
}

/**
 * Parse single SSE chunk from streaming response
 * Handles both delta.content and legacy .text fields
 * Gracefully skips malformed chunks
 * @param chunk - Raw Uint8Array bytes from stream
 * @returns Parsed message or null if chunk invalid/incomplete
 */
export function parseSSEChunk(chunk: Uint8Array): SSEMessage | null {
  try {
    const text = new TextDecoder().decode(chunk);

    // Handle [DONE] sentinel
    if (text.includes('[DONE]')) {
      return { token: '', isComplete: true };
    }

    // Parse SSE format: "data: {...json...}"
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.substring(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const json = JSON.parse(dataStr);

          // Try delta.content first (Claude 4.5 format)
          const token = json.choices?.[0]?.delta?.content;
          if (token !== undefined) {
            return { token: String(token), isComplete: false };
          }

          // Fallback to legacy .text format
          const legacyToken = json.choices?.[0]?.text;
          if (legacyToken !== undefined) {
            return { token: String(legacyToken), isComplete: false };
          }
        } catch {
          // Malformed JSON in chunk - skip gracefully
          continue;
        }
      }
    }

    return null;
  } catch (error) {
    // Decoder errors (e.g., invalid UTF-8) - skip and continue
    return null;
  }
}

/**
 * Reconstruct complete markdown from collected SSE chunks
 * @param chunks - Array of Uint8Array chunks from stream
 * @returns Complete markdown string
 */
export function reconstructMarkdown(chunks: Uint8Array[]): string {
  let markdown = '';

  for (const chunk of chunks) {
    const message = parseSSEChunk(chunk);
    if (message && !message.isComplete) {
      markdown += message.token;
    }
  }

  return markdown;
}
