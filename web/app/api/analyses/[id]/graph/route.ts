import { NextRequest, NextResponse } from 'next/server';
import { verifyResourceOwnership } from '@/lib/services/ownership';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import * as Sentry from '@sentry/nextjs';

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
    // 1. Authenticate and Audit Ownership via centralized service
    const { data: analysis, error } = await verifyResourceOwnership<{ id: string }>(analysisId, 'analyses', 'id');

    if (error === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (error === 'NotFound' || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // 2. Fetch Graph Data via Adapter
    const persistence = new SupabasePersistenceAdapter();
    const graphData = await persistence.getKnowledgeGraph(analysisId);

    return NextResponse.json(graphData || { entities: [], relations: [] });
    
  } catch (error: any) {
    Sentry.captureException(error, {
      tags: { operation: 'get-knowledge-graph' },
      extra: { analysisId },
    });
    console.error('[getKnowledgeGraph] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
