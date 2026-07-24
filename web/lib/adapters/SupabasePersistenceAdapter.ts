import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';
import type {
  AnalysisPersistencePort,
  GraphPersistencePort,
  BillingPersistencePort,
  CachedAnalysis,
  AnalysisStub,
  ValidationReportInput,
  HistoryOverviewItem,
  ChatPersistencePort,
  SettingsPersistencePort,
} from '@/lib/ports';
import type { ChatConversation, ChatMessage } from '@/lib/types/chat';
import type { GraphNode, GraphEdge } from '@/lib/types/knowledge-graph';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';
import type { ClientPlatform } from '@/lib/utils/client-platform';
import type { KnowledgeWikiPort } from '@/lib/services/KnowledgeHistoryService';

import { SupabaseAnalysisAdapter } from './SupabaseAnalysisAdapter';
import { SupabaseChatAdapter } from './SupabaseChatAdapter';
import { SupabaseGraphAdapter } from './SupabaseGraphAdapter';
import { SupabaseBillingAdapter } from './SupabaseBillingAdapter';

/**
 * Unified persistence adapter aggregating analysis, graph, billing, chat, settings, and knowledge-wiki operations.
 * Delegates to specialized adapters (SupabaseAnalysisAdapter, SupabaseChatAdapter, etc.) implementing the port contracts.
 * Centralizes Supabase interactions and provides single-point access to all persistence operations.
 * Note: Retry and error settling are owned by route/use-case layers; this adapter throws on failure.
 */
export class SupabasePersistenceAdapter implements AnalysisPersistencePort, GraphPersistencePort, BillingPersistencePort, ChatPersistencePort, SettingsPersistencePort, KnowledgeWikiPort {
  findCachedAnalysis(params: { userId: string; videoId: string }): Promise<CachedAnalysis | null> {
    return SupabaseAnalysisAdapter.findCachedAnalysis(params);
  }

  upsertProcessingStub(params: { videoId: string; userId: string; title: string; transcriptHash?: string; clientPlatform?: ClientPlatform | null; validationReport: ValidationReportInput }): Promise<AnalysisStub> {
    return SupabaseAnalysisAdapter.upsertProcessingStub(params);
  }

  // SoC: this delegate performs the single idempotent persist write (+ KG fan-out)
  // and throws on failure. Retry (the persist route's `retryWithBackoff`) and
  // error-state settling are owned by the calling route/use-case layer, not the
  // persistence adapter.
  async persistAnalysis(params: { analysisId: string; analysisPayload: UCISPayloadV2 | null; analysisMarkdown: string; validationPassed: boolean }): Promise<void> {
    await SupabaseAnalysisAdapter.persistAnalysis(params);

    // Persist Knowledge Graph data if payload exists
    if (params.analysisPayload && params.analysisPayload.knowledgeGraph) {
      await this.persistKnowledgeGraph({
        analysisId: params.analysisId,
        entities: params.analysisPayload.knowledgeGraph.nodes.map(n => ({
          label: (n as any).label,
          type: (n as any).entityType || 'concept',
          weight: (n as any).weight || 1,
          rawNode: n
        })),
        relations: params.analysisPayload.knowledgeGraph.edges.map(e => ({
          source: (e as any).source,
          target: (e as any).target,
          relation: (e as any).kind || 'related',
          strength: (e as any).strength || 1,
          rawEdge: e
        }))
      });
    }
  }

  getUserHistory(params: { userId: string }): Promise<Array<{ id: string; videoId: string; title: string; createdAt: string; status: 'completed' | 'processing' | 'incomplete' }>> {
    return SupabaseAnalysisAdapter.getUserHistory(params);
  }

  getUserHistoryOverview(params: { userId: string }): Promise<HistoryOverviewItem[]> {
    return SupabaseAnalysisAdapter.getUserHistoryOverview(params);
  }

  findAnalysisById(params: { userId: string; analysisId: string }): Promise<{ id: string; title: string; videoId: string; analysisMarkdown: string; createdAt: string } | null> {
    return SupabaseAnalysisAdapter.findAnalysisById(params);
  }

  findAnalysisForPersist(params: { analysisId: string; videoId: string }): Promise<{ id: string; userId: string; title: string; transcriptHash?: string | null; transcript?: string | null; validationReport: unknown; createdAt: string; channelTitle?: string | null } | null> {
    return SupabaseAnalysisAdapter.findAnalysisForPersist(params);
  }

  getAnalysisGrounding(params: { analysisId: string; userId?: string }): Promise<{ title: string; channelTitle: string | null; description: string | null; analysisMarkdown: string | null; status: string; transcript?: string | null } | null> {
    return SupabaseAnalysisAdapter.getAnalysisGrounding(params);
  }

  findAnalysisByShareToken(token: string): Promise<{ id: string; title: string; channelTitle: string | null; analysisMarkdown: string | null; sharedExpiresAt: string | null; createdAt: string } | null> {
    return SupabaseAnalysisAdapter.findAnalysisByShareToken(token);
  }

  updateValidationReport(params: { analysisId: string; report: any; passed?: boolean; preserveValidationPassed?: boolean }): Promise<void> {
    return SupabaseAnalysisAdapter.updateValidationReport(params);
  }

  verifyOwnership(params: { analysisId: string; userId: string; select?: string }): Promise<any | null> {
    return SupabaseAnalysisAdapter.verifyOwnership(params);
  }

  saveExecutiveDigest(params: { analysisId: string; userId: string; digest: unknown }): Promise<boolean> {
    return SupabaseAnalysisAdapter.saveExecutiveDigest(params);
  }

  async updateAnalysisResult(params: {
    analysisId: string;
    markdown: string;
    payload: UCISPayloadV2 | null;
    model: string | null;
    validationPassed: boolean;
    validationReport: unknown;
    guardBillingStatus?: string;
  }): Promise<{ updated: boolean }> {
    const service = getSupabaseServiceClient();

    // 1️⃣-2️⃣ (Removed 2026-07-23 — audit finding CRIT-2) This used to fetch
    // analysis meta solely to upsert it into a `videos` table that has never
    // existed in any migration. Every finalize call silently attempted the
    // write, always failed, and the failure was swallowed by the surrounding
    // try/catch as a console.warn -- a wasted Supabase round-trip on every
    // single analysis completion, forever, with no functional effect
    // (nothing reads from a `videos` table anywhere in the codebase).
    // Deleted rather than fixed forward: there was no reader to preserve.

    // 3️⃣ Extract billing_status from validation report (contract fix: use actual value, not override)
    // billing_status should come from validationReport if available (set by persist route),
    // fallback to 'completed' if validation passes, otherwise 'failed'.
    // RCA (2026-07-23): this used to fall back to 'chargeable', which the DB's
    // CHECK constraint (processing|completed|failed) has always rejected --
    // every real successful analysis has silently failed to reach a terminal
    // billing status since 2026-07-13. See BillingStatus type for full RCA.
    const billingStatus = (params.validationReport as any)?.billing_status ||
      (params.validationPassed ? 'completed' : 'failed');

    let updateQuery = service
      .from('analyses')
      .update({
        analysis_markdown: params.markdown,
        analysis_payload: params.payload ?? null,
        model_used: params.model || 'edge-stream',
        validation_passed: params.validationPassed,
        validation_report: params.validationReport,
        billing_status: billingStatus,
        updated_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('id', params.analysisId);
    if (params.guardBillingStatus !== undefined) {
      updateQuery = updateQuery.eq('billing_status', params.guardBillingStatus);
    }
    const { error: analysisError, count } = await updateQuery;

    if (analysisError) {
      console.error('[SupabasePersistenceAdapter] updateAnalysisResult failed:', analysisError.message);
      throw analysisError;
    }

    // Guarded call that lost the race (a concurrent writer already moved this
    // row off guardBillingStatus): stop here. Applying KG/chunk side-effects
    // below would write data for a row a different, possibly-conflicting
    // write already claimed.
    if (params.guardBillingStatus !== undefined && !count) {
      return { updated: false };
    }

    // 4️⃣ Persist Knowledge Graph if present (ADR 006)
    if (params.payload?.knowledgeGraph) {
      await this.persistKnowledgeGraph({
        analysisId: params.analysisId,
        entities: params.payload.knowledgeGraph.nodes.map(n => ({
          label: n.label,
          type: n.entityType || 'concept',
          weight: n.weight || 1,
          rawNode: n,
        })),
        relations: params.payload.knowledgeGraph.edges.map(e => ({
          source: e.source,
          target: e.target,
          relation: e.kind || 'related',
          strength: e.strength || 1,
          rawEdge: e,
        })),
      }).catch(err => {
        console.error('[SupabasePersistenceAdapter] KG persistence failed during updateAnalysisResult:', err);
      });
    }

    // 5️⃣ Persist analysis chunks if payload contains them
    const anyPayload = params.payload as any;
    if (Array.isArray(anyPayload?.chunks) && anyPayload.chunks.length > 0) {
      const chunkRows = anyPayload.chunks.map((c: any, idx: number) => ({
        analysis_id: params.analysisId,
        chunk_index: idx,
        payload: { text: c.text ?? String(c), metadata: c.metadata ?? {} },
        dimensions_covered: c.dimensionsCovered ?? [],
        status: 'completed' as const,
        updated_at: new Date().toISOString(),
      }));
      try {
        await service
          .from('analysis_chunks')
          .upsert(chunkRows, { onConflict: 'analysis_id,chunk_index' });
      } catch (err) {
        console.error('[SupabasePersistenceAdapter] chunk upsert failed:', err);
      }
    }

    return { updated: true };
  }

  // --- Chat Adapter Delegation ---
  getConversations(userId: string): Promise<ChatConversation[]> {
    return SupabaseChatAdapter.getConversations(userId);
  }

  createConversation(params: { userId: string; analysisId: string | null; title: string; videoId?: string | null }): Promise<ChatConversation> {
    return SupabaseChatAdapter.createConversation(params);
  }

  getConversation(params: { conversationId: string }): Promise<ChatConversation | null> {
    return SupabaseChatAdapter.getConversation(params);
  }

  updateConversationTitle(params: { conversationId: string; title: string }): Promise<void> {
    return SupabaseChatAdapter.updateConversationTitle(params);
  }

  getMessages(params: { conversationId: string }): Promise<ChatMessage[]> {
    return SupabaseChatAdapter.getMessages(params);
  }

  findMessageByClientMsgId(params: { conversationId: string; clientMsgId: string }): Promise<ChatMessage | null> {
    return SupabaseChatAdapter.findMessageByClientMsgId(params);
  }

  createMessage(params: { conversationId: string; userId: string; role: 'user' | 'assistant'; content: string; clientMsgId?: string | null; parentMessageId?: string | null }): Promise<ChatMessage> {
    return SupabaseChatAdapter.createMessage(params);
  }

  findAssistantMessageAfter(params: { conversationId: string; timestamp: string }): Promise<ChatMessage | null> {
    return SupabaseChatAdapter.findAssistantMessageAfter(params);
  }

  findAssistantByParentId(params: { conversationId: string; parentId: string }): Promise<ChatMessage | null> {
    return SupabaseChatAdapter.findAssistantByParentId(params);
  }

  verifyChatOwnership(params: { conversationId: string; userId: string; select?: string }): Promise<any | null> {
    return SupabaseChatAdapter.verifyOwnership(params);
  }

  // --- Graph Adapter Delegation ---
  getAnalysesByTenant(tenantId: string): Promise<Array<{ id: string; title: string; nodes: GraphNode[]; edges: GraphEdge[] }>> {
    return SupabaseGraphAdapter.getAnalysesByTenant(tenantId);
  }

  persistKnowledgeGraph(params: { analysisId: string; entities: Array<{ label: string; type: string; weight: number; rawNode?: any }>; relations: Array<{ source: string; target: string; relation: string; strength: number; rawEdge?: any }> }): Promise<void> {
    return SupabaseGraphAdapter.persistKnowledgeGraph(params);
  }

  async getKnowledgeGraph(analysisId: string): Promise<{ entities: Array<{ id: string; label: string; type: string; weight: number; raw_node?: any }>; relations: Array<{ source_entity_id: string; target_entity_id: string; relation_label: string; strength: number; raw_edge?: any }> } | null> {
    return SupabaseGraphAdapter.getKnowledgeGraph(analysisId);
  }

  async persistGraph(params: { analysisId: string; nodes: GraphNode[]; relations: GraphEdge[] }): Promise<void> {
    // Transform GraphNode[] to entity format for persistence
    const entities = params.nodes.map(n => ({
      label: n.label,
      type: n.entityType || '',
      weight: n.weight,
      rawNode: n
    }));
    const relations = params.relations.map(r => ({
      source: r.source,
      target: r.target,
      relation: r.kind,
      strength: r.strength,
      rawEdge: r
    }));
    return this.persistKnowledgeGraph({ analysisId: params.analysisId, entities, relations });
  }

  async getGraph(analysisId: string): Promise<{ nodes: GraphNode[]; relations: GraphEdge[] } | null> {
    const data = await this.getKnowledgeGraph(analysisId);
    if (!data) return null;

    return {
      nodes: data.entities.map(e => ({
        id: e.id,
        label: e.label,
        dimension: 0,
        content: '',
        polarity: 0,
        keyTerms: [],
        inPersona: false,
        entityType: e.type,
        weight: e.weight
      })),
      relations: data.relations.map(r => ({
        source: r.source_entity_id,
        target: r.target_entity_id,
        kind: r.relation_label as any,
        strength: r.strength
      }))
    };
  }

  // --- Billing Adapter Delegation ---
  updateUserTier(params: { userId: string; tier: 'pro' | 'free' }): Promise<void> {
    return SupabaseBillingAdapter.updateUserTier(params);
  }

  updateBillingStatus(params: { analysisId: string; status: 'processing' | 'completed' | 'failed' }): Promise<void> {
    return SupabaseBillingAdapter.updateBillingStatus(params);
  }

  getUserProfile(userId: string): Promise<any | null> {
    return SupabaseBillingAdapter.getUserProfile(userId);
  }

  getUserBillingConfig(userId: string): Promise<{ stripeCustomerId: string | null; tier: string; analysesUsed: number } | null> {
    return SupabaseBillingAdapter.getUserBillingConfig(userId);
  }

  getUsageLogsCountSince(params: { userId: string; since: string }): Promise<number> {
    return SupabaseBillingAdapter.getUsageLogsCountSince(params);
  }

  getMonthlyAnalyses(params: { userId: string; since: string }): Promise<Array<{ id: string; billingStatus: string; createdAt: string }>> {
    return SupabaseBillingAdapter.getMonthlyAnalyses(params);
  }

  logUsageEvent(params: { userId: string; action: string; metadata: any }): Promise<void> {
    return SupabaseBillingAdapter.logUsageEvent(params);
  }

  getUsageEventCounts(params: { userId: string; since: string }): Promise<Array<{ action: string; surface: string | null; count: number; costUsd: number }>> {
    return SupabaseBillingAdapter.getUsageEventCounts(params);
  }

  // --- Chunks ---
  async persistAnalysisChunk(params: {
    analysisId: string;
    chunkIndex: number;
    dimensionsCovered: number[];
    payload: any;
    status: 'completed' | 'failed' | 'interrupted';
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service
        .from('analysis_chunks')
        .upsert({
          analysis_id: params.analysisId,
          chunk_index: params.chunkIndex,
          dimensions_covered: params.dimensionsCovered,
          payload: params.payload ?? {},
          status: params.status,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'analysis_id,chunk_index'
        });

      if (error) {
        console.error('[SupabasePersistenceAdapter] persistAnalysisChunk failed:', error.message);
        throw error;
      }
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'persistAnalysisChunk' },
        extra: { analysisId: params.analysisId, chunkIndex: params.chunkIndex },
      });
      throw error;
    }
  }

  async findAnalysisChunks(params: {
    analysisId: string;
  }): Promise<Array<{ chunk_index: number; dimensions_covered: number[]; payload: Record<string, unknown>; status: 'completed' | 'failed' | 'interrupted'; updated_at: string | null }> | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analysis_chunks')
        .select('chunk_index, dimensions_covered, payload, status, updated_at')
        .eq('analysis_id', params.analysisId);

      if (error) {
        console.error('[SupabasePersistenceAdapter] findAnalysisChunks failed:', error.message);
        throw error;
      }
      return data || [];
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisChunks' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }
  }

  /**
   * Check if a chunk has already been persisted (idempotency check).
   * Returns true if the chunk exists with status='completed' or 'failed'.
   * @param analysisId - Analysis ID to check
   * @param chunkIndex - Chunk index to check
   * @returns true if chunk has been persisted, false otherwise
   */
  async isChunkAlreadyPersisted(analysisId: string, chunkIndex: number): Promise<boolean> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analysis_chunks')
        .select('chunk_index, status')
        .eq('analysis_id', analysisId)
        .eq('chunk_index', chunkIndex)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned (expected if chunk doesn't exist)
        console.error('[SupabasePersistenceAdapter] isChunkAlreadyPersisted failed:', error.message);
        throw error;
      }
      // Return true if chunk exists
      return !!data;
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'isChunkAlreadyPersisted' },
        extra: { analysisId, chunkIndex },
      });
      throw error;
    }
  }

  async getAppSetting(key: string): Promise<any | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .single();
      if (error) {
  console.error('[SupabasePersistenceAdapter] getAppSetting failed:', error.message);
  Sentry.captureException(error, {
    tags: { method: 'getAppSetting' },
    extra: { key }
  });
  return null;
}
      return data.value;
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getAppSetting' },
        extra: { key },
      });
      return null;
    }
  }

  /**
   * KnowledgeWikiPort implementation: Load user's knowledge wiki rows.
   * Queries public.user_knowledge_wiki table for all topics belonging to userId.
   * Returns empty array if user has no wiki history.
   *
   * Return type matches WikiRow interface:
   * - id: wiki record ID (UUID)
   * - user_id: user identifier
   * - topic: wiki topic name (e.g., "may-2026-digest")
   * - wiki_markdown: aggregated wiki content from questions
   * - question_count: number of questions in this wiki
   * - theme_count: number of themes aggregated
   * - created_at: ISO timestamp when wiki was first created
   * - updated_at: ISO timestamp when wiki was last updated
   */
  async getUserWiki(userId: string): Promise<Array<{ id: string; user_id: string; topic: string; wiki_markdown: string; question_count: number; theme_count: number; created_at: string; updated_at: string }>> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('user_knowledge_wiki')
        .select('id, user_id, topic, wiki_markdown, question_count, theme_count, created_at, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('[SupabasePersistenceAdapter] getUserWiki failed:', error.message);
        Sentry.captureException(error, {
          tags: { method: 'getUserWiki' },
          extra: { userId },
        });
        return [];
      }

      return data || [];
    } catch (error: unknown) {
      console.error('[SupabasePersistenceAdapter] getUserWiki error:', error);
      Sentry.captureException(error, {
        tags: { method: 'getUserWiki' },
        extra: { userId },
      });
      return [];
    }
  }
}
