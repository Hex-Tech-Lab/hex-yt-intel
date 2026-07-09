import { NextRequest, NextResponse } from 'next/server';

import { verifyResourceOwnership } from '@/lib/services/ownership';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';
import { SupabaseAnalysisAdapter } from '@/lib/adapters/SupabaseAnalysisAdapter';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';

export const runtime = 'edge';

const MAX_EDGE_PAYLOAD_BYTES = 100_000;

function safeReconstructMarkdown(analysis: { analysis_markdown?: string | null; analysis_payload?: Partial<UCISPayloadV2> | null }): string { try { return getAnalysisMarkdown(analysis); } catch { console.warn('[analyses] markdown reconstruction failed, returning empty'); return ''; } }

function getAnalysisMarkdown(analysis: { analysis_markdown?: string | null; analysis_payload?: Partial<UCISPayloadV2> | null }): string {
  if (analysis.analysis_markdown) return analysis.analysis_markdown;
  if (!analysis.analysis_payload) return '';
  const payloadSize = new TextEncoder().encode(JSON.stringify(analysis.analysis_payload)).length;
  if (payloadSize > MAX_EDGE_PAYLOAD_BYTES) {
    console.warn('[analyses] Payload too large for edge reconstruction, skipping:', payloadSize);
    return '';
  }
  return reconstructMarkdown(analysis.analysis_payload);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { data: analysis, error } = await verifyResourceOwnership<any>(id, 'analyses', 'id, user_id, video_id, title, channel_title, model_used, analysis_markdown, analysis_payload, validation_report, executive_digest, created_at, updated_at, billing_status, validation_passed');

    const errorResponses: Record<string, { error: string; status: number }> = {
      Unauthorized: { error: 'Unauthorized', status: 401 },
      InternalError: { error: 'Internal server error', status: 500 },
      NotFound: { error: 'Analysis not found', status: 404 },
    };

    const response = errorResponses[error as string];
    if (response || !analysis) {
      return NextResponse.json(response ?? { error: 'Analysis not found' }, { status: response?.status ?? 404 });
    }

    const report = analysis.validation_report || {};

    if (!analysis.analysis_payload && !analysis.analysis_markdown) {
      return NextResponse.json({ error: 'Analysis payload stub is missing', status: 'incomplete' }, { status: 404 });
    }

    // Count this open as a "view" (product decision: every open of a saved
    // analysis counts). Only reached for an owned, non-stub row, so it is safe
    // to attribute the view here. Atomic + self-contained error handling, so it
    // never breaks rendering the analysis.
    if (analysis.user_id) {
      await SupabaseAnalysisAdapter.incrementViewCount({ analysisId: analysis.id, userId: analysis.user_id });
    }

    // Persona lives inside analysis_payload.persona.primary — there is no
    // detected_persona/analysis_at/streaming_interrupted column on `analyses`.
    const payload = (analysis.analysis_payload || {}) as { persona?: { primary?: { id?: string; label?: string } } };
    const primaryPersona = payload.persona?.primary;

    // Compute frontend-visible status: only 'complete' if billing_status='completed' AND validation_passed=true
    const analysisStatus: 'complete' | 'incomplete' | 'error' =
      analysis.billing_status === 'completed' && analysis.validation_passed
        ? 'complete'
        : analysis.billing_status === 'failed' || (report as any).status === 'error'
        ? 'error'
        : 'incomplete';

    return NextResponse.json({
      id: analysis.id,
      videoId: analysis.video_id,
      title: analysis.title || 'Untitled',
      channelTitle: analysis.channel_title,
      model: analysis.model_used || 'unknown',
      analysis_markdown: safeReconstructMarkdown(analysis),
      analysis_payload: analysis.analysis_payload || null,
      validation_report: report,
      executiveDigest: analysis.executive_digest || null,
      analysisAt: analysis.created_at,
      analysisStatus,
      detectedPersona: primaryPersona?.id ?? primaryPersona?.label ?? null,
      streaming: {
        started: analysis.created_at,
        interrupted: false,
        dimensionsReceived: []
      },
    });
  } catch (err) {
    console.error('[analyses/[id]] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
