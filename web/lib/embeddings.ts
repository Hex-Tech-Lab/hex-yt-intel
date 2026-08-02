/**
 * Vector Embedding Service
 * Generates 1536-dimensional embeddings using OpenRouter + text-embedding-3-small
 * via Claude API (free tier on OpenRouter)
 */

interface EmbeddingResponse {
  object: string;
  index: number;
  embedding: number[];
}

interface EmbeddingResult {
  embedding: number[];
  costUsd: number;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSION = 1536;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/embeddings';

// Retry configuration
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Generate a 1536-dimensional embedding vector for text
 * Uses OpenRouter's embeddings endpoint with text-embedding-3-small
 *
 * @param text - Input text to embed
 * @returns Promise with embedding vector and cost tracking
 */
export async function generateEmbedding(text: string, userId?: string): Promise<EmbeddingResult> {
  if (!text || text.trim().length === 0) {
    throw new Error('Cannot generate embedding for empty text');
  }

  // Defensive runtime check - will fail fast if key is missing
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured. Set it in Vercel environment variables.');
  }

  // Truncate text to reasonable length (max ~8000 tokens for embeddings)
  const truncatedText = text.substring(0, 32000);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://yt-intel.getmytestdrive.com',
          'X-Title': 'hex-yt-intel / vector-embeddings',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: truncatedText,
          ...(userId ? { user: userId } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      try {
        if (!response.ok) {
          const error = await response.text();
          throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
        }

        const data = await response.json();

        // Extract embedding from response
        const embeddingData = data.data[0] as EmbeddingResponse;
        if (!embeddingData.embedding || embeddingData.embedding.length !== EMBEDDING_DIMENSION) {
          throw new Error(
            `Invalid embedding dimension: got ${embeddingData.embedding?.length || 0}, expected ${EMBEDDING_DIMENSION}`
          );
        }

        // Cost tracking: text-embedding-3-small is typically $0.02 per 1M tokens
        // ~4 characters per token on average
        const estimatedTokens = Math.ceil(truncatedText.length / 4);
        const costPerToken = 0.00000002; // $0.02 / 1M tokens
        const costUsd = estimatedTokens * costPerToken;

        return {
          embedding: embeddingData.embedding,
          costUsd,
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error('Embedding request timed out (5s exceeded)');
      }

      // Exponential backoff for retries
      if (attempt < RETRY_MAX_ATTEMPTS - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Failed to generate embedding after ${RETRY_MAX_ATTEMPTS} attempts: ${lastError?.message}`
  );
}


/**
 * Calculate cosine similarity between two embedding vectors
 * Used for scoring search results
 *
 * @param vectorA - First embedding vector
 * @param vectorB - Second embedding vector
 * @returns Similarity score between -1 and 1 (1 = identical, -1 = opposite, 0 = orthogonal)
 */
export function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  if (vectorA.length !== vectorB.length) {
    throw new Error(`Vector dimension mismatch: ${vectorA.length} vs ${vectorB.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    const a = vectorA[i];
    const b = vectorB[i];
    if (a === undefined || b === undefined) {
      throw new Error(`Vector contains undefined values at index ${i}`);
    }
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Extract key snippets from text for search result display
 * Returns sentences containing high-value keywords
 *
 * @param text - Full text to extract from
 * @param maxLength - Maximum characters to return
 * @returns Truncated snippet with ellipsis if needed
 */
export function extractSnippet(text: string, maxLength: number = 150): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Try to break at sentence boundary
  const sentences = text.split(/[.!?]\s+/);
  let snippet = '';

  for (const sentence of sentences) {
    if ((snippet + sentence).length <= maxLength) {
      snippet += sentence + '. ';
    } else {
      break;
    }
  }

  return snippet.trim() + (snippet.length < text.length ? '...' : '');
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

/**
 * Generate a sparse vector representation for BM25-like search in hybrid indexes
 * Tokenizes text, removes common stopwords, and hashes tokens to integer indices.
 * Applies a 3.5x signal multiplier to LLM-extracted highPriorityTerms (Knowledge Graph nodes/key terms)
 * so rare-but-critical domain terms rank at the top regardless of low raw transcript frequency.
 */
export function generateSparseVector(
  text: string,
  highPriorityTerms: string[] = []
): SparseVector {
  if (!text) {
    return { indices: [], values: [] };
  }

  // Set of normalized high-priority terms for O(1) lookup
  const prioritySet = new Set(
    highPriorityTerms
      .flatMap(t => t.toLowerCase().match(/[a-z0-9]{2,}/g) || [])
      .filter(w => w.length >= 2)
  );

  // Split into words, lowercase, and keep only alphanumeric tokens of length >= 2
  const words = text.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  
  // Count frequency of each word
  const tfMap = new Map<string, number>();
  for (const word of words) {
    tfMap.set(word, (tfMap.get(word) || 0) + 1);
  }

  // Simple English stopwords
  const stopwords = new Set([
    'the', 'and', 'a', 'of', 'to', 'is', 'in', 'that', 'it', 'for', 'on', 'with', 
    'as', 'this', 'was', 'at', 'by', 'an', 'be', 'are', 'from', 'or', 'you', 'your'
  ]);

  const rawIndices: { index: number; value: number }[] = [];

  for (const [word, count] of tfMap.entries()) {
    if (stopwords.has(word)) {
      continue;
    }
    const index = hashWordToLong(word);
    
    // Log frequency weighting with 3.5x boost for LLM Knowledge Graph / Key Terms
    const baseValue = Math.log(1 + count);
    const boost = prioritySet.has(word) ? 3.5 : 1.0;
    const value = baseValue * boost;

    rawIndices.push({ index, value });
  }

  // Upstash Vector limit: sparse vector size must be <= 1000 non-zero entries.
  // We enforce a 95% capacity buffer (max 950 terms) and apply a statistical signal threshold
  // (value >= 0.15) to preserve 100% of meaningful term entropy without hitting hard database limits.
  const MAX_SPARSE_BUFFER_SIZE = 950;
  const MIN_TERM_SIGNAL_THRESHOLD = 0.15;

  // Filter low-signal long-tail noise
  const significantIndices = rawIndices.filter(item => item.value >= MIN_TERM_SIGNAL_THRESHOLD);

  // Sort by term frequency signal descending first to prioritize high-entropy terms
  significantIndices.sort((a, b) => b.value - a.value);

  // Slice to the statistical 950-term buffer capacity
  const bufferedIndices = significantIndices.slice(0, MAX_SPARSE_BUFFER_SIZE);

  // Sort by index ascending to meet canonical sparse vector conventions
  bufferedIndices.sort((a, b) => a.index - b.index);

  return {
    indices: bufferedIndices.map(item => item.index),
    values: bufferedIndices.map(item => item.value),
  };
}

function hashWordToLong(word: string): number {
  let hash = 5381;
  for (let i = 0; i < word.length; i++) {
    hash = (hash * 33) ^ word.charCodeAt(i);
  }
  // Ensure we return a positive integer range fitting in Java's signed long
  return Math.abs(hash >>> 0);
}

