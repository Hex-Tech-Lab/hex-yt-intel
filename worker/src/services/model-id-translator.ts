/**
 * Translates locked/hallucinated model IDs to valid upstream OpenRouter model IDs.
 */
export function translateModelId(model: string): string {
  if (model === 'anthropic/claude-sonnet-4.6') {
    return 'anthropic/claude-3.5-sonnet';
  }
  if (model === 'anthropic/claude-sonnet-4.6:nitro') {
    return 'anthropic/claude-3.5-sonnet:nitro';
  }
  return model;
}
