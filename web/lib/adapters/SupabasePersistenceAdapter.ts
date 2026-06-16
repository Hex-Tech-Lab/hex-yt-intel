import { getSupabaseServiceClient } from '@/lib/supabase';
import { parseUcisDimensions } from '@/lib/parse-ucis-dimensions';
import * as Sentry from '@sentry/nextjs';
import type {
  PersistencePort,
  CachedAnalysis,
  AnalysisStub,
  ValidationReportInput,
  ChatPersistencePort,
} from '@/lib/ports';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';
import type { UCISPayloadV2 } from '@/lib/types/synthesis-nucleus';
import type { ChatConversation, ChatMessage } from '@/lib/types/chat';
import type { GraphNode, GraphEdge } from '@/lib/types/knowledge-graph';

interface AnalysisRow {
  id: string;
  video_id: string;
  title: string | null;
  analysis_markdown?: string | null;
  created_at: string;
  validation_passed: boolean;
  validation_report?: any;
}

interface ConversationRow {
  id: string;
  user_id: string;
  title: string | null;
  analysis_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  client_msg_id: string | null;
}

import { isPersistedValidationReport } from '@/lib/types/validation-report';

export class SupabasePersistenceAdapter implements PersistencePort, ChatPersistencePort {
  async findCachedAnalysis(params: {
    userId: string;
    videoId: string;
  }): Promise<CachedAnalysis | null> {
    const service = getSupabaseServiceClient();
    const { data: existing } = await service
      .from('analyses')
      .select('id, title, analysis_markdown, analysis_payload, created_at, validation_report')
      .eq('video_id', params.videoId)
      .eq('user_id', params.userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) return null;

    if (existing.analysis_payload && typeof existing.analysis_payload === 'object' && Object.keys(existing.analysis_payload).length > 0) {
      const payload = existing.analysis_payload as Record<string, unknown>;
      return {
        id: existing.id,
        title: existing.title,
        analysisMarkdown: existing.analysis_markdown ?? JSON.stringify(existing.analysis_payload),
        createdAt: existing.created_at,
        dimensions: (payload.dimensions as Record<string, unknown>) ?? {},
        cachedReport: (existing.validation_report ?? {}) as {
          metadata?: AnalysisJobMetadata;
          persona?: string;
          timezone?: string;
        },
        analysisPayload: existing.analysis_payload as any,
      };
    }

    if (!existing.analysis_markdown) return null;

    const dimensions = parseUcisDimensions(existing.analysis_markdown);
    const dimensionCount = Object.keys(dimensions).length;

    if (dimensionCount < 8) {
      console.warn(
        `[PersistenceAdapter] Cache for ${existing.id} has ${dimensionCount} dimensions (<8) — treating as miss.`
      );
      return null;
    }

    const cachedReport = (existing.validation_report ?? {}) as {
      metadata?: AnalysisJobMetadata;
      persona?: string;
      timezone?: string;
    };

    return {
      id: existing.id,
      title: existing.title,
      analysisMarkdown: existing.analysis_markdown,
      createdAt: existing.created_at,
      dimensions,
      cachedReport,
    };
  }

  async upsertProcessingStub(params: {
    videoId: string;
    userId: string;
    title: string;
    validationReport: ValidationReportInput;
  }): Promise<AnalysisStub> {
    const service = getSupabaseServiceClient();
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // 1. Look for an active processing stub created within the last 15 minutes
    const { data: activeStub } = await service
      .from('analyses')
      .select('id')
      .eq('video_id', params.videoId)
      .eq('user_id', params.userId)
      .eq('billing_status', 'processing')
      .gte('created_at', fifteenMinutesAgo)
      .maybeSingle();

    if (activeStub) {
      // Update the existing active processing stub in-place (second call metadata update)
      const { data: updated, error: updateError } = await service
        .from('analyses')
        .update({
          title: params.title,
          channel_title: params.validationReport.metadata?.channelTitle || '',
          validation_report: {
            status: params.validationReport.status,
            transcript_available: params.validationReport.transcriptAvailable,
            analysis_type: params.validationReport.analysisType,
            stale_after: params.validationReport.staleAfter,
            metadata: params.validationReport.metadata,
            persona: params.validationReport.persona,
            timezone: params.validationReport.timezone,
          },
        })
        .eq('id', activeStub.id)
        .select('id')
        .single();

      if (updateError || !updated?.id) {
        Sentry.captureException(updateError ?? new Error('update processing stub returned no row'), {
          tags: { operation: 'analysis-update-processing-stub' },
          extra: { videoId: params.videoId, userId: params.userId, stubId: activeStub.id },
        });
        throw updateError ?? new Error('update processing stub returned no row');
      }

      return { id: updated.id as string };
    }

    // 2. Otherwise, this is a fresh run (first call). Count quota and insert stub atomically.
    const { data: rpcData, error: rpcError } = await service
      .rpc('reserve_analysis_quota', {
        p_user_id: params.userId,
        p_video_id: params.videoId,
        p_title: params.title,
        p_validation_report: {
          status: params.validationReport.status,
          transcript_available: params.validationReport.transcriptAvailable,
          analysis_type: params.validationReport.analysisType,
          stale_after: params.validationReport.staleAfter,
          metadata: params.validationReport.metadata,
          persona: params.validationReport.persona,
          timezone: params.validationReport.timezone,
        },
      });

    if (rpcError || !rpcData) {
      const errMsg = rpcError?.message || 'Failed to reserve analysis quota';
      Sentry.captureException(rpcError ?? new Error(errMsg), {
        tags: { operation: 'analysis-prepare-rpc' },
        extra: { videoId: params.videoId, userId: params.userId },
      });
      throw new Error(errMsg);
    }

    return { id: rpcData as string };
  }

  async persistAnalysis(params: {
    analysisId: string;
    analysisPayload: UCISPayloadV2 | null;
    analysisMarkdown: string;
    validationPassed: boolean;
  }): Promise<void> {
    const service = getSupabaseServiceClient();
    const { error } = await service
      .from('analyses')
      .update({
        analysis_payload: params.analysisPayload as Record<string, unknown> | null,
        analysis_markdown: params.analysisMarkdown,
        validation_passed: params.validationPassed,
        billing_status: 'completed',
      })
      .eq('id', params.analysisId);

    if (error) {
      Sentry.captureException(error, {
        tags: { operation: 'analysis-persist' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }

    // NEW: Persist Knowledge Graph data if payload exists
    if (params.analysisPayload && params.analysisPayload.knowledgeGraph) {
      await this.persistKnowledgeGraph({
        analysisId: params.analysisId,
        entities: params.analysisPayload.knowledgeGraph.nodes.map(n => ({
          label: (n as any).label,
          type: (n as any).entityType || 'concept',
          weight: (n as any).weight || 1,
          rawNode: n // LOSSLESS
        })),
        relations: params.analysisPayload.knowledgeGraph.edges.map(e => ({
          source: (e as any).source,
          target: (e as any).target,
          relation: (e as any).kind || 'related',
          strength: (e as any).strength || 1,
          rawEdge: e // LOSSLESS
        }))
      });
    }
  }
  
  async getUserHistory(params: { userId: string }): Promise<Array<{
    id: string;
    videoId: string;
    title: string;
    createdAt: string;
    status: 'completed' | 'processing' | 'incomplete';
  }>> {
    try {
      const service = getSupabaseServiceClient();
      const { data: analyses, error } = await service
        .from('analyses')
        .select('id, video_id, title, created_at, validation_passed, validation_report')
        .eq('user_id', params.userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('[SupabasePersistenceAdapter] getUserHistory failed:', error);
        throw error;
      }

      return (analyses || []).map((analysis: AnalysisRow) => ({
        id: analysis.id,
        videoId: analysis.video_id,
        title: analysis.title || 'Untitled Analysis',
        createdAt: analysis.created_at,
        status: (analysis.validation_passed || analysis.validation_report?.status === 'completed' || analysis.validation_report?.status === 'done') ? 'completed' :
                (analysis.validation_report?.status === 'processing' ? 'processing' : 'incomplete'),
      }));
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getUserHistory' },
        extra: { userId: params.userId },
      });
      throw error;
    }
  }

  async findAnalysisById(params: {
    userId: string;
    analysisId: string;
  }): Promise<{
    id: string;
    title: string;
    videoId: string;
    analysisMarkdown: string;
    createdAt: string;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id, title, video_id, analysis_markdown, created_at')
        .eq('id', params.analysisId)
        .eq('user_id', params.userId)
        .maybeSingle();

      if (error) {
        console.error('[SupabasePersistenceAdapter] findAnalysisById failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        title: data.title || 'Untitled',
        videoId: data.video_id,
        analysisMarkdown: data.analysis_markdown || '',
        createdAt: data.created_at,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisById' },
        extra: { userId: params.userId, analysisId: params.analysisId },
      });
      throw error;
    }
  }

  async updateUserTier(params: {
    userId: string;
    tier: 'pro' | 'free';
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error, count } = await service
        .from('users')
        .update({ tier: params.tier, updated_at: new Date().toISOString() }, { count: 'exact' })
        .eq('id', params.userId);

      if (error) {
        console.error('[SupabasePersistenceAdapter] updateUserTier failed:', error.message);
        throw error;
      }

      if (count === 0 || count === null) {
        throw new Error(`No user row matched for userId: ${params.userId} when updating to tier: ${params.tier}`);
      }
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'updateUserTier' },
        extra: { userId: params.userId, tier: params.tier },
      });
      throw error;
    }
  }

  async getConversations(userId: string): Promise<ChatConversation[]> {
    if (!userId) return [];
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_conversations')
        .select('id, user_id, title, analysis_id, created_at, updated_at, last_message_at')
        .eq('user_id', userId)
        .order('last_message_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('[SupabasePersistenceAdapter] getConversations failed:', error.message);
        throw error;
      }

      return (data || []).map((r: ConversationRow) => ({
        id: r.id,
        userId: r.user_id,
        title: r.title || 'Untitled',
        analysisId: r.analysis_id,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        lastMessageAt: r.last_message_at || r.created_at,
      }));
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getConversations' },
        extra: { userId },
      });
      throw error;
    }
  }

  async createConversation(params: {
    userId: string;
    analysisId: string | null;
    title: string;
  }): Promise<ChatConversation> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_conversations')
        .insert({ user_id: params.userId, analysis_id: params.analysisId, title: params.title })
        .select('id, user_id, title, analysis_id, created_at, updated_at, last_message_at')
        .single();

      if (error || !data) {
        console.error('[SupabasePersistenceAdapter] createConversation failed:', error?.message);
        throw error || new Error('createConversation returned no row');
      }

      return {
        id: data.id,
        userId: data.user_id,
        title: data.title || 'Untitled',
        analysisId: data.analysis_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        lastMessageAt: data.last_message_at || data.created_at,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'createConversation' },
        extra: { userId: params.userId, analysisId: params.analysisId },
      });
      throw error;
    }
  }

  async getConversation(params: {
    conversationId: string;
  }): Promise<ChatConversation | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_conversations')
        .select('id, user_id, title, analysis_id, created_at, updated_at, last_message_at')
        .eq('id', params.conversationId)
        .maybeSingle();

      if (error) {
        console.error('[SupabasePersistenceAdapter] getConversation failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        userId: data.user_id,
        title: data.title || 'Untitled',
        analysisId: data.analysis_id,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        lastMessageAt: data.last_message_at || data.created_at,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getConversation' },
        extra: { conversationId: params.conversationId },
      });
      throw error;
    }
  }

  async updateConversationTitle(params: {
    conversationId: string;
    title: string;
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service
        .from('chat_conversations')
        .update({ title: params.title })
        .eq('id', params.conversationId);

      if (error) {
        console.error('[SupabasePersistenceAdapter] updateConversationTitle failed:', error.message);
        throw error;
      }
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'updateConversationTitle' },
        extra: { conversationId: params.conversationId },
      });
      throw error;
    }
  }

  async getMessages(params: {
    conversationId: string;
  }): Promise<ChatMessage[]> {
    if (!params.conversationId) return [];
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .select('id, conversation_id, role, content, created_at, client_msg_id')
        .eq('conversation_id', params.conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[SupabasePersistenceAdapter] getMessages failed:', error.message);
        throw error;
      }

      return (data || []).map((r: MessageRow) => ({
        id: r.id,
        conversationId: r.conversation_id,
        role: r.role,
        content: r.content,
        createdAt: r.created_at,
        clientMsgId: r.client_msg_id ?? null,
      }));
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getMessages' },
        extra: { conversationId: params.conversationId },
      });
      throw error;
    }
  }

  async findMessageByClientMsgId(params: {
    conversationId: string;
    clientMsgId: string;
  }): Promise<ChatMessage | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .select('id, conversation_id, role, content, created_at, client_msg_id')
        .eq('conversation_id', params.conversationId)
        .eq('client_msg_id', params.clientMsgId)
        .maybeSingle();

      if (error) {
        console.error('[SupabasePersistenceAdapter] findMessageByClientMsgId failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        conversationId: data.conversation_id,
        role: data.role,
        content: data.content,
        createdAt: data.created_at,
        clientMsgId: data.client_msg_id ?? null,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findMessageByClientMsgId' },
        extra: { conversationId: params.conversationId, clientMsgId: params.clientMsgId },
      });
      throw error;
    }
  }

  async createMessage(params: {
    conversationId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    clientMsgId?: string | null;
    parentMessageId?: string | null;
  }): Promise<ChatMessage> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .insert({
          conversation_id: params.conversationId,
          user_id: params.userId,
          role: params.role,
          content: params.content,
          client_msg_id: params.clientMsgId,
          parent_message_id: params.parentMessageId,
        })
        .select('id, conversation_id, role, content, created_at, client_msg_id, parent_message_id')
        .single();

      if (error || !data) {
        console.error('[SupabasePersistenceAdapter] createMessage failed:', error?.message);
        throw error || new Error('createMessage returned no row');
      }

      return {
        id: data.id,
        conversationId: data.conversation_id,
        role: data.role,
        content: data.content,
        createdAt: data.created_at,
        clientMsgId: data.client_msg_id ?? null,
        parentMessageId: data.parent_message_id ?? null,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'createMessage' },
        extra: { conversationId: params.conversationId, userId: params.userId },
      });
      throw error;
    }
  }

  async findAssistantMessageAfter(params: {
    conversationId: string;
    timestamp: string;
  }): Promise<ChatMessage | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .select('id, conversation_id, role, content, created_at, client_msg_id, parent_message_id')
        .eq('conversation_id', params.conversationId)
        .eq('role', 'assistant')
        .gt('created_at', params.timestamp)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[SupabasePersistenceAdapter] findAssistantMessageAfter failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        conversationId: data.conversation_id,
        role: data.role,
        content: data.content,
        createdAt: data.created_at,
        clientMsgId: data.client_msg_id ?? null,
        parentMessageId: data.parent_message_id ?? null,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAssistantMessageAfter' },
        extra: { conversationId: params.conversationId, timestamp: params.timestamp },
      });
      throw error;
    }
  }

  async findAssistantByParentId(params: {
    conversationId: string;
    parentId: string;
  }): Promise<ChatMessage | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('chat_messages')
        .select('id, conversation_id, role, content, created_at, client_msg_id, parent_message_id')
        .eq('conversation_id', params.conversationId)
        .eq('role', 'assistant')
        .eq('parent_message_id', params.parentId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[SupabasePersistenceAdapter] findAssistantByParentId failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        conversationId: data.conversation_id,
        role: data.role,
        content: data.content,
        createdAt: data.created_at,
        clientMsgId: data.client_msg_id ?? null,
        parentMessageId: data.parent_message_id ?? null,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAssistantByParentId' },
        extra: { conversationId: params.conversationId, parentId: params.parentId },
      });
      throw error;
    }
  }

  async getAnalysisGrounding(params: {
    analysisId: string;
  }): Promise<{
    title: string;
    channelTitle: string | null;
    description: string | null;
    analysisMarkdown: string | null;
    status: string;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('title, channel_title, analysis_markdown, validation_report')
        .eq('id', params.analysisId)
        .maybeSingle();

      if (error) {
        console.error('[SupabasePersistenceAdapter] getAnalysisGrounding failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        title: data.title || '',
        channelTitle: data.channel_title || null,
        description: isPersistedValidationReport(data.validation_report) ? data.validation_report.metadata?.description || null : null,
        analysisMarkdown: data.analysis_markdown || null,
        status: isPersistedValidationReport(data.validation_report) ? data.validation_report.status || 'incomplete' : 'incomplete',
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getAnalysisGrounding' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }
  }

  async findAnalysisForPersist(params: {
    analysisId: string;
    videoId: string;
  }): Promise<{
    id: string;
    userId: string;
    title: string;
    validationReport: ValidationReportInput | unknown;
    createdAt: string;
    channelTitle?: string | null;
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id, user_id, title, validation_report, created_at, channel_title')
        .eq('id', params.analysisId)
        .eq('video_id', params.videoId)
        .maybeSingle();

      if (error) {
        console.error('[SupabasePersistenceAdapter] findAnalysisForPersist failed:', error.message);
        throw error;
      }
      if (!data) return null;

      return {
        id: data.id,
        userId: data.user_id,
        title: data.title,
        validationReport: data.validation_report,
        createdAt: data.created_at,
        channelTitle: data.channel_title,
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisForPersist' },
        extra: { analysisId: params.analysisId, videoId: params.videoId },
      });
      throw error;
    }
  }

  async updateAnalysisResult(params: {
  analysisId: string;
  markdown: string;
  payload: UCISPayloadV2 | null;
  model: string | null;
  validationPassed: boolean;
  validationReport: ValidationReportInput | unknown;
}): Promise<void> {
  try {
    const service = getSupabaseServiceClient();

    // 1️⃣ Fetch analysis meta to obtain video_id, title and user_id
    const { data: analysisMeta } = await service
      .from('analyses')
      .select('video_id, title, user_id')
      .eq('id', params.analysisId)
      .single();

    // 2️⃣ Upsert video record ensuring FK user_id
    if (analysisMeta?.video_id) {
      try {
        await service
          .from('videos')
          .upsert(
            {
              id: analysisMeta.video_id,
              title: analysisMeta.title ?? '',
              user_id: analysisMeta.user_id,
            },
            { onConflict: 'id' }
          )
          .single();
      } catch (e) {
        console.warn('[SupabasePersistenceAdapter] video upsert skipped:', e);
      }
    }

    // 3️⃣ Update the primary analysis row
    const { error: analysisError } = await service
      .from('analyses')
      .update({
        analysis_markdown: params.markdown,
        analysis_payload: params.payload ?? null,
        model_used: params.model || 'edge-stream',
        validation_passed: params.validationPassed,
        validation_report: params.validationReport,
        billing_status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.analysisId);

    if (analysisError) {
      console.error('[SupabasePersistenceAdapter] updateAnalysisResult failed:', analysisError.message);
      throw analysisError;
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
        content_text: c.text ?? String(c),
        metadata_payload: c.metadata ?? {},
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
  } catch (error: any) {
    Sentry.captureException(error, {
      tags: { method: 'updateAnalysisResult' },
      extra: { analysisId: params.analysisId },
    });
    throw error;
  }
}

  async getAnalysesByTenant(tenantId: string): Promise<Array<{ id: string; title: string; nodes: GraphNode[]; edges: GraphEdge[] }>> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select(`
          id, 
          title, 
          nodes:analysis_payload->knowledgeGraph->nodes, 
          edges:analysis_payload->knowledgeGraph->edges
        `)
        .eq('user_id', tenantId);

      if (error) {
        console.error('[SupabasePersistenceAdapter] getAnalysesByTenant failed:', error.message);
        throw error;
      }
      
      return (data || []).map(row => {
        return {
          id: row.id,
          title: row.title || 'Untitled Analysis',
          nodes: (row.nodes as unknown as GraphNode[]) || [],
          edges: (row.edges as unknown as GraphEdge[]) || []
        };
      });
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getAnalysesByTenant' },
        extra: { tenantId },
      });
      throw error;
    }
  }

  async persistKnowledgeGraph(params: {
    analysisId: string;
    entities: Array<{
      label: string;
      type: string;
      weight: number;
      rawNode?: any;
    }>;
    relations: Array<{
      source: string;
      target: string;
      relation: string;
      strength: number;
      rawEdge?: any;
    }>;
  }): Promise<void> {
    const service = getSupabaseServiceClient();

    // Delete existing for clean slate
    const { error: deleteError } = await service
      .from('kg_entities')
      .delete()
      .eq('analysis_id', params.analysisId);

    if (deleteError) throw deleteError;

    // Insert entities
    const { data: entityRows, error: entityError } = await service
      .from('kg_entities')
      .insert(params.entities.map(e => ({
        analysis_id: params.analysisId,
        label: e.label,
        type: e.type,
        weight: e.weight,
        raw_node: e.rawNode ?? null
      })))
      .select('id, label');

    if (entityError) throw entityError;

    // Map label to ID
    const labelToId = new Map(entityRows.map(r => [r.label, r.id]));

    // Insert relations
    const relationRows = params.relations.map(r => ({
      analysis_id: params.analysisId,
      source_entity_id: labelToId.get(r.source),
      target_entity_id: labelToId.get(r.target),
      relation_label: r.relation,
      strength: r.strength,
      raw_edge: r.rawEdge ?? null
    })).filter(r => r.source_entity_id && r.target_entity_id);

    if (relationRows.length > 0) {
      const { error: relationError } = await service
        .from('kg_relations')
        .insert(relationRows);
      
      if (relationError) throw relationError;
    }
  }

  async getKnowledgeGraph(analysisId: string): Promise<{
    entities: Array<{ id: string; label: string; type: string; weight: number; raw_node?: any }>;
    relations: Array<{ source_entity_id: string; target_entity_id: string; relation_label: string; strength: number; raw_edge?: any }>;
  } | null> {
    try {
      const service = getSupabaseServiceClient();

      const [entities, relations] = await Promise.all([
        service.from('kg_entities').select('id, label, type, weight, raw_node').eq('analysis_id', analysisId),
        service.from('kg_relations').select('source_entity_id, target_entity_id, relation_label, strength, raw_edge').eq('analysis_id', analysisId)
      ]);

      if (entities.error) throw entities.error;
      if (relations.error) throw relations.error;

      return {
        entities: entities.data || [],
        relations: relations.data || []
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'getKnowledgeGraph' },
        extra: { analysisId },
      });
      throw error;
    }
  }

  async persistGraph(params: {
    analysisId: string;
    nodes: GraphNode[];
    relations: GraphEdge[];
  }): Promise<void> {
    const entities = params.nodes.map(n => ({
      label: n.label,
      type: n.entityType || 'concept',
      weight: n.weight,
      rawNode: n
    }));
    const relations = params.relations.map(e => ({
      source: e.source,
      target: e.target,
      relation: e.kind,
      strength: e.strength,
      rawEdge: e
    }));
    return this.persistKnowledgeGraph({ analysisId: params.analysisId, entities, relations });
  }

  async getGraph(analysisId: string): Promise<{ nodes: GraphNode[]; relations: GraphEdge[] } | null> {
    const data = await this.getKnowledgeGraph(analysisId);
    if (!data) return null;
    return {
      nodes: data.entities.map(e => {
        if (e.raw_node) return e.raw_node as GraphNode;
        return { 
          id: e.id, 
          label: e.label, 
          dimension: 0, 
          content: '', 
          polarity: 0, 
          keyTerms: [], 
          inPersona: false,
          entityType: e.type,
          weight: e.weight
        };
      }),
      relations: data.relations.map(r => {
        if (r.raw_edge) return r.raw_edge as GraphEdge;
        return { 
          source: r.source_entity_id, 
          target: r.target_entity_id, 
          kind: r.relation_label as any, 
          strength: r.strength 
        };
      })
    };
  }

  async updateBillingStatus(params: {
    analysisId: string;
    status: 'processing' | 'completed' | 'failed';
  }): Promise<void> {
    try {
      const service = getSupabaseServiceClient();
      const { error } = await service
        .from('analyses')
        .update({
          billing_status: params.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.analysisId);

      if (error) {
        console.error('[SupabasePersistenceAdapter] updateBillingStatus failed:', error.message);
        throw error;
      }
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'updateBillingStatus' },
        extra: { analysisId: params.analysisId, status: params.status },
      });
      throw error;
    }
  }

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
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'persistAnalysisChunk' },
        extra: { analysisId: params.analysisId, chunkIndex: params.chunkIndex },
      });
      throw error;
    }
  }

  async findAnalysisChunks(params: {
    analysisId: string;
  }): Promise<Array<{ chunk_index: number; dimensions_covered: number[]; payload: any; status: string }> | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analysis_chunks')
        .select('chunk_index, dimensions_covered, payload, status')
        .eq('analysis_id', params.analysisId);

      if (error) {
        console.error('[SupabasePersistenceAdapter] findAnalysisChunks failed:', error.message);
        throw error;
      }
      return data || [];
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAnalysisChunks' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }
  }
}