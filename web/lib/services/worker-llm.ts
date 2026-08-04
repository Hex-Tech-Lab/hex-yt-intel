import { env } from '@/lib/env';
import { getUCISPrompt } from '@/lib/prompts/factory';
import { PersonaId } from '@/lib/prompts';

export interface WorkerLLMRequest {
  videoId: string;
  transcript: string;
  metadata: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    duration: number;
    viewCount: string;
    likeCount: string;
    commentCount: string;
  };
  persona: PersonaId;
  timezone: string;
  systemPrompt?: string;
}

export interface WorkerLLMResponse {
  success: boolean;
  analysis?: string;
  model?: string;
  cached?: boolean;
  error?: string;
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

/**
 * Call Cloudflare Worker's LLM analysis endpoint
 * Proxies request to worker which handles 3-model cascade + KV caching
 * Uses UCIS v5.3 system prompt for comprehensive 11-dimension analysis
 */
export async function callWorkerLLMAnalysis(
  videoId: string,
  transcript: string,
  metadata: WorkerLLMRequest['metadata'],
  persona: PersonaId,
  timezone: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000); // 55s budget (under route maxDuration=60); covers nemotron lead + one fallback

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
      console.error('[callWorkerLLMAnalysis] SECURITY: Rejected untrusted worker origin', { hostname: urlObj.hostname });
      throw new Error(`Worker URL origin '${urlObj.hostname}' is not in approved allowlist. SSRF prevention enforced.`);
    }

    // Build system prompt using UCIS v5.3 factory
    const systemPrompt = await getUCISPrompt({
      metadata: {
        title: metadata.title,
        channelTitle: metadata.channelTitle,
        viewCount: metadata.viewCount,
        likeCount: metadata.likeCount,
        commentCount: metadata.commentCount,
        publishedAt: metadata.publishedAt,
      },
      transcript,
      persona,
      timezone,
      duration: metadata.duration,
    });

    const analysisUrl = `${workerUrl}/analyze-llm`;

    const response = await fetch(analysisUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': getRandomUserAgent(),
      },
      body: JSON.stringify({
        videoId,
        transcript,
        metadata,
        persona,
        timezone,
        systemPrompt,
      } as WorkerLLMRequest),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const error = await response.text();
      console.error('[callWorkerLLMAnalysis] Worker returned error', {
        status: response.status,
        url: analysisUrl,
        error: error.slice(0, 200),
      });

      // A 404 from a reachable worker host means the /analyze-llm port itself is
      // absent — i.e. the deployed Worker predates this route (stale deployment),
      // not a transient failure. Surface that precisely rather than as a generic 5xx.
      if (response.status === 404) {
        throw new Error(
          `Worker analysis port not found (404) at ${analysisUrl}. The Cloudflare Worker is reachable but does not expose /analyze-llm — it likely needs to be redeployed with the current worker.ts.`
        );
      }

      throw new Error(`Worker LLM endpoint returned ${response.status}: ${error.slice(0, 100)}`);
    }

    const result = (await response.json()) as WorkerLLMResponse;

    if (!result.success || !result.analysis) {
      throw new Error(result.error || 'Worker returned empty analysis');
    }

    console.log('[callWorkerLLMAnalysis] Analysis complete', {
      videoId,
      model: result.model,
      cached: result.cached,
      analysisLength: result.analysis.length,
    });

    return result.analysis;
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[callWorkerLLMAnalysis] Request timeout');
      throw new Error('Analysis request timeout (exceeded 30 seconds). Please try again.');
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[callWorkerLLMAnalysis] Error:', message);
    throw error;
  }
}
