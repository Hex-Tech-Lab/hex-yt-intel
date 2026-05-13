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

import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { generateEmbedding, extractSnippet } from '@/lib/embeddings';
import * as Sentry from '@sentry/nextjs';

interface SearchRequest {
  query: string;
  limit?: number;
  threshold?: number;
  dateFrom?: string;
  dateTo?: string;
}

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
}

export async function POST(request: NextRequest) {
  const startTime = performance.now();

  try {
    // 1. Auth check
    const session = await getServerSession(authConfig);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = (session.user as any).id;

    // 2. Parse and validate request
    const body: SearchRequest = await request.json();

    if (!body.query || body.query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }

    const limit = Math.min(Math.max(body.limit || 10, 1), 100);
    const threshold = Math.max(Math.min(body.threshold || 0.75, 1), 0);

    // 3. Generate embedding for search query
    let queryEmbedding: number[];
    try {
      const embeddingResult = await generateEmbedding(body.query);
      queryEmbedding = embeddingResult.embedding;

      // Log embedding cost
      await logUsage(userId, 'search', {
        query: body.query,
        cost_usd: embeddingResult.costUsd,
      });
    } catch (error) {
      console.error('[/api/analyses/search] Embedding generation failed:', error);
      return NextResponse.json(
        { error: 'Failed to process search query' },
        { status: 500 }
      );
    }

    // 4. Create Supabase client (server-side)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // 5. Execute pgvector semantic search
    // Query: cosine similarity (1 - distance), ordered by similarity
    // RLS automatically filters to user_id = auth.uid()
    let query = supabase
      .from('analyses')
      .select('id, title, analysis_markdown, created_at, embedding')
      .eq('user_id', userId)
      .not('embedding', 'is', null)
      .order('embedding', {
        ascending: false,
        referencedColumn: 'embedding',
      } as any);

    // Apply date filters if provided
    if (body.dateFrom) {
      query = query.gte('created_at', body.dateFrom);
    }
    if (body.dateTo) {
      query = query.lte('created_at', body.dateTo);
    }

    const { data: analyses, error: queryError } = await query;

    if (queryError) {
      console.error('[/api/analyses/search] Database query failed:', queryError);
      return NextResponse.json(
        { error: 'Search query failed' },
        { status: 500 }
      );
    }

    if (!analyses || analyses.length === 0) {
      const queryTime = Math.round(performance.now() - startTime);
      return NextResponse.json<SearchResponse>(
        {
          results: [],
          queryTime,
          resultsCount: 0,
        },
        { status: 200 }
      );
    }

    // 6. Calculate similarity scores client-side and filter by threshold
    // (In production, could use pgvector's <=> operator directly in SQL)
    const results: SearchResult[] = analyses
      .map((analysis: any) => {
        // Calculate cosine similarity: 1 - cosine_distance
        // pgvector vector_cosine_ops returns distance, we convert to similarity
        const similarity = cosineSimilarityFromVector(
          queryEmbedding,
          analysis.embedding
        );

        return {
          id: analysis.id,
          title: analysis.title || 'Untitled Analysis',
          snippet: extractSnippet(analysis.analysis_markdown, 150),
          similarity,
          createdAt: analysis.created_at,
          matchType: 'semantic' as const,
        };
      })
      .filter((result) => result.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    const queryTime = Math.round(performance.now() - startTime);

    const response: SearchResponse = {
      results,
      queryTime,
      resultsCount: results.length,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[/api/analyses/search] Error:', error);
    Sentry.captureException(error, {
      contexts: {
        api: {
          endpoint: '/api/analyses/search',
          method: 'POST',
        },
      },
      tags: {
        endpoint: 'search',
        severity: 'high',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Calculate cosine similarity from stored pgvector embedding
 * Assumes embedding is already normalized or is a valid 1536-dim vector
 *
 * @param vectorA - Query embedding (from generateEmbedding)
 * @param vectorB - Stored embedding from database
 * @returns Similarity score 0-1
 */
function cosineSimilarityFromVector(vectorA: number[], vectorB: any): number {
  // Handle pgvector format (could be array or string)
  let vectorBArray: number[] = [];

  if (Array.isArray(vectorB)) {
    vectorBArray = vectorB;
  } else if (typeof vectorB === 'string') {
    // Parse pgvector string format "[1.0, 2.0, 3.0, ...]"
    try {
      vectorBArray = JSON.parse(vectorB.replace(/\[|\]/g, '').split(',').map(s => s.trim()).join(','));
    } catch {
      return 0;
    }
  } else {
    return 0;
  }

  if (vectorA.length !== vectorBArray.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    const a = vectorA[i];
    const b = vectorBArray[i];
    if (a === undefined) {
      throw new Error(`Query vector has undefined at index ${i}`);
    }
    const bVal = b === undefined ? 0 : b;
    dotProduct += a * bVal;
    normA += a * a;
    normB += bVal * bVal;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Log search usage for quota tracking
 * Non-fatal: errors logged but don't break search
 */
async function logUsage(userId: string, action: string, metadata: any) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    await supabase.from('usage_logs').insert({
      user_id: userId,
      action,
      metadata,
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[logUsage] Failed to log search usage:', error);
    // Non-fatal, don't throw
  }
}
