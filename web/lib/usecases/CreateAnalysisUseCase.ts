import * as Sentry from '@sentry/nextjs';
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
import { STREAM_BUNDLES, assertBundlePartition } from '@/lib/config/synthesis';
import type { CommentsFetchConfig, ChannelMetaFetchConfig, CommentsSyncPoolConfig } from '@/lib/types/contracts';
import { PRIOR_PAYLOAD_MAX_BYTES_FALLBACK } from '@/lib/config/prior-payload';
import { resolveJevConfig, resolveJevMaxParallelStreams, JEV_MAX_PARALLEL_STREAMS_FALLBACK } from '@/lib/config/jev';
import { planAnalysis } from '@/lib/usecases/PlanAnalysisUseCase';
import type { ClientPlatform } from '@/lib/utils/client-platform';

/** A6 input estimate — same value as the /plan route's PROMPT_PREFIX_TOKENS_ESTIMATE. */
const PROMPT_PREFIX_TOKENS_ESTIMATE = 1000;

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
  /** Forwarded to OpenRouter's `user` field (worker-side) for abuse/security correlation. */
  userId: string;
  status: 'processing';
  title: string;
  persona: PersonaId;
  /** Registry-resolved prompt transcript char budget (2026-09-27). */
  transcriptBudgetChars: number;
  /** Registry-resolved dimension partition for the 5 parallel streams (R1a 2026-09-29). */
  streamBundles: number[][];
  metadata: AnalysisJobMetadata;
  transcript: string;
  segments?: TranscriptSegment[];
  timezone: string;
  models: string[];
  cascade: CascadeItem[];
  maxOutputTokens: { haiku: number; default: number };
  llmCascadeTimeoutMs: number;
  llmCascadeHandshakeTimeoutMs: number;
  promptCaching?: boolean;
  cacheWarmTimeoutMs?: number;
  commentsConfig: CommentsFetchConfig;
  channelMetaConfig: ChannelMetaFetchConfig;
  commentsSamplePlan?: { targetSampleCount: number; likeBucketCount: number; recencyBucketCount: number };
  commentsSyncPoolConfig: CommentsSyncPoolConfig;
  /** R1d: byte cap for the worker's prior_payload boundary guard (web/lib/config/prior-payload.ts). */
  priorPayloadMaxBytes: number;
  /** R3b 2.3 (P1): server-computed Jev plan when the transcript was known at job creation; null otherwise (worker calls /plan S2S). */
  jevPlan: {
    K: number;
    streamCount: number;
    cells: Array<{ jevChunkIndex: number; chunkIndex: number; startWord: number; endWord: number; sha256: string }>;
    estimateCents: number;
    truncatedFallback: boolean;
  } | null;
  jevMaxParallelStreams: number; // R3b 2.3.5e: browser cap for concurrent K>1 cell streams (analysis.jev.maxParallelStreams)
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
    // Transcript prompt budget (2026-09-27): replaces getUCISPrompt's hardcoded
    // 48000-char slice. Forwarded to the worker per-request (no DB access there,
    // ADR 005) and surfaced in the stream log when truncation actually occurs,
    // so a truncated-input analysis can never read as an unqualified success.
    const resolvedBudgetRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['analysis.transcriptBudgetChars', 'analysis.jev.maxParallelStreams'],
      { 'analysis.transcriptBudgetChars': 48000, 'analysis.jev.maxParallelStreams': JEV_MAX_PARALLEL_STREAMS_FALLBACK }
    );
    const transcriptBudgetChars = Math.max(
      1000,
      Number(resolvedBudgetRegistry['analysis.transcriptBudgetChars']) || 48000
    );
    const maxOutputTokens = {
      haiku: Number(resolvedMaxTokensRegistry['analysis.maxOutputTokens.haiku']) || 8192,
      default: Number(resolvedMaxTokensRegistry['analysis.maxOutputTokens.default']) || 16000,
    };

    // Registry-resolved (2026-08-07 -- see LLMCascade.ts's timeoutMs doc
    // comment for the RCA behind this: the prior hardcoded 120000 falsely
    // assumed a Cloudflare platform ceiling that doesn't actually exist).
    const resolvedTimeoutRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['analysis.llmCascade.timeoutMs', 'analysis.llmCascade.handshakeTimeoutMs'],
      { 'analysis.llmCascade.timeoutMs': 240000, 'analysis.llmCascade.handshakeTimeoutMs': 15000 }
    );
    const llmCascadeTimeoutMs = Number(resolvedTimeoutRegistry['analysis.llmCascade.timeoutMs']) || 240000;
    const llmCascadeHandshakeTimeoutMs = Number(resolvedTimeoutRegistry['analysis.llmCascade.handshakeTimeoutMs']) || 15000;

    // Registry-resolved (2026-09-25, prompt caching for the 5 bundle calls):
    // promptCaching gates Anthropic cache_control breakpoints on the shared
    // prefix (kill switch); cacheWarmTimeoutMs bounds how long bundles 2-5
    // wait for bundle 1's first streamed byte (Anthropic only makes the cache
    // entry readable once the first response begins). The 3000 default is
    // derived from the measured ~3s Haiku 4.5 first-token latency in the
    // 2026-06-02 cascade benchmark -- see the migration's derivation comment.
    const resolvedCachingRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['analysis.promptCaching.enabled', 'analysis.llmCascade.cacheWarmTimeoutMs'],
      { 'analysis.promptCaching.enabled': true, 'analysis.llmCascade.cacheWarmTimeoutMs': 3000 }
    );
    const promptCachingRaw = resolvedCachingRegistry['analysis.promptCaching.enabled'];
    const promptCaching = promptCachingRaw === undefined ? true : String(promptCachingRaw) !== 'false';
    // Number.isFinite guard (2026-09-26 fix): `Number(value) || 3000`
    // silently coerced a legitimate registry value of 0 (stagger disabled
    // via registry) to the 3000 default -- 0 is falsy. A finite check
    // respects 0 while still falling back when the key is absent
    // (Number(undefined) === NaN) or non-numeric.
    const cacheWarmRaw = Number(resolvedCachingRegistry['analysis.llmCascade.cacheWarmTimeoutMs']);
    const cacheWarmTimeoutMs = Number.isFinite(cacheWarmRaw) ? cacheWarmRaw : 3000;

    // R1a (2026-09-29): single authority for the dimension partition is the
    // registry key `analysis.streamBundles`; STREAM_BUNDLES is the only
    // fallback. The partition invariant is enforced here, server-side, before
    // the map reaches the client -- an invalid value is reported, not used.
    const resolvedBundleRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['analysis.streamBundles'],
      { 'analysis.streamBundles': STREAM_BUNDLES }
    );
    let streamBundles: number[][] = STREAM_BUNDLES;
    try {
      const candidate = resolvedBundleRegistry['analysis.streamBundles'] as number[][];
      assertBundlePartition(candidate);
      streamBundles = candidate;
    } catch (error) {
      Sentry.captureException(error, {
        tags: { component: 'CreateAnalysisUseCase', phase: 'stream-bundles-invariant' },
        extra: { registryValue: resolvedBundleRegistry['analysis.streamBundles'] },
      });
      console.error('[CreateAnalysisUseCase] invalid analysis.streamBundles, using STREAM_BUNDLES fallback:', error instanceof Error ? error.message : String(error));
    }

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

    // R1d (2026-09-29): byte cap for the worker's prior_payload boundary guard
    // (web/lib/config/prior-payload.ts). Resolved here -- the worker has no DB
    // access (ADR 005) -- and forwarded per-request alongside the other
    // registry-derived tunables. Stale clients (undefined) fall back to the
    // same 65536 default worker-side.
    const resolvedPriorPayloadRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['analysis.layer2.priorPayloadMaxBytes'],
      { 'analysis.layer2.priorPayloadMaxBytes': PRIOR_PAYLOAD_MAX_BYTES_FALLBACK }
    );
    const priorPayloadMaxBytesRaw = Number(resolvedPriorPayloadRegistry['analysis.layer2.priorPayloadMaxBytes']);
    const priorPayloadMaxBytes = Number.isFinite(priorPayloadMaxBytesRaw)
      ? priorPayloadMaxBytesRaw
      : PRIOR_PAYLOAD_MAX_BYTES_FALLBACK;

    // R3b 2.3 (ADR 037 Addendum A, Option P1): transcript known at job
    // creation ⇒ plan INLINE; job response carries the full cell list.
    // `analysis.jev.enabled` false/absent ⇒ K = 1 (pre-Jev behaviour).
    // Transcript missing ⇒ worker fetches it and calls /plan (S2S).
    let jevPlan: Awaited<ReturnType<typeof planAnalysis>> | null = null;
    if (ingestionResult.transcript) {
      try {
        const rawJevRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
          [
            'analysis.jev.enabled',
            'analysis.jev.windowWords',
            'analysis.jev.windowStrideWords',
            'analysis.jev.deltaCdiThreshold',
            'analysis.jev.fluffCdiThreshold',
            'analysis.jev.minChunkTokens',
            'analysis.jev.maxChunkTokens',
            'analysis.jev.maxChunks',
            'analysis.jev.acronymMinLength',
            'analysis.jev.contentWordMinLength',
            'analysis.jev.countAcronyms',
            'analysis.jev.countProperNouns',
            'analysis.jev.countNumbers',
            'analysis.jev.countContentWords',
            'analysis.jev.maxCostUsdCentsPerVideo',
          ],
          {} as Record<string, unknown>
        );
        const jevConfig = resolveJevConfig(rawJevRegistry);
        const costCapCents = Number(rawJevRegistry['analysis.jev.maxCostUsdCentsPerVideo']);
        // Worst-case pricing: the most expensive resolved cascade item
        // (CascadeItem cost is USD per 1K tokens → ×1000 for per-million).
        const worstCost = analysisCascade.reduce((max, item) => Math.max(max, item.cost ?? 0), 0);
        const usdPerMTok = worstCost * 1000;
        jevPlan = await planAnalysis({
          transcript: ingestionResult.transcript,
          jevConfig,
          bundles: streamBundles,
          transcriptBudgetChars,
          costCapCents: Number.isFinite(costCapCents) ? costCapCents : 100,
          inputUsdPerMTok: usdPerMTok,
          outputUsdPerMTok: usdPerMTok,
          promptPrefixTokens: PROMPT_PREFIX_TOKENS_ESTIMATE,
          maxOutputTokens: Math.max(maxOutputTokens.haiku, maxOutputTokens.default),
        });
        // Persist once (conditional update on the stub's plan-less row).
        try {
          const { plan: storedPlan } = await this.persistence.persistJevPlan({
            analysisId: stub.id,
            plan: jevPlan,
          });
          jevPlan = storedPlan as typeof jevPlan;
        } catch (persistError) {
          // Non-fatal: the worker's /plan call can still persist it.
          console.error('[CreateAnalysisUseCase] persistJevPlan failed:', persistError instanceof Error ? persistError.message : String(persistError));
        }
      } catch (error) {
        // Never block the analysis on planning failure — K = 1 fallback.
        Sentry.captureException(error, {
          tags: { component: 'CreateAnalysisUseCase', phase: 'jev-plan' },
          extra: { videoId },
        });
        console.error('[CreateAnalysisUseCase] planAnalysis failed, K=1 fallback:', error instanceof Error ? error.message : String(error));
      }
    }

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
        // Forwarded to OpenRouter's `user` field (worker-side, LLMCascade.ts)
        // so requests are correlatable back to the caller in OpenRouter's own
        // activity dashboard -- added 2026-07-30 as a security-correlation
        // capability, not currently used for authorization (Vercel already
        // gated this request via requireAdmin/quota before reaching here).
        userId: params.userId,
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
        llmCascadeTimeoutMs,
        llmCascadeHandshakeTimeoutMs,
        promptCaching,
        cacheWarmTimeoutMs,
        transcriptBudgetChars,
        streamBundles,
        commentsConfig,
        channelMetaConfig,
        commentsSamplePlan,
        commentsSyncPoolConfig,
        priorPayloadMaxBytes,
        jevPlan,
        jevMaxParallelStreams: resolveJevMaxParallelStreams(resolvedBudgetRegistry['analysis.jev.maxParallelStreams']),
        stream: {
          url: `${env.cloudflareWorkerUrl}/analyze-llm-stream`,
          sig: token.sig,
          exp: token.exp,
        },
      },
    };
  }
}