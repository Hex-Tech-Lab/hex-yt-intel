export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30; // seconds, allow longer processing on Vercel Edge

import { NextRequest, NextResponse } from 'next/server';


import * as Sentry from '@sentry/nextjs';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';


/**
 * POST /api/chat
 * Handles chat queries with bifurcated scope handling.
 *
 * Expected JSON body:
 * {
 *   "scope": "video" | "global",
 *   "videoId": string,          // required when scope === 'video'
 *   "analysisId": string,       // optional, used for grounding
 *   "query": string,            // user prompt
 *   "models": string[]          // optional list of allowed model IDs
 * }
 */
export async function POST(req: NextRequest) {
  const authAdapter = new SupabaseAuthAdapter();


  // Authenticate user
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { scope, videoId, query } = body as {
      scope?: string;
      videoId?: string;
      query?: string;
    };

    if (!scope || (scope !== 'video' && scope !== 'global')) {
      return NextResponse.json({ error: 'Invalid or missing scope' }, { status: 400 });
    }
    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Missing query string' }, { status: 400 });
    }

    // Prepare adapters


    // Business logic implementation
    const userId = (identity as any).id;
    const persistence = new SupabasePersistenceAdapter();

    if (scope === 'video') {
      if (!videoId) {
        return NextResponse.json({ error: 'videoId required for video scope' }, { status: 400 });
      }
      // Retrieve cached analysis (metadata + markdown)
      const analysis = await persistence.findCachedAnalysis({ userId, videoId });
      if (!analysis) {
        return NextResponse.json({ error: 'No analysis found for video' }, { status: 404 });
      }
      // Retrieve analysis chunks if any
      const chunks = await persistence.findAnalysisChunks({ analysisId: analysis.id });
      return NextResponse.json(
        {
          scope,
          videoId,
          analysisId: analysis.id,
          markdown: analysis.analysisMarkdown,
          chunks: chunks || [],
        },
        { status: 200 }
      );
    } else {
      // global scope – aggregate knowledge graphs across all user's analyses
      const analyses = await persistence.getAnalysesByTenant(userId);
      const knowledgeBase = analyses.map(a => ({
        analysisId: a.id,
        title: a.title,
        nodes: a.nodes,
        edges: a.edges,
      }));
      return NextResponse.json({ scope, knowledgeBase }, { status: 200 });
    }

    // Removed orphaned return; response already sent in scope branches
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { operation: 'chat-route' },
      contexts: { api: { endpoint: '/api/chat' } },
    });
    console.error('[chat] Unexpected error:', msg);
    // ADR 007: silent error handling – return generic error without leaking internals
    return NextResponse.json({ error: 'Failed to process chat request' }, { status: 500 });
  } finally {
    // Ensure any pending Sentry events are flushed before exiting
    if (typeof Sentry.flush === 'function') {
      void Sentry.flush(2000);
    }
  }
}
