import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = await getSupabaseClientWithAuth();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: analysis, error } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    // Parse the stored analysis markdown back into structured data
    const analysisMarkdown = analysis.analysis_markdown || '';

    return NextResponse.json({
      id: analysis.id,
      videoId: analysis.video_id,
      title: analysis.title || 'Untitled',
      channelTitle: analysis.channel_title,
      model: analysis.model_used || 'unknown',
      analysis_markdown: analysisMarkdown,
      validation_report: analysis.validation_report || { passed: true },
      streaming: { started: analysis.created_at, dimensionsReceived: [] },
    });
  } catch (err) {
    console.error('[analyses/[id]] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
