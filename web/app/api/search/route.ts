export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';
import { guardTraffic } from '@/lib/services/traffic';
import { generateEmbedding } from '@/lib/embeddings';
import { initializeVectorIndex } from '@/lib/upstash-vector';
import * as Sentry from '@sentry/nextjs';
import { ERROR_PHASES } from '@/lib/error-codes';
import { categorizeError, createErrorResponse } from '@/lib/services/error-handler';

const vectorIndex = initializeVectorIndex();

const SearchRequestSchema = z.object({
  query: z.string().min(3).max(1000),
  topK: z.number().int().min(1).max(50).default(5),
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    // 0. Check if vector search is configured
    if (!vectorIndex) {
      const err = categorizeError(new Error('Vector search not configured'), ERROR_PHASES.EXTERNAL_SERVICE);
      console.error('[search] Vector index not initialized', { requestId });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
    }

    // 1. Parse and validate request
    let body: unknown;
    try {
      body = await request.json();
    } catch (parseErr) {
      const err = categorizeError(parseErr, ERROR_PHASES.REQUEST_VALIDATION);
      Sentry.captureException(parseErr, {
        tags: { operation: 'search', phase: 'json_parse', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/search' } }
      });
      console.error('[search] JSON parse error', { requestId, message: err.message });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
    }

    // Validate request schema with Zod
    const parsed = SearchRequestSchema.safeParse(body);
    if (!parsed.success) {
      const err = categorizeError(parsed.error, ERROR_PHASES.REQUEST_VALIDATION);
      console.warn('[search] Invalid payload schema', { requestId, issues: parsed.error.issues.length });
      Sentry.captureMessage('Search: Invalid request schema', {
        level: 'warning',
        tags: { operation: 'search', phase: 'schema_validation', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/search' }, validation: { issues: parsed.error.issues } }
      });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
    }

    const { query, topK } = parsed.data;

    // 2. Authentication check
    const authAdapter = new SupabaseAuthAdapter();
    const identity = await authAdapter.authenticate();

    if (!identity) {
      const err = categorizeError(new Error('No identity'), ERROR_PHASES.AUTHENTICATION);
      console.warn('[search] Authentication failed', { requestId, query: query.substring(0, 50) });
      Sentry.captureMessage('Search: Authentication check failed', {
        level: 'warning',
        tags: { operation: 'search', phase: 'authentication', retryable: String(err.retryable) },
        contexts: { api: { requestId, endpoint: '/api/search' } }
      });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
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
      const err = categorizeError(error, ERROR_PHASES.EMBEDDING_GENERATION);
      Sentry.captureException(error, {
        tags: { operation: 'search', phase: 'embedding_generation', retryable: String(err.retryable) },
        contexts: { api: { requestId, userId, endpoint: '/api/search' } }
      });
      console.error('[search] Embedding generation failed', { requestId, userId, error: err.message, retryable: err.retryable });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
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
      const err = categorizeError(error, ERROR_PHASES.VECTOR_SEARCH);
      Sentry.captureException(error, {
        tags: { operation: 'search', phase: 'vector_search', retryable: String(err.retryable) },
        contexts: { api: { requestId, userId, endpoint: '/api/search' } }
      });
      console.error('[search] Vector search failed', { requestId, userId, error: err.message, retryable: err.retryable });
      return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
    }

    // 6. Fetch full analysis data from Supabase for each result
    const persistenceAdapter = new SupabasePersistenceAdapter();
    const enrichedResults = await Promise.all(
      searchResults.map(async (result: { metadata?: { analysisId?: string }; score?: number }) => {
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
          const error = categorizeError(err, ERROR_PHASES.RESULT_ENRICHMENT);
          Sentry.captureException(err, {
            tags: { operation: 'search', phase: 'result_enrichment', retryable: String(error.retryable) },
            contexts: { api: { requestId, userId, analysisId: result.metadata?.analysisId } }
          });
          console.warn('[search] Failed to enrich result', { requestId, analysisId: result.metadata?.analysisId, error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      })
    );

    const validResults = enrichedResults.filter((r): r is Exclude<typeof r, null> => r !== null);
    const duration = Date.now() - startTime;

    // Track enrichment success/failure ratio for observability
    const successCount = validResults.length;
    const failureCount = enrichedResults.length - successCount;
    const successRatio = enrichedResults.length > 0 ? (successCount / enrichedResults.length) * 100 : 100;

    if (failureCount > 0) {
      Sentry.captureMessage('Search: Partial enrichment failure', {
        level: 'warning',
        tags: {
          operation: 'search-enrichment',
          successCount: String(successCount),
          failureCount: String(failureCount),
          successRatio: String(Math.round(successRatio)),
        },
        contexts: {
          search: {
            query: query.substring(0, 100),
            topK,
            totalAttempted: enrichedResults.length,
            successCount,
            failureCount,
            successRatio: Math.round(successRatio * 100) / 100,
          },
          api: {
            requestId,
            userId,
            endpoint: '/api/search',
          },
        },
      });
    }

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
