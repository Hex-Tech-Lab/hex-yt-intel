export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { verifyContentSig } from '@/lib/stream-token';
import { SupabaseTranscriptAdapter } from '@/lib/adapters/SupabaseTranscriptAdapter';
import type { ChapterRow } from '@/lib/adapters/SupabaseTranscriptAdapter';

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

    const filteredChapters = rawChapters.filter((chapter) => chapter.end_seconds > chapter.start_seconds);

    // Three distinct states, NOT the two this originally collapsed into
    // (found live during PR #205 review and re-verified here, 2026-08-06):
    // genuinely empty (worker parsed zero chapters -- attemptedButEmpty
    // MUST be true so the orange sentinel actually gets written, otherwise
    // upsertChapters no-ops per its own `chapters.length === 0 &&
    // !attemptedButEmpty` short-circuit and the chip can never leave grey)
    // vs. all-submitted-chapters-malformed (rawChapters had elements, every
    // one failed the end>start filter -- must SKIP persistence entirely,
    // not treat as an empty-parse sentinel, because attemptedButEmpty=true
    // deletes existing real idx>=0 rows for the video: a malformed
    // submission must never be able to wipe out previously-valid chapters).
    const allChaptersMalformed = rawChapters.length > 0 && filteredChapters.length === 0;
    if (allChaptersMalformed) {
      Sentry.captureMessage('videos/[videoId]/chapters: all submitted chapters malformed, skipping persistence', {
        level: 'warning',
        tags: { operation: 'chapters-persist' },
        extra: { videoId, submittedCount: rawChapters.length },
      });
      console.error('[chapters] All submitted chapters were malformed -- skipping persistence entirely, not treating as an empty parse', { videoId, submittedCount: rawChapters.length });
      return NextResponse.json({ ok: true, inserted: 0, skipped: 'all_malformed' });
    }

    const chapterRows: ChapterRow[] = filteredChapters.map((chapter) => ({
      video_id: videoId,
      idx: chapter.idx,
      start_seconds: chapter.start_seconds,
      end_seconds: chapter.end_seconds,
      label: chapter.label,
    }));

    await SupabaseTranscriptAdapter.upsertChapters(
      videoId,
      chapterRows,
      { attemptedButEmpty: rawChapters.length === 0 }
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
 *
 * Returns `confirmed: true` when the empty/nonempty result reflects a real
 * write (a sentinel or real rows exist) vs `confirmed: false` when there's
 * no data at all yet -- the worker's fire-and-forget parse+persist (fired
 * from inside the SSE stream handler) can genuinely still be in flight when
 * this GET lands. The client hook must keep retrying on `confirmed: false`,
 * not treat an unconfirmed empty result as final.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  const { videoId } = await params;

  try {
    const { chapters, confirmed } = await SupabaseTranscriptAdapter.getChaptersWithStatus(videoId);
    return NextResponse.json({ chapters, confirmed });
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