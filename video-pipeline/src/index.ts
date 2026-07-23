import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

const port = Number(process.env.PORT) || 8080;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[video-pipeline] listening on port ${info.port}`);
});
