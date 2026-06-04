import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
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
