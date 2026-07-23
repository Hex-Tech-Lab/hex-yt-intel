import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
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

/** Shared by /extract-metadata and /extract-scenes (the latter needs duration up front to reject oversized videos before downloading). */
async function fetchVideoInfo(videoId: string): Promise<{ title: string; duration: number; chapters: unknown[] }> {
  const { stdout } = await execFileAsync(
    'yt-dlp',
    ['--dump-json', '--no-playlist', '--skip-download', `https://www.youtube.com/watch?v=${videoId}`],
    { timeout: 30000, maxBuffer: 10 * 1024 * 1024 }
  );
  const data = JSON.parse(stdout);
  return { title: data.title, duration: data.duration, chapters: data.chapters ?? [] };
}

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
    const info = await fetchVideoInfo(videoId);
    return c.json({ videoId, ...info });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[extract-metadata] yt-dlp failed for ${videoId}:`, message);
    return c.json({ error: 'Extraction failed', detail: message }, 502);
  }
});

// Bounds for /extract-scenes -- this endpoint downloads a real video file and
// runs two more subprocesses (ffmpeg, tesseract) per request, so unlike
// /extract-metadata it has real resource cost. These caps exist to keep any
// one request from exhausting Railway's disk/CPU, not because the numbers
// are precise -- tune from observed usage once this is live.
const MAX_VIDEO_DURATION_SECONDS = 4 * 60 * 60; // 4h
const MAX_SCENES_HARD_CAP = 60;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10 min
const SCENE_DETECT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const OCR_TIMEOUT_MS = 15 * 1000; // per frame

/**
 * Runs `ffmpeg -vf "select='gt(scene,threshold)',showinfo"` and parses the
 * `pts_time:` values showinfo prints for each frame that passed the select
 * filter. Frame N's pts_time corresponds to the Nth output file
 * (`frame_%04d.jpg`, 1-indexed) because -vsync vfr only ever writes frames
 * that passed select, in the same order showinfo logs them -- this is the
 * standard technique for tying ffmpeg's scene-change filter back to
 * wall-clock timestamps, since select/showinfo alone don't expose timestamps
 * in their filenames.
 */
async function detectScenesAndExtractFrames(
  videoPath: string,
  workDir: string,
  threshold: number
): Promise<Array<{ timestampSeconds: number; framePath: string }>> {
  const framePattern = join(workDir, 'frame_%04d.jpg');
  const { stderr } = await execFileAsync(
    'ffmpeg',
    [
      '-i', videoPath,
      '-vf', `select='gt(scene,${threshold})',showinfo`,
      '-vsync', 'vfr',
      '-q:v', '4',
      framePattern,
    ],
    { timeout: SCENE_DETECT_TIMEOUT_MS, maxBuffer: 50 * 1024 * 1024 }
  );

  const timestamps: number[] = [];
  for (const match of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    const v = match[1];
    if (v !== undefined) timestamps.push(Number.parseFloat(v));
  }

  const files = (await readdir(workDir)).filter((f) => f.startsWith('frame_')).sort();
  return files.map((file, i) => ({
    timestampSeconds: timestamps[i] ?? -1,
    framePath: join(workDir, file),
  })).filter((f) => f.timestampSeconds >= 0);
}

/** OCRs a single frame to plain text via `tesseract <img> stdout`. Returns '' (not a thrown error) on per-frame OCR failure so one bad frame doesn't fail the whole batch. */
async function ocrFrame(framePath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('tesseract', [framePath, 'stdout'], {
      timeout: OCR_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    console.error(`[extract-scenes] tesseract failed for ${framePath}:`, err instanceof Error ? err.message : err);
    return '';
  }
}

/**
 * Scene-change detection + OCR: downloads the video at a bounded quality
 * (this is for on-screen-text extraction, not viewing, so 480p is plenty and
 * keeps download time/disk bounded), finds visually distinct frames via
 * FFmpeg's scene filter, and OCRs each one with tesseract. Returns text
 * grounded to timestamps -- e.g. for slide/chapter/on-screen-text-heavy
 * videos where the transcript alone won't capture what's shown.
 *
 * Deliberately synchronous (no job queue / polling) -- Railway has no
 * per-request timeout, which is the whole reason this service isn't on
 * Vercel, so a long-running request is the intended shape here, not a
 * workaround.
 *
 * Returns images as base64 JPEG in the response rather than persisting them
 * anywhere -- this service has no Supabase credentials and no opinion on
 * storage. Whether/how results get persisted (S2S callback vs. polling,
 * Supabase Storage vs. something else) is unresolved integration work, not
 * decided here.
 */
app.post('/extract-scenes', async (c) => {
  const body = await c.req.json().catch(() => null);
  const videoId = body?.videoId;
  if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) {
    return c.json({ error: 'Invalid or missing videoId' }, 400);
  }
  const threshold = typeof body?.threshold === 'number' && body.threshold > 0 && body.threshold < 1
    ? body.threshold
    : 0.4;
  const maxScenes = typeof body?.maxScenes === 'number' && body.maxScenes > 0
    ? Math.min(Math.floor(body.maxScenes), MAX_SCENES_HARD_CAP)
    : 20;

  let workDir: string | undefined;
  try {
    const info = await fetchVideoInfo(videoId);
    if (info.duration > MAX_VIDEO_DURATION_SECONDS) {
      return c.json({
        error: `Video duration ${info.duration}s exceeds max ${MAX_VIDEO_DURATION_SECONDS}s`,
      }, 422);
    }

    workDir = await mkdtemp(join(tmpdir(), `scenes-${randomUUID()}-`));
    const videoPath = join(workDir, 'video.mp4');

    await execFileAsync(
      'yt-dlp',
      [
        '-f', 'bv*[height<=480]+ba/best[height<=480]',
        '--merge-output-format', 'mp4',
        '--max-filesize', '500M',
        '--no-playlist',
        '-o', videoPath,
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    );

    const frames = await detectScenesAndExtractFrames(videoPath, workDir, threshold);
    const capped = frames.slice(0, maxScenes);

    const scenes = await Promise.all(capped.map(async ({ timestampSeconds, framePath }) => {
      const [ocrText, imageBuffer] = await Promise.all([
        ocrFrame(framePath),
        readFile(framePath),
      ]);
      return {
        timestampSeconds,
        ocrText,
        imageBase64: imageBuffer.toString('base64'),
        mimeType: 'image/jpeg',
      };
    }));

    return c.json({
      videoId,
      sceneCount: scenes.length,
      truncated: frames.length > capped.length,
      scenes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[extract-scenes] failed for ${videoId}:`, message);
    return c.json({ error: 'Scene extraction failed', detail: message }, 502);
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[video-pipeline] listening on port ${info.port}`);
});
