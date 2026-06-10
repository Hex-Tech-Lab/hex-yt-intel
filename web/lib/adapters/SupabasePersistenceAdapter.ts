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

interface ValidationReport {
  status?: string;
  transcript_available?: boolean;
  analysis_type?: string;
  stale_after?: string;
  metadata?: any;
  persona?: string;
  timezone?: string;
  model_used?: string | null;
  valid?: boolean;
}

function isValidationReport(obj: unknown): obj is ValidationReport {
  return typeof obj === 'object' && obj !== null;
}

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
    const { data: prepared, error: insertError } = await service
      .from('analyses')
      .upsert(
        {
          video_id: params.videoId,
          user_id: params.userId,
          title: params.title,
          analysis_markdown: '',
          analysis_payload: {},
          model_used: 'edge-stream',
          validation_report: {
            status: params.validationReport.status,
            transcript_available: params.validationReport.transcriptAvailable,
            analysis_type: params.validationReport.analysisType,
            stale_after: params.validationReport.staleAfter,
            metadata: params.validationReport.metadata,
            persona: params.validationReport.persona,
            timezone: params.validationReport.timezone,
          },
          validation_passed: false,
        },
        { onConflict: 'user_id,video_id' }
      )
      .select('id')
      .single();

    if (insertError || !prepared?.id) {
      Sentry.captureException(insertError ?? new Error('upsert returned no row'), {
        tags: { operation: 'analysis-prepare-upsert' },
        extra: { videoId: params.videoId, userId: params.userId },
      });
      throw insertError ?? new Error('upsert returned no row');
    }

    return { id: prepared.id as string };
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
      })
      .eq('id', params.analysisId);

    if (error) {
      Sentry.captureException(error, {
        tags: { operation: 'analysis-persist' },
        extra: { analysisId: params.analysisId },
      });
      throw error;
    }
  }  async getUserHistory(params: { userId: string }): Promise<Array<{
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
        status: analysis.validation_passed ? 'completed' :
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
        })
        .select('id, conversation_id, role, content, created_at, client_msg_id')
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
        .select('id, conversation_id, role, content, created_at, client_msg_id')
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
      };
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'findAssistantMessageAfter' },
        extra: { conversationId: params.conversationId, timestamp: params.timestamp },
      });
      throw error;
    }
  }

  async getAnalysisGrounding(params: {
    analysisId: string;
  }): Promise<{
    title: string;
    channelTitle: string | null;
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
        analysisMarkdown: data.analysis_markdown || null,
        status: isValidationReport(data.validation_report) ? data.validation_report.status || 'incomplete' : 'incomplete',
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
  } | null> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select('id, user_id, title, validation_report, created_at')
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
      const { error } = await service
        .from('analyses')
        .update({
          analysis_markdown: params.markdown,
          analysis_payload: params.payload ?? null,
          model_used: params.model || 'edge-stream',
          validation_passed: params.validationPassed,
          validation_report: params.validationReport,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.analysisId);

      if (error) {
        console.error('[SupabasePersistenceAdapter] updateAnalysisResult failed:', error.message);
        throw error;
      }
    } catch (error: any) {
      Sentry.captureException(error, {
        tags: { method: 'updateAnalysisResult' },
        extra: { analysisId: params.analysisId },
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
    }>;
    relations: Array<{
      source: string;
      target: string;
      relation: string;
      strength: number;
    }>;
  }): Promise<void> {
    const service = getSupabaseServiceClient();

    // Delete existing for clean slate
    await service.from('kg_entities').delete().eq('analysis_id', params.analysisId);

    // Insert entities
    const { data: entityRows, error: entityError } = await service
      .from('kg_entities')
      .insert(params.entities.map(e => ({
        analysis_id: params.analysisId,
        label: e.label,
        type: e.type,
        weight: e.weight
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
      strength: r.strength
    })).filter(r => r.source_entity_id && r.target_entity_id);

    if (relationRows.length > 0) {
      const { error: relationError } = await service
        .from('kg_relations')
        .insert(relationRows);
      
      if (relationError) throw relationError;
    }
  }
}