import type {
  MetadataIngestionPort,
  ModelResolutionPort,
  CryptographicTokenPort,
  TrafficGuardPort,
  BillingQuotaPort,
  PersistencePort,
} from '@/lib/ports';
import type { PersonaId } from '@/lib/prompts';
import type { UserTier } from '@/lib/types/billing';
import { extractVideoId } from '@/lib/youtube';

export interface CreateAnalysisUseCaseParams {
  userId: string;
  email: string | undefined;
  tier: UserTier;
  url: string;
  timezone: string;
  forceRefresh: boolean;
  explicitPersona?: PersonaId;
  clientIp?: string;
  userAgent?: string;
}

export interface CacheHitData {
  id: string;
  analysisId: string;
  videoId: string;
  status: 'done';
  title: string;
  markdown: string;
  analysis_markdown: string;
  createdAt: string;
  analysisAt: string;
  persona: string;
  detectedPersona: string;
  timezone: string;
  metadata: any;
  dimensions: Record<string, unknown>;
  streaming: {
    started: string;
    interrupted: boolean;
    dimensionsReceived: number[];
  };
  cacheHit: true;
  message: string;
}

export interface ProcessingData {
  id: string;
  analysisId: string;
  videoId: string;
  status: 'processing';
  title: string;
  persona: string;
  detectedPersona: string;
  analysisAt: string;
  timezone: string;
  transcript: string;
  metadata: any;
  models: string[];
  streaming: {
    started: string;
    interrupted: boolean;
    dimensionsReceived: number[];
  };
  stream: {
    url: string;
    sig: string;
    exp: number;
  };
}

export type UseCaseResult =
  | { type: 'cache_hit'; data: CacheHitData; headers?: Record<string, string> }
  | { type: 'processing'; data: ProcessingData; headers?: Record<string, string> }
  | { type: 'error'; code: string; status: number; message: string; headers?: Record<string, string> };

export class CreateAnalysisUseCase {
  constructor(
    private trafficGuard: TrafficGuardPort,
    private billingQuota: BillingQuotaPort,
    private metadataIngestion: MetadataIngestionPort,
    private modelResolution: ModelResolutionPort,
    private tokenCrypto: CryptographicTokenPort,
    private persistence: PersistencePort
  ) {}

  async execute(params: CreateAnalysisUseCaseParams): Promise<UseCaseResult> {
    const videoId = extractVideoId(params.url);
    if (!videoId) {
      return { type: 'error', code: 'ERR_INVALID_URL', status: 400, message: 'Invalid YouTube URL' };
    }

    const { userId, email: userEmail, tier } = params;

    // 1. Cache hit lookup
    if (!params.forceRefresh) {
      const cached = await this.persistence.findCachedAnalysis({ userId, videoId });
      if (cached) {
        const cachedPersona = cached.cachedReport.persona || 'analyst';
        return {
          type: 'cache_hit',
          data: {
            id: cached.id,
            analysisId: cached.id,
            videoId,
            status: 'done',
            title: cached.title,
            markdown: cached.analysisMarkdown,
            analysis_markdown: cached.analysisMarkdown,
            createdAt: cached.createdAt,
            analysisAt: cached.createdAt,
            persona: cachedPersona,
            detectedPersona: cachedPersona,
            timezone: cached.cachedReport.timezone || params.timezone || 'UTC',
            metadata: cached.cachedReport.metadata,
            dimensions: cached.dimensions,
            streaming: {
              started: cached.createdAt,
              interrupted: false,
              dimensionsReceived: Object.keys(cached.dimensions).map(Number),
            },
            cacheHit: true,
            message: 'Retrieved from persistent cache.',
          },
        };
      }
    }

    // 2. Parallel Gates check
    const [trafficResult, billingResult] = await Promise.all([
      this.trafficGuard.checkGate({
        userId,
        tier,
        email: userEmail,
        endpoint: 'analyses',
        clientIp: params.clientIp,
        userAgent: params.userAgent,
      }),
      this.billingQuota.checkGate({
        userId,
        tier,
        email: userEmail,
        endpoint: 'analyses',
      }),
    ]);

    if (!trafficResult.allowed) {
      if (billingResult.allowed) {
        // Refund since traffic blocked request
        await this.billingQuota.refund({ userId, email: userEmail });
      }
      return {
        type: 'error',
        code: 'ERR_RATE_LIMITED',
        status: 429,
        message: 'Rate limit exceeded. Please try again later.',
        headers: trafficResult.headers,
      };
    }

    if (!billingResult.allowed) {
      return {
        type: 'error',
        code: 'ERR_MONTHLY_QUOTA_EXHAUSTED',
        status: 402,
        message: 'Monthly quota exhausted.',
        headers: trafficResult.headers,
      };
    }

    // 3. Metadata + Transcript Ingestion
    let ingestionResult;
    try {
      ingestionResult = await this.metadataIngestion.fetch(videoId);
    } catch {
      await this.billingQuota.refund({ userId, email: userEmail });
      return {
        type: 'error',
        code: 'ERR_METADATA_FETCH',
        status: 502,
        message: 'Failed to fetch video metadata',
      };
    }

    if (!ingestionResult.transcriptAvailable || !ingestionResult.transcript.trim()) {
      await this.billingQuota.refund({ userId, email: userEmail });
      return {
        type: 'error',
        code: 'ERR_TRANSCRIPT_REQUIRED',
        status: 400,
        message: 'Transcript unavailable: video has no subtitles or extraction failed. Full synthesis requires a textual source.',
      };
    }

    const persona = params.explicitPersona || this.metadataIngestion.detectPersona({
      title: ingestionResult.metadata.title,
      channelTitle: ingestionResult.metadata.channelTitle,
    });
    const timezone = params.timezone || 'UTC';
    const jobMetadata = this.metadataIngestion.buildJobMetadata(ingestionResult.metadata);

    // 4. Persistence stub insertion
    let analysisId: string;
    try {
      const stub = await this.persistence.upsertProcessingStub({
        videoId,
        userId,
        title: ingestionResult.metadata.title,
        validationReport: {
          status: 'processing',
          transcriptAvailable: ingestionResult.transcriptAvailable,
          analysisType: 'full',
          staleAfter: new Date(Date.now() + 180_000).toISOString(),
          metadata: jobMetadata,
          persona,
          timezone,
        },
      });
      analysisId = stub.id;
    } catch (insertError) {
      await this.billingQuota.refund({ userId, email: userEmail });
      return {
        type: 'error',
        code: 'ERR_ANALYSIS_ROW_INSERT',
        status: 500,
        message: 'Failed to initialize analysis',
      };
    }

    // 5. Model resolution & Token signing
    const analysisModels = await this.modelResolution.resolveModels(tier, 'analysis');
    const { sig, exp } = this.tokenCrypto.signAnalysisToken({ videoId, analysisId, models: analysisModels });

    const responseHeaders: Record<string, string> = {};
    if (trafficResult.headers) {
      Object.assign(responseHeaders, trafficResult.headers);
    }

    return {
      type: 'processing',
      headers: responseHeaders,
      data: {
        id: analysisId,
        analysisId,
        videoId,
        status: 'processing',
        title: ingestionResult.metadata.title,
        persona,
        detectedPersona: persona,
        analysisAt: new Date().toISOString(),
        timezone,
        transcript: ingestionResult.transcript,
        metadata: jobMetadata,
        models: analysisModels,
        streaming: {
          started: new Date().toISOString(),
          interrupted: false,
          dimensionsReceived: [],
        },
        stream: {
          url: `${process.env.NEXT_PUBLIC_WORKER_URL || ''}/analyze-llm-stream`,
          sig,
          exp,
        },
      },
    };
  }
}
