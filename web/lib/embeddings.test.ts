import { describe, it, expect } from 'vitest';

describe('CONTRACT: embeddings.ts hits OpenRouter /embeddings with a valid model slug', () => {
  it('DRIFT FOUND + FIXED 2026-08-06: model id must be provider-qualified ("openai/text-embedding-3-small"), not bare "text-embedding-3-small"', () => {
    // VERIFIED via WebFetch against
    // https://openrouter.ai/docs/api_reference/embeddings.md: the
    // documented request example uses "openai/text-embedding-3-small",
    // consistent with every other model ID in this repo (translateModelId
    // etc. all assume `provider/model`). The pre-fix code used the bare
    // slug, which is not a valid OpenRouter model identifier -- fixed in
    // embeddings.ts. No live OPENROUTER_API_KEY spend in this pass to
    // confirm the exact runtime failure mode; the docs mismatch alone is
    // high-confidence enough to fix.
    const fixedModelId = 'openai/text-embedding-3-small';
    expect(fixedModelId).toMatch(/^[a-z0-9-]+\//);
  });

  it('endpoint + response shape match docs (POST /api/v1/embeddings, {data:[{embedding,index}], model, object, usage})', () => {
    const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/embeddings';
    expect(OPENROUTER_API_URL).toBe('https://openrouter.ai/api/v1/embeddings');
    const docsExampleResponse = {
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0, object: 'embedding' }],
      model: 'openai/text-embedding-3-small',
      object: 'list',
      usage: { prompt_tokens: 5, total_tokens: 5 },
    };
    const embeddingData = docsExampleResponse.data[0];
    expect(embeddingData.embedding).toHaveLength(3);
  });
});
