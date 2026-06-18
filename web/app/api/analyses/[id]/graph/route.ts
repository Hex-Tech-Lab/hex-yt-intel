import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { verifyResourceOwnership } from '@/lib/services/ownership';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';

/**
 * FETCHES KNOWLEDGE GRAPH FOR AN ANALYSIS
 * Security: Enforces ownership check (401/404 if user does not own analysis).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: analysisId } = await params;

  try {
    const { data: analysis, error } = await verifyResourceOwnership<{ id: string }>(analysisId, 'analyses', 'id');

    if (error === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (error === 'InternalError') {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    if (error === 'NotFound' || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const persistence = new SupabasePersistenceAdapter();
    const graphData = await persistence.getKnowledgeGraph(analysisId);

    return NextResponse.json(graphData || { entities: [], relations: [] });

  } catch (error: unknown) {
    Sentry.captureException(error, {
      tags: { operation: 'get-knowledge-graph' },
      extra: { analysisId },
    });
    console.error('[getKnowledgeGraph]', { message: error instanceof Error ? error.message : String(error), analysisId });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
