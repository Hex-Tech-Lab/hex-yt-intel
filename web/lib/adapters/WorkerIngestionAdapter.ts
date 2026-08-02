import * as Sentry from '@sentry/nextjs';
import { env } from '@/lib/env';
import { detectPersona } from '@/lib/prompts';
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

async function fetchWorkerTranscript(videoId: string): Promise<{ transcript: string; segments?: TranscriptSegment[] }> {
  const workerUrl = env.cloudflareWorkerUrl;
  if (!workerUrl) throw new Error('Worker URL not configured');

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
    return { transcript: data.transcript || '', segments: Array.isArray(data.segments) ? data.segments : undefined };
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

    // Validate worker URL against SSRF allowlist
    const allowedOrigins = new Set([
      'yt-intel.hex-tech-lab.workers.dev',
    ]);
    const urlObj = new URL(workerUrl);
    const isAllowedOrigin = urlObj.protocol === 'https:' && allowedOrigins.has(urlObj.hostname);

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
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch metadata from Worker: ${message}`);
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
    const transcriptResultValue = transcriptResult.status === 'fulfilled' ? transcriptResult.value : { transcript: '', segments: undefined as TranscriptSegment[] | undefined };
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