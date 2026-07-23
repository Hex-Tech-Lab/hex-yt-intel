import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

// Shared-secret auth: this service shells out to external binaries based on
// request input, so it must never be reachable unauthenticated on the public
// internet -- an open shell-adjacent endpoint is a real vulnerability, not
// tech debt to defer. Matches the app's existing pattern of a server-only
// secret (see web's HMAC stream tokens) rather than a full OAuth flow, since
// the only caller is the main app's own backend.
const SHARED_SECRET = process.env.PIPELINE_SHARED_SECRET;

// Strict YouTube video ID shape (11 chars, URL-safe base64 charset). Rejecting
// anything else BEFORE it ever reaches execFile's argv means there is no
// input this service will pass to a subprocess that isn't already known-safe
// -- this is defense in depth on top of execFile (never a shell string) never
// permitting injection in the first place.
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Constant-time string compare -- mirrors web/lib/stream-token.ts's timingSafeEqualHex, the established pattern in this codebase for comparing a caller-supplied secret against a server secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const app = new Hono();

app.use('*', async (c, next) => {
  if (c.req.path === '/health') return next(); // health check is unauthenticated (Railway healthcheck probe)
  if (!SHARED_SECRET) {
    return c.json({ error: 'Service misconfigured: PIPELINE_SHARED_SECRET not set' }, 500);
  }
  const auth = c.req.header('Authorization') ?? '';
  if (!timingSafeEqual(auth, `Bearer ${SHARED_SECRET}`)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return next();
});

/**
 * Smoke-test endpoint: confirms yt-dlp, ffmpeg, and tesseract are actually
 * installed and runnable in this container (not just "the process started"),
 * since a Docker build succeeding says nothing about whether apt/pip
 * installed the right binaries on the right PATH.
 */
app.get('/health', async (c) => {
  // Run independently, in parallel -- Railway polls this every 30s with a
  // 10s timeout (see Dockerfile HEALTHCHECK); three sequential 5s-timeout
  // subprocess checks could burn up to 15s and trip that timeout for no
  // reason, since none of the three checks depends on another.
  const targets = [
    ['yt-dlp', ['--version']],
    ['ffmpeg', ['-version']],
    ['tesseract', ['--version']],
  ] as const;
  const results = await Promise.allSettled(
    targets.map(([name, args]) => execFileAsync(name, args, { timeout: 5000 }))
  );
  const checks: Record<string, string> = {};
  results.forEach((result, i) => {
    const name = targets[i]![0];
    checks[name] = result.status === 'fulfilled'
      ? (result.value.stdout.trim().split('\n')[0] ?? 'ok')
      : `MISSING: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
  });
  const allOk = Object.values(checks).every((v) => !v.startsWith('MISSING'));
  return c.json({ status: allOk ? 'ok' : 'degraded', checks }, allOk ? 200 : 503);
});

/**
 * First real capability: fetch a video's metadata (title, duration, chapters)
 * via yt-dlp --dump-json. Deliberately small and low-risk -- proves the
 * container/binary/auth wiring end-to-end before scene-detection + OCR (the
 * actual Wave C/F feature) is built on top of it.
 */
app.post('/extract-metadata', async (c) => {
  const body = await c.req.json().catch(() => null);
  const videoId = body?.videoId;
  if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) {
    return c.json({ error: 'Invalid or missing videoId' }, 400);
  }

  try {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      ['--dump-json', '--no-playlist', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout);
    return c.json({
      videoId,
      title: data.title,
      duration: data.duration,
      chapters: data.chapters ?? [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[extract-metadata] yt-dlp failed for ${videoId}:`, message);
    return c.json({ error: 'Extraction failed', detail: message }, 502);
  }
});

// ---------------------------------------------------------------------------
// PARKED (2026-07-23): full-video scene detection + OCR.
//
// This service was originally planned to grow a `/extract-scenes` endpoint
// that would `yt-dlp`-download the complete video stream, run FFmpeg
// scene-change detection over the decoded frames, and OCR the resulting
// screenshots. A legal/ToS review concluded that downloading the actual
// audiovisual stream is a violation of YouTube's API Services Terms of
// Service *unconditionally* -- the ToS's own text: "download, import,
// backup, cache, or store copies of YouTube audiovisual content without
// YouTube's prior written approval" -- regardless of whose video it is.
// There is also an unrelated but real DMCA-adjacent legal development around
// the signature/cipher-defeat mechanism yt-dlp uses to fetch playable
// stream URLs at all, which independently raises the risk of that approach.
//
// Per that review, this path was never implemented in this codebase (no
// `/extract-scenes` route exists here or on any sibling branch as of this
// writing) -- it is being recorded here as explicitly parked, not silently
// dropped, because a legal-strategy note may reopen it later. That is a
// future legal/product decision, not something to build speculatively now.
//
// The active Wave C/F path is `/extract-storyboard` below: YouTube's own
// officially-served storyboard sprite thumbnails (the same scrub-preview
// images the web player already fetches) plus the `chapters` field from
// `yt-dlp --dump-json` -- both metadata/preview-image fetches, never a
// download of the actual video/audio stream. See the docstring on
// `/extract-storyboard` for the metadata-only reasoning in detail.
// ---------------------------------------------------------------------------

/** A single chapter as returned by yt-dlp's `chapters` field. */
interface YtDlpChapter {
  start_time: number;
  end_time: number;
  title: string;
}

/** The subset of a yt-dlp storyboard `formats[]` entry this endpoint needs. */
interface YtDlpStoryboardFormat {
  format_id: string;
  width: number;
  height: number;
  rows: number;
  columns: number;
  fragments: Array<{ url: string; duration: number }>;
}

/**
 * yt-dlp exposes several storyboard resolution tiers (sb0 highest ... sbN
 * lowest, one per `formats[]` entry with `rows`/`columns`/`fragments`).
 * Picking the widest tile gives OCR the most pixels to work with -- still
 * small (order ~160-320px wide per tile, this is a scrub-preview image, not
 * a video frame) but strictly better than a lower tier.
 */
function pickBestStoryboardFormat(formats: unknown[]): YtDlpStoryboardFormat | null {
  const candidates = (formats as YtDlpStoryboardFormat[]).filter(
    (f) => Array.isArray(f?.fragments) && f.fragments.length > 0 && f.rows && f.columns
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, f) => (f.width > best.width ? f : best), candidates[0]!);
}

/**
 * Decides which timestamps to OCR. Chapter boundaries are the highest-value
 * targets (a scene/topic change is exactly what a chapter marks); if the
 * video has none, fall back to an even sampling interval. Either way, the
 * result is capped at MAX_TILES so a long video can't turn into hundreds of
 * sequential tesseract subprocess calls on a single request.
 */
function buildSampleTimestamps(chapters: YtDlpChapter[], totalDuration: number): number[] {
  const MAX_TILES = 20;
  const SAMPLE_INTERVAL_SECONDS = 60;

  const timestamps =
    chapters.length > 0
      ? chapters.map((ch) => ch.start_time)
      : Array.from(
          { length: Math.max(1, Math.floor(totalDuration / SAMPLE_INTERVAL_SECONDS)) },
          (_, i) => i * SAMPLE_INTERVAL_SECONDS
        );

  return timestamps.slice(0, MAX_TILES);
}

/** Locates which sprite-sheet fragment + grid cell covers a given timestamp. */
function locateTile(
  format: YtDlpStoryboardFormat,
  timestamp: number
): { sheetUrl: string; col: number; row: number } | null {
  let elapsed = 0;
  for (const fragment of format.fragments) {
    const fragmentEnd = elapsed + fragment.duration;
    if (timestamp < fragmentEnd || fragment === format.fragments.at(-1)) {
      const tilesInFragment = format.rows * format.columns;
      const tileDuration = fragment.duration / tilesInFragment;
      const offsetInFragment = timestamp - elapsed;
      const tileIndex = Math.min(
        tilesInFragment - 1,
        Math.max(0, Math.floor(offsetInFragment / tileDuration))
      );
      return {
        sheetUrl: fragment.url,
        col: tileIndex % format.columns,
        row: Math.floor(tileIndex / format.columns),
      };
    }
    elapsed = fragmentEnd;
  }
  return null;
}

/**
 * Fetches YouTube's officially-served storyboard chapters + sprite thumbnails
 * and OCRs the tiles nearest each chapter boundary (or an even time sampling
 * if the video has no chapters). This is the ToS-clean replacement for the
 * parked full-video-download scene-detection approach above:
 *
 * - `chapters` comes straight from yt-dlp's metadata extraction (no stream
 *   download involved at all).
 * - Storyboard sprite sheets are small preview-thumbnail grids served from
 *   `i.ytimg.com/sb/...` -- the same trust tier and mechanism as the
 *   `i.ytimg.com/vi/{id}/hqdefault.jpg` thumbnail this app already fetches
 *   directly elsewhere (see web/components/templates/console/
 *   VideoPlayerCard.tsx's fallback player). Fetching a handful of these is
 *   an image download, not a video/audio stream download, so it does not
 *   trip the ToS clause the legal review flagged.
 *
 * Known, accepted quality tradeoff: storyboard tiles top out at roughly
 * 320x180px (YouTube's highest-resolution scrub-preview tier) -- far below
 * a real decoded video frame. OCR on-screen text (slides, code, lower
 * thirds) is legible when the text is large/high-contrast, and unreliable
 * or blank on small/busy on-screen text. That's an inherent ceiling of using
 * preview thumbnails instead of real frames, not a bug in this endpoint --
 * documented rather than silently downgrading further or reaching for the
 * disallowed full-video path.
 */
app.post('/extract-storyboard', async (c) => {
  const body = await c.req.json().catch(() => null);
  const videoId = body?.videoId;
  if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) {
    return c.json({ error: 'Invalid or missing videoId' }, 400);
  }

  let workDir: string | null = null;
  try {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      ['--dump-json', '--no-playlist', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`],
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout);
    const chapters: YtDlpChapter[] = data.chapters ?? [];
    const duration: number = data.duration ?? 0;
    const format = pickBestStoryboardFormat(data.formats ?? []);

    if (!format) {
      return c.json({ videoId, chapters, tiles: [], warning: 'No storyboard available for this video' });
    }

    const timestamps = buildSampleTimestamps(chapters, duration);
    workDir = await mkdtemp(join(tmpdir(), 'sb-'));

    // Sheets are re-fetched at most once per distinct URL (a fragment
    // typically covers many sample timestamps), then cropped+OCR'd
    // sequentially -- simplest correct implementation; if OCR latency
    // becomes a problem for long videos, parallelizing per-tile is the
    // natural next step, not a rewrite.
    const sheetCache = new Map<string, string>(); // url -> local file path
    const tiles: Array<{ timestamp: number; text: string }> = [];

    for (const timestamp of timestamps) {
      const tile = locateTile(format, timestamp);
      if (!tile) continue;

      let sheetPath = sheetCache.get(tile.sheetUrl);
      if (!sheetPath) {
        const res = await fetch(tile.sheetUrl);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        sheetPath = join(workDir, `sheet-${sheetCache.size}.jpg`);
        await writeFile(sheetPath, buf);
        sheetCache.set(tile.sheetUrl, sheetPath);
      }

      const tilePath = join(workDir, `tile-${Math.round(timestamp)}.jpg`);
      const x = tile.col * format.width;
      const y = tile.row * format.height;
      await execFileAsync(
        'ffmpeg',
        ['-y', '-i', sheetPath, '-vf', `crop=${format.width}:${format.height}:${x}:${y}`, '-q:v', '2', tilePath],
        { timeout: 10000 }
      );

      // `tesseract <input> stdout` prints OCR text to stdout instead of
      // writing a `.txt` file -- avoids a second temp file + read per tile.
      const { stdout: ocrText } = await execFileAsync('tesseract', [tilePath, 'stdout'], { timeout: 10000 });
      tiles.push({ timestamp, text: ocrText.trim() });
    }

    return c.json({ videoId, chapters, storyboardResolution: { width: format.width, height: format.height }, tiles });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[extract-storyboard] failed for ${videoId}:`, message);
    return c.json({ error: 'Extraction failed', detail: message }, 502);
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[video-pipeline] listening on port ${info.port}`);
});
