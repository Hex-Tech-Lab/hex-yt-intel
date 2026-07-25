import type {
  MetadataIngestionPort,
  AnalysisPersistencePort,
  BillingQuotaPort,
  ModelResolutionPort,
  CryptographicTokenPort,
  CommentSamplingPort,
} from '@/lib/ports';
import { extractVideoId } from '@/lib/youtube';
import type { UserTier } from '@/lib/types/billing';
import type { PersonaId } from '@/lib/prompts';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { TranscriptSegment } from '@/lib/ports';
import { createHash } from 'crypto';

import { env } from '@/lib/env';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { resolveAnalysisCascade, type CascadeItem } from '@/lib/config/cascade';
import type { CommentsFetchConfig, ChannelMetaFetchConfig, CommentsSyncPoolConfig } from '@/lib/types/contracts';
import type { ClientPlatform } from '@/lib/utils/client-platform';

// Must match the registry's seeded defaults (20260725110000_comments_sync_pool_fetch_settings.sql).
const SYNC_POOL_CONFIG_FALLBACK: CommentsSyncPoolConfig = {
  maxPages: 10,
  timeoutMs: 8000,
};

// Must match the registry's seeded defaults (20260723190000_comments_fetch_settings.sql)
// -- used only if the registry is genuinely unreachable, never as the primary source.
const COMMENTS_CONFIG_FALLBACK: CommentsFetchConfig = {
  maxResults: 20,
  maxAttempts: 2,
  timeoutPerAttemptMs: 4000,
  maxPayloadBytes: 20000,
};

// Must match the registry's seeded defaults (20260724120000_channel_meta_fetch_settings.sql).
const CHANNEL_META_CONFIG_FALLBACK: ChannelMetaFetchConfig = {
  timeoutMs: 4000,
  maxPayloadBytes: 20000,
};

export interface CreateAnalysisUseCaseParams {
  url: string;
  userId: string;
  tier: UserTier;
  email?: string;
  timezone: string;
  persona?: PersonaId;
  forceRefresh?: boolean;
  /** UA-derived device signal (cosmetic only — see client-platform.ts); null when UA absent/unparseable. */
  clientPlatform?: ClientPlatform | null;
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
  segments?: TranscriptSegment[];
  timezone: string;
  models: string[];
  cascade: CascadeItem[];
  maxOutputTokens: { haiku: number; default: number };
  commentsConfig: CommentsFetchConfig;
  channelMetaConfig: ChannelMetaFetchConfig;
  commentsSamplePlan?: { targetSampleCount: number; likeBucketCount: number; recencyBucketCount: number };
  commentsSyncPoolConfig: CommentsSyncPoolConfig;
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
    private tokenCrypto: CryptographicTokenPort,
    private commentSampling: CommentSamplingPort
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
    // Full registry-resolved tiers (with providerOrder), forwarded to the worker
    // alongside `models` -- see StreamRequest.cascade in worker/src/routes/analysis.ts
    // for why `models` (flat ids, signed into the token) alone can't disambiguate
    // multiple tiers sharing one model id across different providers.
    const analysisCascade: CascadeItem[] = await resolveAnalysisCascade();
    // Registry-resolved max_tokens (2026-07-25 -- see LLMCascade.ts's
    // MAX_TOKENS_FALLBACK doc comment for the production-outage RCA behind this).
    const resolvedMaxTokensRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['analysis.maxOutputTokens.haiku', 'analysis.maxOutputTokens.default'],
      { 'analysis.maxOutputTokens.haiku': 8192, 'analysis.maxOutputTokens.default': 16000 }
    );
    const maxOutputTokens = {
      haiku: Number(resolvedMaxTokensRegistry['analysis.maxOutputTokens.haiku']) || 8192,
      default: Number(resolvedMaxTokensRegistry['analysis.maxOutputTokens.default']) || 16000,
    };

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
      clientPlatform: params.clientPlatform ?? null,
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

    // Resolve worker-bound tunables from the settings registry (Wave D1/D2)
    // server-side, where DB access exists, and hand them down in the signed
    // stream payload -- the worker itself has no Supabase access (ADR 005:
    // it's a pure fetch/stream service), so this is the correct place to
    // source a live-editable value rather than hardcoding it worker-side.
    const resolvedRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['chat.comments.maxResults', 'chat.comments.maxAttempts', 'chat.comments.timeoutPerAttemptMs', 'chat.comments.maxPayloadBytes'],
      {
        'chat.comments.maxResults': COMMENTS_CONFIG_FALLBACK.maxResults,
        'chat.comments.maxAttempts': COMMENTS_CONFIG_FALLBACK.maxAttempts,
        'chat.comments.timeoutPerAttemptMs': COMMENTS_CONFIG_FALLBACK.timeoutPerAttemptMs,
        'chat.comments.maxPayloadBytes': COMMENTS_CONFIG_FALLBACK.maxPayloadBytes,
      }
    );
    const commentsConfig: CommentsFetchConfig = {
      maxResults: Number(resolvedRegistry['chat.comments.maxResults']) || COMMENTS_CONFIG_FALLBACK.maxResults,
      maxAttempts: Number(resolvedRegistry['chat.comments.maxAttempts']) || COMMENTS_CONFIG_FALLBACK.maxAttempts,
      timeoutPerAttemptMs: Number(resolvedRegistry['chat.comments.timeoutPerAttemptMs']) || COMMENTS_CONFIG_FALLBACK.timeoutPerAttemptMs,
      maxPayloadBytes: Number(resolvedRegistry['chat.comments.maxPayloadBytes']) || COMMENTS_CONFIG_FALLBACK.maxPayloadBytes,
    };

    const resolvedChannelMetaRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['chat.channelMeta.timeoutMs', 'chat.channelMeta.maxPayloadBytes'],
      {
        'chat.channelMeta.timeoutMs': CHANNEL_META_CONFIG_FALLBACK.timeoutMs,
        'chat.channelMeta.maxPayloadBytes': CHANNEL_META_CONFIG_FALLBACK.maxPayloadBytes,
      }
    );
    const channelMetaConfig: ChannelMetaFetchConfig = {
      timeoutMs: Number(resolvedChannelMetaRegistry['chat.channelMeta.timeoutMs']) || CHANNEL_META_CONFIG_FALLBACK.timeoutMs,
      maxPayloadBytes: Number(resolvedChannelMetaRegistry['chat.channelMeta.maxPayloadBytes']) || CHANNEL_META_CONFIG_FALLBACK.maxPayloadBytes,
    };

    // Tier 0 (free, 10%, auto-expands to Tier 1/20% below the registry's
    // minSignalCount floor) is the default for every analysis -- Phase 6's UI
    // tier selector doesn't exist yet, so there's no user choice to read.
    // Replaces the old flat single-page comment fetch with a real stratified
    // sample; see worker/src/routes/analysis.ts#fetchSampledCommentsCached.
    const totalCommentCount = ingestionResult.metadata.commentCount || 0;
    const samplePlan = totalCommentCount > 0
      ? await this.commentSampling.planSample({ tier: 0, totalCommentCount })
      : null;
    let commentsSamplePlan: { targetSampleCount: number; likeBucketCount: number; recencyBucketCount: number } | undefined;
    if (samplePlan) {
      const resolvedBucketRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
        ['comments.sampling.likeBucketCount', 'comments.sampling.recencyBucketCount'],
        { 'comments.sampling.likeBucketCount': 3, 'comments.sampling.recencyBucketCount': 3 }
      );
      commentsSamplePlan = {
        targetSampleCount: samplePlan.targetSampleCount,
        likeBucketCount: Number(resolvedBucketRegistry['comments.sampling.likeBucketCount']) || 3,
        recencyBucketCount: Number(resolvedBucketRegistry['comments.sampling.recencyBucketCount']) || 3,
      };
    }

    const resolvedSyncPoolRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['comments.sampling.syncPoolMaxPages', 'comments.sampling.syncPoolTimeoutMs'],
      {
        'comments.sampling.syncPoolMaxPages': SYNC_POOL_CONFIG_FALLBACK.maxPages,
        'comments.sampling.syncPoolTimeoutMs': SYNC_POOL_CONFIG_FALLBACK.timeoutMs,
      }
    );
    const commentsSyncPoolConfig: CommentsSyncPoolConfig = {
      maxPages: Number(resolvedSyncPoolRegistry['comments.sampling.syncPoolMaxPages']) || SYNC_POOL_CONFIG_FALLBACK.maxPages,
      timeoutMs: Number(resolvedSyncPoolRegistry['comments.sampling.syncPoolTimeoutMs']) || SYNC_POOL_CONFIG_FALLBACK.timeoutMs,
    };

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
        segments: ingestionResult.segments,
        persona,
        timezone: params.timezone,
        models,
        cascade: analysisCascade,
        maxOutputTokens,
        commentsConfig,
        channelMetaConfig,
        commentsSamplePlan,
        commentsSyncPoolConfig,
        stream: {
          url: `${env.cloudflareWorkerUrl}/analyze-llm-stream`,
          sig: token.sig,
          exp: token.exp,
        },
      },
    };
  }
}