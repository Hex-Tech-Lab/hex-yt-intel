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

  const params = new URL(request.url).searchParams;
  const idsParam = params.get('ids');
  if (!idsParam) {
    return NextResponse.json({ error: 'Missing ?ids=' }, { status: 400 });
  }
  const ids = idsParam.split(',').filter(Boolean).slice(0, 20);
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No ids provided' }, { status: 400 });
  }

  // tier=native omits the Decodo key so TranscriptExtractor falls straight
  // through to the YouTube-native tier — the true "does YouTube block raw
  // Vercel datacenter IPs" measurement (Decodo would mask it behind the
  // residential proxy).
  const forcedNative = params.get('tier') === 'native';

  // Raw HTTP probe from the Vercel datacenter IP (no extractor, no proxy):
  // the direct answer to R2 — does YouTube block datacenter IPs at all?
  let probe: { watch: { status: number; blocked: boolean; snippet: string } | null; timedtext: { status: number } | null } | null = null;
  if (params.get('probe') === '1') {
    const probeId = ids[0] as string;
    const watchRes = await fetch(`https://www.youtube.com/watch?v=${probeId}&hl=en`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' },
    });
    const body = await watchRes.text();
    const blocked = /consent\.youtube\.com|class="g-recaptcha"|LOGIN_REQUIRED|Sign in to confirm you/.test(body) || body.length < 2000;
    probe = {
      watch: { status: watchRes.status, blocked, snippet: body.slice(0, 200).replace(/\s+/g, ' ') },
      timedtext: null,
    };
    const ttRes = await fetch(`https://www.youtube.com/api/timedtext?v=${probeId}&lang=en`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' },
    });
    probe.timedtext = { status: ttRes.status };
  }

  const proxyUrl = forcedNative ? undefined : process.env.RESIDENTIAL_PROXY_URL;
  const decodoKey = forcedNative ? undefined : process.env.DECODO_API_KEY;
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

  return NextResponse.json({ verdict, transcriptOk, total: results.length, probe, results });
}
