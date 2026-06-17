import { verifyResourceOwnership } from '@/lib/services/ownership';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { data: analysis, error } = await verifyResourceOwnership<any>(id, 'analyses');

    if (error === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (error === 'InternalError') {
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    if (error === 'NotFound' || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const report = analysis.validation_report || {};

    return NextResponse.json({
      id: analysis.id,
      videoId: analysis.video_id,
      title: analysis.title || 'Untitled',
      channelTitle: analysis.channel_title,
      model: analysis.model_used || 'unknown',
      analysis_markdown: analysis.analysis_markdown || '',
      analysis_payload: analysis.analysis_payload || null,
      validation_report: report,
      analysisAt: analysis.analysis_at || analysis.created_at,
      detectedPersona: analysis.detected_persona || null,
      streaming: { 
        started: analysis.created_at, 
        interrupted: analysis.streaming_interrupted || false,
        dimensionsReceived: [] 
      },
    });
  } catch (err) {
    console.error('[analyses/[id]] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
