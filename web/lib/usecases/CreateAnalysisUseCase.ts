import type {
  MetadataIngestionPort,
  AnalysisPersistencePort,
  BillingQuotaPort,
  ModelResolutionPort,
  CryptographicTokenPort,
} from '@/lib/ports';
import { extractVideoId } from '@/lib/youtube';
import type { UserTier } from '@/lib/types/billing';
import type { PersonaId } from '@/lib/prompts';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import { createHash } from 'crypto';

import { env } from '@/lib/env';

export interface CreateAnalysisUseCaseParams {
  url: string;
  userId: string;
  tier: UserTier;
  email?: string;
  timezone: string;
  persona?: PersonaId;
  forceRefresh?: boolean;
}

export interface UseCaseSuccess {
  id: string;
  analysisId: string;
  videoId: string;
  status: 'processing';
  title: string;
  persona: PersonaId;
  metadata: AnalysisJobMetadata;
  transcript: string;
  timezone: string;
  models: string[];
  stream: {
    url: string;
    sig: string;
    exp: number;
  };
}

export type UseCaseResult =
  | { type: 'cache_hit'; data: any; headers?: Record<string, string>; persona: PersonaId }
  | { type: 'processing'; data: UseCaseSuccess; headers?: Record<string, string>; persona: PersonaId }
  | { type: 'error'; code: string; status: number; message: string };

export class CreateAnalysisUseCase {
  constructor(
    private metadataIngestion: MetadataIngestionPort,
    private persistence: AnalysisPersistencePort,
    private billingQuota: BillingQuotaPort,
    private modelResolution: ModelResolutionPort,
    private tokenCrypto: CryptographicTokenPort
  ) {}

  async execute(params: CreateAnalysisUseCaseParams): Promise<UseCaseResult> {
    const videoId = extractVideoId(params.url);
    if (!videoId) {
      return { type: 'error', code: 'ERR_INVALID_URL', status: 400, message: 'Invalid YouTube URL' };
    }

    // 1. Cache hit lookup (Liability CR-002: Implement real cache-hit return)
    if (!params.forceRefresh) {
      const cached = await this.persistence.findCachedAnalysis({ userId: params.userId, videoId });
      if (cached) {
        return { 
          type: 'cache_hit', 
          data: {
            ...cached,
            status: 'done',
            markdown: cached.analysisMarkdown,
            metadata: cached.cachedReport?.metadata,
          },
          persona: (cached.cachedReport?.persona as PersonaId) || 'creator'
        };
      }
    }

    // 2. Multi-tenant quota check (Liability T-MED-025: Implement authentic quota gate)
    const quota = await this.billingQuota.checkGate({
      userId: params.userId,
      tier: params.tier,
      email: params.email,
      endpoint: 'analyses',
    });

    if (!quota.allowed) {
      return { 
        type: 'error', 
        code: 'ERR_QUOTA_EXCEEDED', 
        status: 402, 
        message: 'Monthly analysis quota exceeded. Please upgrade your plan.' 
      };
    }

    // 3. Metadata Ingestion (transcript fetched by Edge Worker via SSE)
    let ingestionResult;
    const [settled] = await Promise.allSettled([this.metadataIngestion.fetch(videoId)]);
    if (settled.status === 'fulfilled') {
      ingestionResult = settled.value;
      ingestionResult.transcript = '';
    } else {
      const msg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
      return { type: 'error', code: 'ERR_INGESTION_FAILED', status: 500, message: `Video ingestion failed: ${msg}` };
    }

    // 4. Persistence & Token Generation
    const persona = this.metadataIngestion.detectPersona({
      title: ingestionResult.metadata.title,
      channelTitle: ingestionResult.metadata.channelTitle,
      explicitPersona: params.persona,
    });

    const jobMetadata = this.metadataIngestion.buildJobMetadata(ingestionResult.metadata);

    // Resolve model cascade for the user's tier
    const rawModels = await this.modelResolution.resolveModels(params.tier, 'analysis');
    const models = [...rawModels];

    // Compute transcript hash (ADR 006: input-based cache key)
    const transcriptHash = createHash('sha256')
      .update(ingestionResult.transcript || '')
      .digest('hex');

    // Insert processing stub
    const stub = await this.persistence.upsertProcessingStub({
      videoId,
      userId: params.userId,
      title: ingestionResult.metadata.title,
      transcriptHash,
      validationReport: {
        status: 'processing',
        transcriptAvailable: ingestionResult.transcriptAvailable,
        analysisType: 'full',
        staleAfter: new Date(Date.now() + 3600000).toISOString(), // 1 hour
        metadata: jobMetadata,
        persona,
        timezone: params.timezone,
      },
    });

    // Mint HMAC token for streaming worker access
    let token;
    try {
      const sortedModelsForSigning = [...models].sort();
      token = await this.tokenCrypto.signAnalysisToken({
        videoId,
        analysisId: stub.id,
        models: sortedModelsForSigning,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[CreateAnalysisUseCase] Token signing failed:', msg);
      return {
        type: 'error',
        code: 'ERR_TOKEN_SIGNING_FAILED',
        status: 500,
        message: 'Security configuration error: unable to sign streaming token.',
      };
    }

    return {
      type: 'processing',
      persona,
      headers: quota.headers,
      data: {
        id: stub.id,
        analysisId: stub.id,
        videoId,
        status: 'processing',
        title: ingestionResult.metadata.title,
        metadata: jobMetadata,
        transcript: ingestionResult.transcript,
        persona,
        timezone: params.timezone,
        models,
        stream: {
          url: `${env.cloudflareWorkerUrl}/analyze-llm-stream`,
          sig: token.sig,
          exp: token.exp,
        },
      },
    };
  }
}