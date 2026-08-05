export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { verifyContentSig } from '@/lib/stream-token';
import { SupabaseTranscriptAdapter, type ChapterRow } from '@/lib/adapters/SupabaseTranscriptAdapter';

const ChapterInputSchema = z.object({
  idx: z.number().int().min(0),
  start_seconds: z.number().finite().nonnegative(),
  end_seconds: z.number().finite().nonnegative(),
  label: z.string().min(1),
});

const ChaptersPayloadSchema = z.object({
  chapters: z.array(ChapterInputSchema),
  sig: z.string(),
  exp: z.number(),
});

/**
 * POST /api/videos/[videoId]/chapters
 * Decoupled chapter persistence. Called by the Cloudflare Worker via
 * waitUntil, fire-and-forget. Auth: HMAC-signed with BoundSigPurpose 'chapters'.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  try {
    const body = await request.json() as Record<string, unknown>;
    const parsed = ChaptersPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
    }

    const { chapters: rawChapters, sig, exp } = parsed.data;

    const canonical = JSON.stringify({ chapters: rawChapters });
    const isSigValid = await verifyContentSig(canonical, sig, { purpose: 'chapters', id: videoId, exp });
    if (!isSigValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const filteredChapters = rawChapters.filter((c) => c.end_seconds > c.start_seconds);

    if (filteredChapters.length === 0 && rawChapters.length > 0) {
      console.warn('[chapters] All chapter entries had end_seconds <= start_seconds, dropping', { videoId });
    }

    const chapterRows: ChapterRow[] = filteredChapters.map((c) => ({
      video_id: videoId,
      idx: c.idx,
      start_seconds: c.start_seconds,
      end_seconds: c.end_seconds,
      label: c.label,
    }));

    await SupabaseTranscriptAdapter.upsertChapters(
      videoId,
      chapterRows,
      { attemptedButEmpty: chapterRows.length === 0 && rawChapters.length > 0 }
    );

    return NextResponse.json({ ok: true, inserted: chapterRows.length });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { operation: 'chapters_upsert' },
      extra: { videoId },
    });
    console.error('[chapters] Failed to upsert', { message: msg, videoId });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/videos/[videoId]/chapters
 * Fetch chapters for a video (no auth — chapters are per-video, not per-
 * analysis, and the videoId alone is not sensitive). Used by the client-side
 * useChaptersStore hook.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  try {
    const chapters = await SupabaseTranscriptAdapter.getChapters(videoId);
    return NextResponse.json({ chapters });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { operation: 'chapters_get' },
      extra: { videoId },
    });
    console.error('[chapters] Failed to fetch', { message: msg, videoId });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}