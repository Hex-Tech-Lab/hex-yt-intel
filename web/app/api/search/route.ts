export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Index } from '@upstash/vector';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';
import { guardTraffic } from '@/lib/services/traffic';
import { ERROR_CODES } from '@/lib/error-codes';
import { generateEmbedding } from '@/lib/embeddings';
import * as Sentry from '@sentry/nextjs';

type SearchErrorCategory =
  | 'request_validation'
  | 'authentication'
  | 'rate_limit'
  | 'embedding_generation'
  | 'vector_search'
  | 'database_fetch'
  | 'unknown';

interface SearchError {
  category: SearchErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  statusCode: number;
}

// Initialize Upstash Vector Index for semantic search
const vectorIndex = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL || 'https://placeholder-vector.upstash.io',
  token: process.env.UPSTASH_VECTOR_REST_TOKEN || 'placeholder-token-string',
});

// Production guard: Ensure real credentials are configured
if (process.env.NODE_ENV === 'production' && process.env.UPSTASH_VECTOR_REST_URL?.includes('placeholder')) {
  throw new Error('CRITICAL: Production execution cannot utilize Upstash environment placeholders. Vector search is unavailable.');
}

const SearchRequestSchema = z.object({
  query: z.string().min(3).max(1000),
  topK: z.number().int().min(1).max(50).default(5),
});

function categorizeSearchError(error: unknown, phase: string): SearchError {
  const message = error instanceof Error ? error.message : String(error);

  if (phase === 'request_validation') {
    return { category: 'request_validation', code: 'INVALID_REQUEST', message, retryable: false, statusCode: 400 };
  }
  if (phase === 'authentication') {
    return { category: 'authentication', code: 'UNAUTHORIZED', message, retryable: false, statusCode: 401 };
  }
  if (phase === 'rate_limit') {
    return { category: 'rate_limit', code: 'RATE_LIMITED', message, retryable: true, statusCode: 429 };
  }
  if (phase === 'embedding_generation') {
    const isTimeout = message.includes('timeout') || message.includes('ECONNRESET');
    return { category: 'embedding_generation', code: 'EMBEDDING_FAILED', message, retryable: isTimeout, statusCode: isTimeout ? 503 : 500 };
  }
  if (phase === 'vector_search') {
    const isTimeout = message.includes('timeout') || message.includes('connection');
    return { category: 'vector_search', code: 'VECTOR_SEARCH_FAILED', message, retryable: isTimeout, statusCode: isTimeout ? 503 : 500 };
  }
  if (phase === 'database_fetch') {
    const isTimeout = message.includes('timeout') || message.includes('ECONNRESET');
    return { category: 'database_fetch', code: 'DB_FETCH_ERROR', message, retryable: isTimeout, statusCode: isTimeout ? 503 : 500 };
  }
  return { category: 'unknown', code: 'INTERNAL_ERROR', message, retryable: true, statusCode: 500 };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    // 1. Parse and validate request
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseErr) {
      const err = categorizeSearchError(parseErr, 'request_validation');
      Sentry.captureException(parseErr, {
        tags: { operation: 'search', phase: 'json_parse', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/search' } }
      });
      console.error('[search] JSON parse error', { requestId, message: err.message });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    // Validate request schema with Zod
    const parsed = SearchRequestSchema.safeParse(body);
    if (!parsed.success) {
      const err = categorizeSearchError(parsed.error, 'request_validation');
      console.warn('[search] Invalid payload schema', { requestId, issues: parsed.error.issues.length });
      Sentry.captureMessage('Search: Invalid request schema', {
        level: 'warning',
        tags: { operation: 'search', phase: 'schema_validation', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/search' }, validation: { issues: parsed.error.issues } }
      });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    const { query, topK } = parsed.data;

    // 2. Authentication check
    const authAdapter = new SupabaseAuthAdapter();
    const identity = await authAdapter.authenticate();

    if (!identity) {
      const err = categorizeSearchError(new Error('No identity'), 'authentication');
      console.warn('[search] Authentication failed', { requestId, query: query.substring(0, 50) });
      Sentry.captureMessage('Search: Authentication check failed', {
        level: 'warning',
        tags: { operation: 'search', phase: 'authentication', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/search' } }
      });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
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
      console.warn('[search] Rate limit exceeded', { requestId, userId });
      Sentry.captureMessage('Search: Rate limit exceeded', {
        tags: { operation: 'search', phase: 'rate_limit' },
        contexts: { api: { requestId, userId, endpoint: '/api/search' } }
      });
      return trafficResponse;
    }

    console.log('[search] Request validated', { requestId, userId, queryLen: query.length, topK });

    // 4. Generate embedding for query
    let queryEmbedding: number[];
    try {
      queryEmbedding = await generateQueryEmbedding(query);
      if (!queryEmbedding || queryEmbedding.length === 0) {
        throw new Error('Empty embedding result');
      }
    } catch (error) {
      const err = categorizeSearchError(error, 'embedding_generation');
      Sentry.captureException(error, {
        tags: { operation: 'search', phase: 'embedding_generation', retryable: String(err.retryable) },
        contexts: { api: { requestId, userId, endpoint: '/api/search' } }
      });
      console.error('[search] Embedding generation failed', { requestId, userId, error: err.message, retryable: err.retryable });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

    // 5. Query vector index
    let searchResults;
    try {
      searchResults = await vectorIndex.query<{ analysisId: string }>({
        vector: queryEmbedding,
        topK,
        includeMetadata: true,
      });
    } catch (error) {
      const err = categorizeSearchError(error, 'vector_search');
      Sentry.captureException(error, {
        tags: { operation: 'search', phase: 'vector_search', retryable: String(err.retryable) },
        contexts: { api: { requestId, userId, endpoint: '/api/search' } }
      });
      console.error('[search] Vector search failed', { requestId, userId, error: err.message, retryable: err.retryable });
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }

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
          const error = categorizeSearchError(err, 'database_fetch');
          Sentry.captureException(err, {
            tags: { operation: 'search', phase: 'result_enrichment', retryable: String(error.retryable) },
            contexts: { api: { requestId, userId, analysisId: result.metadata?.analysisId } }
          });
          console.warn('[search] Failed to enrich result', { requestId, analysisId: result.metadata?.analysisId, error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      })
    );

    const validResults = enrichedResults.filter(r => r !== null);
    const duration = Date.now() - startTime;

    console.info('[search] Query completed successfully', { requestId, userId, resultCount: validResults.length, duration });

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
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { operation: 'search', phase: 'unknown' },
      contexts: { api: { requestId, endpoint: '/api/search', duration } }
    });
    console.error('[search] Unexpected error', { requestId, message, duration });
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
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[search] Embedding generation exception', { message: msg });
    throw error;
  }
}
