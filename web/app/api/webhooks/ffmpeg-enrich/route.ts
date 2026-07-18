export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { SupabaseTranscriptAdapter, deduplicateMarkers, type TranscriptMarker } from '@/lib/adapters/SupabaseTranscriptAdapter';
import * as Sentry from '@sentry/nextjs';
import { createHash } from 'crypto';

function hashQuote(text: string): string {
  return createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 16);
}

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.clone().text();
    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const markerSchema = z.object({
      video_id: z.string().min(5),
      start_seconds: z.number().min(0),
      end_seconds: z.number().min(0),
      importance: z.number().min(0).max(1).default(0.5),
      keywords: z.array(z.string()).optional().default([]),
      entities: z.array(z.string()).optional().default([]),
      quote_hash: z.string().optional().default(''),
      dim_refs: z.array(z.number()).optional().default([]),
      genre: z.string().optional().default('unknown'),
      source: z.string().optional().default('drift'),
    });

    const bodySchema = z.object({
      videoId: z.string().min(5),
      durationSeconds: z.number().optional().default(600),
      genre: z.string().optional().default('unknown'),
      existingMarkers: z.array(markerSchema).optional().default([]),
      chapters: z.array(z.object({ start: z.number(), end: z.number(), title: z.string() })).optional().default([]),
      sceneCuts: z.array(z.number()).optional().default([]),
    });

    const parsed = bodySchema.safeParse(JSON.parse(bodyText || '{}'));

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
    }

    const { videoId, genre, existingMarkers, chapters, sceneCuts } = parsed.data;

    const existing = existingMarkers.map((m, idx) => ({
      ...m,
      idx,
      video_id: videoId,
      importance: Math.max(0, Math.min(1, m.importance)),
    }));
    const chapterMarkers: TranscriptMarker[] = chapters.map((ch, idx) => ({
      video_id: videoId,
      idx: existing.length + idx,
      start_seconds: ch.start,
      end_seconds: ch.end,
      keywords: ch.title.split(' ').slice(0, 5),
      entities: [],
      quote_hash: hashQuote(ch.title),
      importance: 0.9,
      dim_refs: [],
      genre,
      source: 'chapter',
      created_at: new Date().toISOString(),
    } as any));

    const sceneMarkers: TranscriptMarker[] = sceneCuts.map((t, idx) => ({
      video_id: videoId,
      idx: existing.length + chapters.length + idx,
      start_seconds: t,
      end_seconds: t + 5,
      keywords: [],
      entities: [],
      quote_hash: hashQuote(`scene-${t}`),
      importance: 0.6,
      dim_refs: [],
      genre,
      source: 'scene',
      created_at: new Date().toISOString(),
    } as any));

    const all = [...existing, ...chapterMarkers, ...sceneMarkers];
    const deduped = deduplicateMarkers(all, 5);

    await SupabaseTranscriptAdapter.saveMarkers(deduped);

    console.log('[ffmpeg-enrich] video', videoId, 'from', all.length, 'to', deduped.length);
    return NextResponse.json({ ok: true, videoId, from: all.length, to: deduped.length, markers: deduped });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { contexts: { api: { endpoint: '/api/webhooks/ffmpeg-enrich' } } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
