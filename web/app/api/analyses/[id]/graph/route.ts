import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import * as Sentry from '@sentry/nextjs';

/**
 * FETCHES KNOWLEDGE GRAPH FOR AN ANALYSIS
 * Security: Enforces ownership check (403 if user does not own analysis).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: analysisId } = await params;
  
  try {
    const supabase = await getSupabaseClientWithAuth();
    
    // 1. Authenticate and authorize
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Ownership Audit: verify user owns the analysis
    const { data: analysis, error: authError } = await supabase
      .from('analyses')
      .select('user_id')
      .eq('id', analysisId)
      .single();

    if (authError || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    if (analysis.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 3. Fetch Graph Data via Adapter
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
