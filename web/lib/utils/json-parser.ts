export function parseJsonArray<T = unknown>(rawText: string, contextName: string): { status: 'ok'; data: T } | { status: 'invalid' } {
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { status: 'invalid' };

  try {
    const raw = JSON.parse(jsonMatch[0]);
    return { status: 'ok', data: raw as T };
  } catch (parseError) {
    console.warn(`[${contextName}] model response matched a JSON-array shape but failed to parse:`, parseError instanceof Error ? parseError.message : String(parseError));
    return { status: 'invalid' };
  }
}
