import * as Sentry from '@sentry/nextjs';
import { env } from '@/lib/env';
import { detectPersona } from '@/lib/prompts';
import { isTrustedWorkerOrigin } from '@/lib/utils/worker-origin-allowlist';
import { SupabaseTranscriptAdapter } from '@/lib/adapters/SupabaseTranscriptAdapter';
import type { VideoMetadata, IngestionResult, MetadataIngestionPort, TranscriptSegment } from '@/lib/ports';
import type { PersonaId } from '@/lib/prompts';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';

interface WorkerMetadataResponse {
  title: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  duration: number | null;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  thumbnailUrl: string | null;
  description?: string;
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
] as const;

function getRandomUserAgent(): string {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index] as string;
}

/** Worker-origin guard (SSRF prevention). Kept as a method so the checks stay in one place. */
const workerUrlGuard = {
  /** Throws unless the worker URL is configured, https, and on the approved allowlist. */
  assertTrusted(workerUrl: string | undefined): void {
    if (!workerUrl || workerUrl.includes('[build-time-placeholder')) {
      throw new Error('Worker URL not configured');
    }
    const urlObj = new URL(workerUrl);
    if (urlObj.protocol !== 'https:' || !isTrustedWorkerOrigin(urlObj.hostname)) {
      console.error('[fetchWorkerTranscript] SECURITY: Rejected untrusted worker origin', { hostname: urlObj.hostname });
      throw new Error(`Worker URL origin '${urlObj.hostname}' is not in approved allowlist. SSRF prevention enforced.`);
    }
  },
};

async function fetchWorkerTranscript(videoId: string): Promise<{ transcript: string; segments?: TranscriptSegment[]; language?: string }> {
  const workerUrl = env.cloudflareWorkerUrl;
  workerUrlGuard.assertTrusted(workerUrl);

  try {
    const response = await fetch(`${workerUrl}/fetch-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });

    if (!response.ok) {
      throw new Error(`Worker returned ${response.status} fetching transcript`);
    }

    // The worker's TranscriptExtractor.fetch() (spread via `...result` in
    // /fetch-transcript) already includes timed `segments` -- previously only
    // `data.transcript` was read here, discarding them at this boundary.
    const data = await response.json();
    return { transcript: data.transcript || '', segments: Array.isArray(data.segments) ? data.segments : undefined, language: typeof data.language === 'string' && data.language ? data.language : undefined };
  } catch (error) {
    // A rejection here previously vanished into Promise.allSettled with zero
    // telemetry, silently degrading to "no transcript" -- indistinguishable
    // from the video genuinely having no captions. Surface it.
    Sentry.captureException(error, {
      tags: { component: 'WorkerIngestionAdapter', phase: 'fetch-transcript' },
      extra: { videoId },
    });
    console.error('[fetchWorkerTranscript] Failed', { videoId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function fetchWorkerMetadata(videoId: string): Promise<WorkerMetadataResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const workerUrl = env.cloudflareWorkerUrl;

    if (!workerUrl || workerUrl.includes('[build-time-placeholder')) {
      throw new Error('Cloudflare Worker URL not configured in production environment');
    }

    // Validate worker URL against SSRF allowlist (shared helper — single source of truth)
    const urlObj = new URL(workerUrl);
    const isAllowedOrigin = urlObj.protocol === 'https:' && isTrustedWorkerOrigin(urlObj.hostname);

    if (!isAllowedOrigin) {
      console.error('[fetchWorkerMetadata] SECURITY: Rejected untrusted worker origin', { hostname: urlObj.hostname });
      throw new Error(`Worker URL origin '${urlObj.hostname}' is not in approved allowlist. SSRF prevention enforced.`);
    }

    const metadataUrl = `${workerUrl}/fetch-metadata?video_id=${videoId}`;
    const response = await fetch(metadataUrl, {
      method: 'GET',
      headers: {
        'User-Agent': getRandomUserAgent(),
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Worker returned ${response.status}`);
    }

    const metadata = await response.json();

    return {
      title: metadata.title || '',
      channelTitle: metadata.channelTitle || '',
      channelId: metadata.channelId || '',
      publishedAt: metadata.publishedAt || '',
      duration: metadata.duration || null,
      viewCount: metadata.viewCount || '0',
      likeCount: metadata.likeCount || '0',
      commentCount: metadata.commentCount || '0',
      thumbnailUrl: metadata.thumbnailUrl || null,
      description: metadata.description || '',
    };
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutErr = new Error('Worker request timeout');
      Sentry.captureException(timeoutErr, { tags: { component: 'WorkerIngestionAdapter', phase: 'fetch-metadata' }, extra: { videoId } });
      throw timeoutErr;
    }

    // Previously discarded the real `error` (network error, SSRF rejection,
    // non-OK status) behind a generic message with no telemetry -- preserve
    // the original cause and report it.
    Sentry.captureException(error, {
      tags: { component: 'WorkerIngestionAdapter', phase: 'fetch-metadata' },
      extra: { videoId },
    });

    // Fallback: direct YouTube oEmbed resolution if Worker is unavailable or misconfigured
    try {
      // Bounded timeout, same rationale as the main worker fetch above — an
      // unbounded fallback fetch would hold the request open indefinitely.
      const oembedController = new AbortController();
      const oembedTimeout = setTimeout(() => oembedController.abort(), 3000);
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
        headers: { 'User-Agent': getRandomUserAgent() },
        signal: oembedController.signal,
      });
      clearTimeout(oembedTimeout);
      if (oembedRes.ok) {
        const oembed = (await oembedRes.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        return {
          title: oembed.title || 'YouTube Video',
          channelTitle: oembed.author_name || '',
          channelId: '',
          // oEmbed exposes no publish date. A real "now" timestamp masquerades
          // as fresh data; empty string keeps "unknown" honest downstream.
          publishedAt: '',
          duration: null,
          viewCount: '0',
          likeCount: '0',
          commentCount: '0',
          thumbnailUrl: oembed.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          description: '',
        };
      }
    } catch (oembedErr) {
      console.warn('[fetchWorkerMetadata] Direct oEmbed fallback failed:', oembedErr);
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch metadata from Worker: ${message}`);
  }
}

/**
 * Highlights RCA (2026-10-08): the timed segments fetched here, server-side, are
 * the only trusted segments for an analysis whose transcript Vercel already knows.
 * The browser relays that transcript to the worker, and since #417 the worker
 * (correctly) refuses browser-relayed segments, so its persist sends
 * `segments: []` and no trusted writer ever stored them -- every analysis since
 * 2026-10-03 had a flat transcript row, and highlight extraction (which needs
 * segments) silently produced nothing. Storing them here, before the job is
 * returned, means the worker's later empty-segments persist hits the adapter's
 * preserve-on-empty path and keeps them. Best effort: a failure only loses
 * highlights for this analysis, never the analysis itself.
 */
async function storeTrustedSegments(videoId: string, transcript: string, segments: TranscriptSegment[] | undefined, language = 'en'): Promise<void> {
  if (!transcript || !segments || segments.length === 0) return;
  try {
    await SupabaseTranscriptAdapter.upsertTranscript({ videoId, content: transcript, segments, language });
  } catch (error) {
    console.error('[WorkerIngestionAdapter] storing trusted transcript segments failed', { videoId, error });
    Sentry.captureException(error, { tags: { component: 'WorkerIngestionAdapter', phase: 'store-segments' }, extra: { videoId } });
  }
}

export class WorkerIngestionAdapter implements MetadataIngestionPort {
  async fetch(videoId: string): Promise<IngestionResult> {
    const [metadataResult, transcriptResult] = await Promise.allSettled([
      fetchWorkerMetadata(videoId),
      fetchWorkerTranscript(videoId),
    ]);

    if (metadataResult.status === 'rejected') {
      // metadataResult.reason already carries a descriptive message and was
      // already reported to Sentry inside fetchWorkerMetadata's own catch --
      // rethrow it directly instead of replacing it with a generic string.
      throw metadataResult.reason instanceof Error
        ? metadataResult.reason
        : new Error('Failed to fetch video metadata');
    }

    if (transcriptResult.status === 'rejected') {
      // Already reported to Sentry inside fetchWorkerTranscript's own catch.
      // Falling back to an empty transcript here is intentional (metadata
      // alone is still useful), but log so this degraded path is visible --
      // previously this branch was completely silent, making a transient
      // worker failure indistinguishable from the video genuinely having no
      // captions.
      console.warn('[WorkerIngestionAdapter] Transcript fetch failed, continuing with metadata only', {
        videoId,
        reason: transcriptResult.reason instanceof Error ? transcriptResult.reason.message : String(transcriptResult.reason),
      });
    }

    const meta = metadataResult.value;
    const transcriptResultValue = transcriptResult.status === 'fulfilled' ? transcriptResult.value : { transcript: '', segments: undefined as TranscriptSegment[] | undefined, language: undefined as string | undefined };
    const transcript = transcriptResultValue.transcript.trim();

    const metadata: VideoMetadata = {
      videoId,
      title: meta.title,
      channelTitle: meta.channelTitle,
      publishedAt: meta.publishedAt,
      duration: meta.duration ?? 0,
      viewCount: Number(meta.viewCount) || 0,
      likeCount: Number(meta.likeCount) || 0,
      commentCount: Number(meta.commentCount) || 0,
      description: meta.description,
      channelId: meta.channelId,
      thumbnailUrl: meta.thumbnailUrl,
    };

    await storeTrustedSegments(videoId, transcript, transcriptResultValue.segments, transcriptResultValue.language);
    return { metadata, transcript, transcriptAvailable: transcript.length > 0, segments: transcriptResultValue.segments };
  }

  async fetchOnlyMetadata(videoId: string): Promise<VideoMetadata> {
    const meta = await fetchWorkerMetadata(videoId);
    return {
      videoId,
      title: meta.title,
      channelTitle: meta.channelTitle,
      publishedAt: meta.publishedAt,
      duration: meta.duration ?? 0,
      viewCount: Number(meta.viewCount) || 0,
      likeCount: Number(meta.likeCount) || 0,
      commentCount: Number(meta.commentCount) || 0,
      description: meta.description,
      channelId: meta.channelId,
      thumbnailUrl: meta.thumbnailUrl,
    };
  }

  detectPersona(params: {
    title: string;
    channelTitle: string;
    explicitPersona?: PersonaId;
  }): PersonaId {
    if (params.explicitPersona) {
      return params.explicitPersona;
    }
    return detectPersona(params.title, params.channelTitle);
  }

  buildJobMetadata(metadata: VideoMetadata): AnalysisJobMetadata {
    return {
      videoId: metadata.videoId,
      title: metadata.title,
      channelTitle: metadata.channelTitle,
      channelId: metadata.channelId || undefined,
      publishedAt: metadata.publishedAt,
      duration: metadata.duration,
      viewCount: String(metadata.viewCount),
      likeCount: String(metadata.likeCount),
      commentCount: String(metadata.commentCount),
      description: metadata.description || '',
    };
  }
}