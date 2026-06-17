/**
 * Streaming utilities for SSE/chunked response handling
 * Normalizes OpenRouter Claude 4.5 delta format for downstream clients
 */

/**
 * Creates a TransformStream that normalizes Claude 4.5's streaming response format
 * Converts raw OpenRouter chunks into consistent SSE format with normalized delta structure
 */
export function createClaudeStreamNormalizer(): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    async transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      const chunkText = new TextDecoder().decode(chunk);
      const lines = chunkText.split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Pass through non-data lines as-is
        if (!trimmed.startsWith('data: ')) {
          controller.enqueue(new TextEncoder().encode(line + '\n'));
          continue;
        }

        // Handle stream completion marker
        if (trimmed === 'data: [DONE]') {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
          continue;
        }

        try {
          const jsonText = trimmed.slice(6);
          const parsed = JSON.parse(jsonText);

          // Defensively extract content from both Claude 4.5 and legacy formats
          const contentToken =
            parsed.choices?.[0]?.delta?.content ||
            parsed.choices?.[0]?.text ||
            '';

          if (contentToken) {
            const normalized = JSON.stringify({
              choices: [
                {
                  delta: {
                    content: contentToken,
                  },
                },
              ],
            });
            controller.enqueue(
              new TextEncoder().encode(`data: ${normalized}\n\n`)
            );
          }
        } catch (parseError) {
          // Silently skip malformed chunks to prevent stream closure
          console.warn('[streaming] Non-critical chunk parse skip', {
            linePreview: trimmed.slice(0, 100),
          });
        }
      }
    },
  });
}
