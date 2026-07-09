export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Index } from '@upstash/vector';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';
import { guardTraffic } from '@/lib/services/traffic';
import { ERROR_CODES } from '@/lib/error-codes';
import { generateEmbedding } from '@/lib/embeddings';
import * as Sentry from '@sentry/nextjs';

// Initialize Upstash Vector Index for semantic search
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL || 'https://placeholder-vector.upstash.io',
  token: process.env.UPSTASH_VECTOR_REST_TOKEN || 'placeholder-token-string',
});

// Production guard: Ensure real credentials are configured
if (process.env.NODE_ENV === 'production' && process.env.UPSTASH_VECTOR_REST_URL?.includes('placeholder')) {
  throw new Error('CRITICAL: Production execution cannot utilize Upstash environment placeholders. Vector search is unavailable.');
}

/**
 * Semantic search endpoint for analyzing video content.
 *
 * @param request - NextRequest containing JSON body with:
 *   - query (string, required): Search query, 3-1000 characters
 *   - topK (number, optional): Number of results to return, default 5, range [1, 50]
 *
 * @returns {Promise<NextResponse>} JSON response containing:
 *   - results: Array of enriched search results with analysisId, title, videoId, excerpt, score, createdAt
 *   - count: Number of valid results returned
 *   - query: Echo of the search query
 *   - tier: User's subscription tier
 *
 * @throws {NextResponse} 400 if query length invalid or topK out of bounds
 * @throws {NextResponse} 401 if authentication fails
 * @throws {NextResponse} 429 if rate limit exceeded
 * @throws {NextResponse} 500 on embedding generation or vector search failure
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseErr) {
      Sentry.captureException(parseErr, { tags: { code: ERROR_CODES.INVALID_JSON } });
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    // Validate request schema
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be an object' },
        { status: 400 }
      );
    }

    const { query, topK = 5 } = body as { query?: string; topK?: number };

    // Validate query parameter
    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query parameter is required and must be a string' },
        { status: 400 }
      );
    }

    if (query.length < 3 || query.length > 1000) {
      return NextResponse.json(
        { error: 'Query must be between 3 and 1000 characters' },
        { status: 400 }
      );
    }

    // Validate topK parameter bounds
    if (typeof topK !== 'number' || !Number.isInteger(topK) || topK < 1 || topK > 50) {
      const errorCode = ERROR_CODES.INVALID_REQUEST_SCHEMA;
      Sentry.captureMessage('Search: Invalid topK parameter', {
        level: 'warning',
        tags: { code: errorCode },
        contexts: { validation: { topK, min: 1, max: 50 } }
      });
      return NextResponse.json(
        {
          error: 'Invalid topK parameter',
          details: 'topK must be an integer between 1 and 50'
        },
        { status: 400 }
      );
    }

    // 2. Authentication check
    const authAdapter = new SupabaseAuthAdapter();
    const identity = await authAdapter.authenticate();

    if (!identity) {
      const errorCode = ERROR_CODES.AUTH_UNAUTHORIZED;
      Sentry.captureMessage('Search: Authentication check failed', {
        level: 'warning',
        tags: { code: errorCode }
      });
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const { userId, email: userEmail, tier: userTier } = identity;

    // 3. Rate limiting check
    const { allowed: trafficAllowed, response: trafficResponse, headers: trafficHeaders } = await guardTraffic(
      'search',
      userId,
      userTier,
      userEmail,
      request.headers.get('x-forwarded-for') ?? undefined,
      request.headers.get('user-agent') ?? undefined
    );

    if (!trafficAllowed && trafficResponse) {
      return trafficResponse;
    }

    console.log('[search] 1. Request validated and auth passed', { userId, query: query.substring(0, 50) });

    // 4. Generate embedding for query using Claude
    console.log('[search] 2. Generating embedding for query');

    // Use Claude to generate a 1536-dimensional embedding via OpenRouter
    // For now, we'll use a simple text hash as placeholder
    // In production, integrate with an embedding service
    const queryEmbedding = await generateQueryEmbedding(query);

    if (!queryEmbedding || queryEmbedding.length === 0) {
      const errorCode = ERROR_CODES.SEARCH_VECTOR_FAILED;
      Sentry.captureMessage('Failed to generate query embedding', {
        level: 'error',
        tags: { code: errorCode }
      });
      return NextResponse.json(
        { error: 'Failed to generate query embedding' },
        { status: 500 }
      );
    }

    console.log('[search] 3. Querying vector index', { topK, queryDim: queryEmbedding.length });

    // 5. Query vector index with COSINE similarity
    const searchResults = await vectorIndex.query<{ analysisId: string }>({
      vector: queryEmbedding,
      topK: topK, // Already validated to be in [1, 50]
      includeMetadata: true,
    });

    console.log('[search] 4. Vector search completed', { resultCount: searchResults.length });

    // 6. Fetch full analysis data from Supabase for each result
    const persistenceAdapter = new SupabasePersistenceAdapter();
    const enrichedResults = await Promise.all(
      searchResults.map(async (result) => {
        try {
          const analysisId = result.metadata?.analysisId as string | undefined;
          if (!analysisId) return null;

          const data = await persistenceAdapter.findAnalysisById({
            userId,
            analysisId,
          });

          if (!data) return null;

          return {
            analysisId: data.id,
            title: data.title,
            videoId: data.videoId,
            excerpt: data.analysisMarkdown?.substring(0, 200),
            score: result.score,
            createdAt: data.createdAt,
          };
        } catch (err) {
          console.warn('[search] Failed to enrich result:', err);
          return null;
        }
      })
    );

    const validResults = enrichedResults.filter(r => r !== null);

    console.log('[search] 5. Results enriched and ready', { count: validResults.length });

    // 7. Return results with proper headers
    const response = NextResponse.json({
      results: validResults,
      count: validResults.length,
      query,
      tier: userTier,
    });

    // Apply rate limit headers if present
    if (trafficHeaders) {
      for (const [key, value] of Object.entries(trafficHeaders)) {
        response.headers.set(key, value);
      }
    }

    return response;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[search] Unhandled error:', error);
    Sentry.captureException(error, {
      tags: { operation: 'search-vector' },
      contexts: { error: { message: errorMsg } }
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Generate embedding for search query via OpenRouter.
 *
 * @param query - Search query string (pre-validated to be 3-1000 characters)
 * @returns {Promise<number[]>} 1536-dimensional embedding vector, empty array on failure
 *
 * @throws Logs error to console and Sentry on embedding generation failure
 * @internal Uses text-embedding-3-small model for vector generation
 */
async function generateQueryEmbedding(query: string): Promise<number[]> {
  try {
    const result = await generateEmbedding(query);
    return result.embedding;
  } catch (error) {
    console.error('[search] Failed to generate embedding:', error);
    Sentry.captureException(error, {
      tags: { operation: 'embedding-generation' }
    });
    return [];
  }
}
