/**
 * Pure utility for SSE stream line decoding
 * Throws on malformed JSON to allow consumers to handle telemetry/logging
 */

/**
 * Parse single SSE line from streaming response
 * @param line - Raw text line from stream
 * @returns Extracted token or null if not a valid data line
 */
export function parseSSELine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') {
    return null;
  }

  const json = JSON.parse(trimmed.substring(6));
  const token = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text;
  
  return token !== undefined ? String(token) : null;
}
