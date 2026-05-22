export const dynamic = 'force-dynamic';

/**
 * Vector Semantic Search API
 * POST /api/analyses/search
 *
 * Performs semantic similarity search across user's analyses
 * using pgvector cosine similarity (1536-dim embeddings)
 *
 * Request body:
 * {
 *   query: string;           // Search query text
 *   limit?: number;          // Results to return (default: 10, max: 100)
 *   threshold?: number;      // Similarity threshold 0-1 (default: 0.75)
 *   dateFrom?: string;       // ISO 8601 date filter (optional)
 *   dateTo?: string;         // ISO 8601 date filter (optional)
 * }
 *
 * Response:
 * {
 *   results: [
 *     {
 *       id: string;
 *       title: string;
 *       snippet: string;
 *       similarity: number;    // 0-1 cosine similarity score
 *       createdAt: string;
 *       matchType: "semantic" | "keyword";
 *     }
 *   ];
 *   queryTime: number;         // Milliseconds
 *   resultsCount: number;
 * }
 */

import { getAuthSession } from '@/lib/auth/provider-factory';
import { NextRequest, NextResponse } from 'next/server';
import { generateEmbedding, extractSnippet } from '@/lib/embeddings';
import { applyRateLimit, getUserTier } from '@/lib/rate-limit';
import { getSupabaseClient } from '@/lib/supabase';
import { logUsage } from '@/lib/usage';
import { SearchSchema } from '@/lib/schemas';
import * as Sentry from '@sentry/nextjs';
import {
  trackExternalCall,
  trackDatabaseQuery,
  addBreadcrumb,
  setUserContext,
} from '@/lib/monitoring/sentry-utils';

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  similarity: number;
  createdAt: string;
  matchType: 'semantic' | 'keyword';
}

interface SearchResponse {
  results: SearchResult[];
  queryTime: number;
  resultsCount: number;
  hasMore: boolean;
}

export async function POST(request: NextRequest) {
  const startTime = performance.now();
  let userId: string | undefined;
  let userEmail = '';

  try {
    // Dev bypass check (CI/test environments only)
    const allowDevBypass = process.env.ALLOW_DEV_BYPASS === 'true';
    const isProduction = process.env.NODE_ENV === 'production';
    const bypassSignature = request.headers.get('X-Hex-Test-Secret');
    const devBypassToken = process.env.DEV_BYPASS_TOKEN;
    const hasValidBypassToken = devBypassToken && bypassSignature === devBypassToken;
    const shouldAttemptBypass = !isProduction && allowDevBypass && hasValidBypassToken;

    if (shouldAttemptBypass) {
      // Use persistent test user for CI/dev bypass
      userId = 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb';
      userEmail = process.env.DEV_TEST_USER_EMAIL || 'test@test.com';
    } else {
      // 1. Auth check
      const session = await getAuthSession();
      if (!session?.user) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }

      userId = (session.user as any).id;
      userEmail = (session.user as any).email || '';
    }
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID not found in session' },
        { status: 401 }
      );
    }
    const userTierAuth = await getUserTier(userId);

    // Set user context for Sentry
    setUserContext(userId, userEmail || '', userTierAuth);
    addBreadcrumb('Search initiated', { userId });

    // 1.5. Rate limiting check
    const { allowed, response: rateLimitResponse, headers: rateLimitHeaders } = await applyRateLimit(
      request,
      'search',
      userId,
      userTierAuth
    );

    if (!allowed) {
      addBreadcrumb('Rate limit exceeded for search', { userId, tier: userTierAuth }, 'rate_limiting');
      Sentry.captureMessage('Rate limit: POST /api/analyses/search', 'warning');
      // Rate limit exceeded - response already has 429 status
      if (rateLimitResponse) {
        // Attach headers to response
        if (rateLimitHeaders) {
          for (const [key, value] of Object.entries(rateLimitHeaders)) {
            rateLimitResponse.headers.set(key, value);
          }
        }
        return rateLimitResponse;
      }
    }

    // 2. Parse and validate request
    const body = await request.json();
    const validation = SearchSchema.safeParse(body);
    if (!validation.success) {
      addBreadcrumb('Invalid search query', { errors: validation.error.flatten() }, 'validation');
      return NextResponse.json(
        { error: 'Invalid request', details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const limit = validation.data.limit;
    const threshold = validation.data.threshold;

    addBreadcrumb('Search query validated', {
      query: validation.data.query.substring(0, 100),
      limit,
      threshold,
    });

    // 3. Generate embedding for search query
    let queryEmbedding: number[];
    try {
      const embeddingResult = await trackExternalCall(
        'openai',
        'text-embedding-3-small',
        () => generateEmbedding(validation.data.query),
        { query: validation.data.query.substring(0, 100) }
      );
      queryEmbedding = embeddingResult.embedding;

      addBreadcrumb('Search query embedded', {
        costUsd: embeddingResult.costUsd,
      });

      // Log embedding cost
      await logUsage({
        userId,
        action: 'search',
        metadata: {
          query: validation.data.query,
          cost_usd: embeddingResult.costUsd,
        },
      });
    } catch (error) {
      console.error('[/api/analyses/search] Embedding generation failed:', error);
      addBreadcrumb('Embedding generation failed for search', {
        error: String(error),
      }, 'external_service');
      Sentry.captureException(error, {
        tags: { service: 'openai', operation: 'text-embedding-3-small' },
        contexts: { search: { query: validation.data.query.substring(0, 100) } },
      });
      return NextResponse.json(
        { error: 'Failed to process search query' },
        { status: 500 }
      );
    }

    // 4. Create Supabase client (server-side)
    const supabase = getSupabaseClient();

    // 5. Execute pgvector semantic search natively in Postgres via RPC
    const analyses = await trackDatabaseQuery(
      'select',
      'analyses_semantic_search',
      async () => {
        const { data, error } = await supabase.rpc('search_analyses_semantic', {
          query_embedding: queryEmbedding,
          match_threshold: threshold,
          match_count: limit,
          p_user_id: userId,
          p_date_from: validation.data.dateFrom || null,
          p_date_to: validation.data.dateTo || null,
        });

        if (error) throw error;
        return data;
      },
      { userId }
    ).catch((error) => {
      console.error('[/api/analyses/search] Database query failed:', error);
      addBreadcrumb('Database query failed for search', {
        error: String(error),
      }, 'database');
      throw error;
    });

    if (!analyses) {
      addBreadcrumb('No analyses found for user', { userId }, 'database');
    }

    if (!analyses || analyses.length === 0) {
      const queryTime = Math.round(performance.now() - startTime);
      addBreadcrumb('Search completed (no results)', { queryTime });
      return NextResponse.json<SearchResponse>(
        {
          results: [],
          queryTime,
          resultsCount: 0,
          hasMore: false,
        },
        { status: 200 }
      );
    }

    addBreadcrumb('Analyses retrieved from database', {
      count: analyses.length,
    });

    // 6. Format results (similarity is calculated by the database RPC)
    const results: SearchResult[] = analyses.map((analysis: any) => ({
      id: analysis.id,
      title: analysis.title || 'Untitled Analysis',
      snippet: extractSnippet(analysis.analysis_markdown, 150),
      similarity: analysis.similarity,
      createdAt: analysis.created_at,
      matchType: 'semantic' as const,
    }));

    const queryTime = Math.round(performance.now() - startTime);

    addBreadcrumb('Search completed successfully', {
      queryTime,
      resultsCount: results.length,
      threshold,
    });

    const response: SearchResponse = {
      results,
      queryTime,
      resultsCount: results.length,
      hasMore: results.length === limit,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const queryTime = Math.round(performance.now() - startTime);
    console.error('[/api/analyses/search] Error:', error);

    Sentry.captureException(error, {
      contexts: {
        api: {
          endpoint: '/api/analyses/search',
          method: 'POST',
          userId,
          duration: queryTime,
        },
      },
      tags: {
        endpoint: 'search',
        severity: 'high',
      },
    });

    addBreadcrumb('Unhandled error in POST /api/analyses/search', {
      error: error instanceof Error ? error.message : String(error),
      duration: queryTime,
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

