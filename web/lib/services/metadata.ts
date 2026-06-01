import { env } from '../env';

export interface WorkerMetadataResponse {
  title: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  duration: number | null;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  thumbnailUrl: string | null;
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

export async function fetchWorkerMetadata(videoId: string): Promise<WorkerMetadataResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const workerUrl = env.cloudflareWorkerUrl;

    if (!workerUrl || workerUrl.includes('[build-time-placeholder')) {
      throw new Error('Cloudflare Worker URL not configured in production environment');
    }

    // Validate worker URL against SSRF allowlist (exact hostname match only)
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
    };
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Worker request timeout');
    }

    throw new Error('Failed to fetch metadata from Worker');
  }
}
