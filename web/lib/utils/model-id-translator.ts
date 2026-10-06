/**
 * Translates locked/hallucinated model IDs to valid upstream OpenRouter model IDs.
 */
export function translateModelId(model: string): string {
  // OpenRouter natively supports the registry-configured model IDs; no translation is required.
  return model;
}
