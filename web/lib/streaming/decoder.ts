/**
 * Unified SSE stream decoder with defensive parsing and complete tail token processing
 * Handles malformed chunks, incomplete lines, and final buffer flush on stream closure
 */

/**
 * Parse single SSE line from streaming response
 * @param line - Raw text line from stream
 * @returns Extracted token or null if not a valid data line
 * @throws SyntaxError on malformed JSON (caller must handle)
 */
export function parseSSELine(line: string): string | null {
  const trimmed = line.trim();

  // Skip empty lines, stream markers, and completion signals
  if (!trimmed || !trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') {
    return null;
  }

  try {
    const json = JSON.parse(trimmed.substring(6));
    const token = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text;
    return token !== undefined ? String(token) : null;
  } catch (parseError) {
    throw new SyntaxError(`Failed to parse SSE line: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
  }
}

/**
 * Unified streaming decoder: consumes ReadableStream, processes all tokens including tail
 * Guarantees no final tokens are dropped due to incomplete buffer flush
 * @param reader - Response body reader from fetch
 * @param onToken - Callback invoked for each parsed token
 * @param onError - Callback invoked on parse errors (optional, defaults to rethrow)
 */
export async function consumeSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onToken: (token: string) => void,
  onError?: (error: Error, phase: 'parse' | 'read') => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      try {
        const { done, value } = await reader.read();

        // Accumulate chunk into buffer
        if (value) {
          buffer += decoder.decode(value, { stream: true });
        }

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          try {
            const token = parseSSELine(line);
            if (token) {
              onToken(token);
            }
          } catch (parseError) {
            const error = parseError instanceof Error
              ? parseError
              : new Error(String(parseError));

            if (onError) {
              onError(error, 'parse');
            } else {
              throw error;
            }
          }
        }

        // Stream closed: process any remaining tail buffer
        if (done) {
          if (buffer.length > 0) {
            try {
              const finalToken = parseSSELine(buffer);
              if (finalToken) {
                onToken(finalToken);
              }
            } catch (parseError) {
              const error = parseError instanceof Error
                ? parseError
                : new Error(String(parseError));

              if (onError) {
                onError(error, 'parse');
              } else {
                throw error;
              }
            }
          }
          break;
        }
      } catch (readError) {
        const error = readError instanceof Error
          ? readError
          : new Error(String(readError));

        if (onError) {
          onError(error, 'read');
        } else {
          throw error;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {
      // Suppress cancellation errors on stream closure
    });
  }
}
