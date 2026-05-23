export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Index } from '@upstash/vector';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
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

    // 2. Authentication check
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id;

    if (!userId) {
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

    // 3. Rate limiting check
    const userTier = (await getUserTier(userId)) || 'free';
    const { allowed, response: rateLimitResponse } = await applyRateLimit(
      request,
      'search',
      userId,
      userTier
    );

    if (!rateLimitResponse && !allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      );
    }

    if (rateLimitResponse && !allowed) {
      return rateLimitResponse;
    }

    console.log('[search] 1. Request validated and auth passed', { userId, query: query.substring(0, 50) });

    // 4. Generate embedding for query using Claude
    console.log('[search] 2. Generating embedding for query');

    // Use Claude to generate a 1536-dimensional embedding via OpenRouter
    // For now, we'll use a simple text hash as placeholder
    // In production, integrate with an embedding service
    const queryEmbedding = await generateQueryEmbedding(query);

    if (!queryEmbedding || queryEmbedding.length === 0) {
      const errorCode = ERROR_CODES.INVALID_REQUEST_SCHEMA;
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
      data: queryEmbedding as unknown as string,
      topK: Math.min(topK, 50), // Cap at 50 results
      includeMetadata: true,
    });

    console.log('[search] 4. Vector search completed', { resultCount: searchResults.length });

    // 6. Fetch full analysis data from Supabase for each result
    const enrichedResults = await Promise.all(
      searchResults.map(async (result) => {
        try {
          const analysisId = result.metadata?.analysisId as string | undefined;
          if (!analysisId) return null;

          const { data, error } = await supabase
            .from('analyses')
            .select('id, title, analysis_markdown, video_id, created_at')
            .eq('id', analysisId)
            .eq('user_id', userId)
            .maybeSingle();

          if (error || !data) return null;

          return {
            analysisId: data.id,
            title: data.title,
            videoId: data.video_id,
            excerpt: data.analysis_markdown?.substring(0, 200),
            score: result.score,
            createdAt: data.created_at,
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

    // Apply rate limit headers if allowed
    if (rateLimitResponse?.headers) {
      for (const [key, value] of Object.entries(rateLimitResponse.headers)) {
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
 * Generate embedding for search query via OpenRouter
 * Uses text-embedding-3-small model for 1536-dimensional vectors
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
