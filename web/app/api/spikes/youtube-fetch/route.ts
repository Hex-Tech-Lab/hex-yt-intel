import { NextResponse } from 'next/server';
import { TranscriptExtractor } from '@worker/services/TranscriptExtractor';
import { MetadataScraper } from '@worker/services/MetadataScraper';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface FetchOutcome {
  kind: 'transcript' | 'metadata' | 'comments';
  ok: boolean;
  status: number | null;
  latencyMs: number;
  bytes: number | null;
  error: string | null;
}

function statusFromError(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/returned (\d{3})/);
  return m ? Number(m[1]) : null;
}

async function measure(
  kind: FetchOutcome['kind'],
  fn: () => Promise<unknown>,
  byteSize: (result: unknown) => number
): Promise<FetchOutcome> {
  const start = performance.now();
  try {
    const result = await fn();
    return {
      kind,
      ok: true,
      status: null,
      latencyMs: Math.round(performance.now() - start),
      bytes: byteSize(result),
      error: null,
    };
  } catch (err) {
    return {
      kind,
      ok: false,
      status: statusFromError(err),
      latencyMs: Math.round(performance.now() - start),
      bytes: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const secret = request.headers.get('x-spike-secret');
  if (!secret || secret !== process.env.LOGS_SNAPSHOT_HMAC_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const idsParam = new URL(request.url).searchParams.get('ids');
  if (!idsParam) {
    return NextResponse.json({ error: 'Missing ?ids=' }, { status: 400 });
  }
  const ids = idsParam.split(',').filter(Boolean).slice(0, 20);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No ids provided' }, { status: 400 });
  }

  const proxyUrl = process.env.RESIDENTIAL_PROXY_URL;
  const decodoKey = process.env.DECODO_API_KEY;
  const ytKey = process.env.YOUTUBE_API_KEY;

  const results = await Promise.all(
    ids.map(async (videoId) => {
      const extractor = new TranscriptExtractor(proxyUrl, decodoKey);
      const scraper = new MetadataScraper(ytKey ?? '', proxyUrl);

      const [transcript, metadata, comments] = await Promise.all([
        measure(
          'transcript',
          () => extractor.fetch(videoId),
          (r) => {
            const t = r as { transcript?: string };
            return t.transcript ? t.transcript.length : 0;
          }
        ),
        measure(
          'metadata',
          () => scraper.fetch(videoId),
          (r) => JSON.stringify(r).length
        ),
        measure(
          'comments',
          () => scraper.fetchComments(videoId, 20),
          (r) => JSON.stringify(r).length
        ),
      ]);

      return { videoId, transcript, metadata, comments };
    })
  );

  const transcriptOk = results.filter((r) => r.transcript.ok).length;
  const verdict =
    transcriptOk >= 19 && results.every((r) => r.transcript.status !== 429 && r.transcript.status !== 403)
      ? 'PASS'
      : 'FAIL';

  return NextResponse.json({ verdict, transcriptOk, total: results.length, results });
}
