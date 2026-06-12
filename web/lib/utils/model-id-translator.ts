/**
 * Translates locked/hallucinated model IDs to valid upstream OpenRouter model IDs.
 */
export function translateModelId(model: string): string {
  // OpenRouter natively supports 'anthropic/claude-sonnet-4.6' and 'anthropic/claude-haiku-4.5'.
  // No translation is required.
  return model;
}
