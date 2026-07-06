import type {
  ChatPersistencePort,
  ModelResolutionPort,
  CryptographicTokenPort,
} from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';
import type { ChatMessage } from '@/lib/types/chat';
import { env } from '@/lib/env';

export interface ProcessChatMessageUseCaseParams {
  conversationId: string;
  userId: string;
  tier: UserTier;
  content: string;
  clientMsgId?: string | null;
}

export interface ProcessChatMessageSuccess {
  user: ChatMessage;
  assistant?: ChatMessage; // present if it's a retry and response already exists
  title?: string;
  stream?: {
    url: string;
    sig: string;
    exp: number;
  };
  payload?: {
    conversationId: string;
    userId: string;
    grounding: string;
    history: Array<{ role: string; content: string }>;
    models: string[];
  };
}

export type ProcessChatMessageResult =
  | { type: 'success'; data: ProcessChatMessageSuccess }
  | { type: 'error'; code: string; status: number; message: string };

export class ProcessChatMessageUseCase {
  constructor(
    private chatPersistence: ChatPersistencePort,
    private modelResolution: ModelResolutionPort,
    private tokenCrypto: CryptographicTokenPort
  ) {}

  async execute(params: ProcessChatMessageUseCaseParams): Promise<ProcessChatMessageResult> {
    const { conversationId, userId, tier, content: rawContent, clientMsgId } = params;

    const trimmedRaw = rawContent.trim();
    if (!trimmedRaw) {
      return { type: 'error', code: 'ERR_EMPTY_MESSAGE', status: 400, message: 'Empty message' };
    }

    let finalContent = trimmedRaw;
    const isReasoning = trimmedRaw.startsWith('/reason') || 
                        trimmedRaw.startsWith('/think') || 
                        /\b(reason|explain|verify|calculate|logic|why|analyze deeply|deep dive)\b/i.test(trimmedRaw);

    if (trimmedRaw.startsWith('/reason')) {
      finalContent = trimmedRaw.slice(7).trim();
    } else if (trimmedRaw.startsWith('/think')) {
      finalContent = trimmedRaw.slice(6).trim();
    }

    if (!finalContent) {
      return { type: 'error', code: 'ERR_EMPTY_MESSAGE', status: 400, message: 'Empty message' };
    }

    // 1. Load conversation and messages in parallel to avoid sequential network roundtrips
    const [conv, allMessages] = await Promise.all([
      this.chatPersistence.getConversation({ conversationId }),
      this.chatPersistence.getMessages({ conversationId }),
    ]);

    if (!conv) {
      return { type: 'error', code: 'ERR_CONVERSATION_NOT_FOUND', status: 404, message: 'Conversation not found' };
    }
    if (conv.userId !== userId) {
      return { type: 'error', code: 'ERR_FORBIDDEN', status: 403, message: 'Forbidden' };
    }

    // 2. Idempotent user-message lookup (in-memory lookup from pre-loaded history)
    let userRow: ChatMessage | null = null;
    let isRetry = false;

    if (clientMsgId) {
      const existing = allMessages.find((m) => m.clientMsgId === clientMsgId);
      if (existing) {
        userRow = existing;
        isRetry = true;
      }
    }

    // 3. Enforce turn limits based on user tier
    const userMessageCount = allMessages.filter((m) => m.role === 'user').length;

    const limits: Record<UserTier, number> = {
      free: 5,
      pro: 30,
      enterprise: 100,
    };
    const userLimit = limits[tier] || 5;

    if (userMessageCount >= userLimit && !isRetry) {
      return {
        type: 'error',
        code: 'ERR_CHAT_LIMIT_EXCEEDED',
        status: 403,
        message: `Turn limit reached. Your plan (${tier}) is limited to ${userLimit} user messages per conversation. Please upgrade or start a new chat.`,
      };
    }

    // 4. Create user message (if needed) and fetch grounding in parallel to minimize latency
    let groundingResult: any = null;
    if (!userRow) {
      try {
        const [createdMsg, ground] = await Promise.all([
          this.chatPersistence.createMessage({
            conversationId,
            userId,
            role: 'user',
            content: finalContent,
            clientMsgId,
          }).catch(async (error: any) => {
            // Handle race conditions/duplicate client message writes gracefully
            if (clientMsgId) {
              const raced = await this.chatPersistence.findMessageByClientMsgId({
                conversationId,
                clientMsgId,
              });
              if (raced) {
                isRetry = true;
                return raced;
              }
            }
            throw error;
          }),
          conv.analysisId
            ? this.chatPersistence.getAnalysisGrounding({ analysisId: conv.analysisId })
            : Promise.resolve(null),
        ]);
        userRow = createdMsg;
        groundingResult = ground;
      } catch (error) {
        console.error('[chat-usecase] Failed during parallel user-message write / grounding fetch:', error);
        throw error;
      }
    } else {
      // Message already exists, just fetch grounding if conversation has analysisId
      if (conv.analysisId) {
        groundingResult = await this.chatPersistence.getAnalysisGrounding({ analysisId: conv.analysisId });
      }
    }

    // 5. If it's a retry and we already generated a reply, return it immediately without regening
    if (isRetry && userRow) {
      const laterAssistant = await this.chatPersistence.findAssistantByParentId({
        conversationId,
        parentId: userRow.id,
      });
      if (laterAssistant) {
        return {
          type: 'success',
          data: {
            user: userRow,
            assistant: laterAssistant,
          },
        };
      }
    }

    // 6. Handle auto-titling for new chats
    let newTitle: string | undefined;
    if (conv.title === 'New chat') {
      const title = finalContent.slice(0, 60);
      newTitle = title;
      await this.chatPersistence.updateConversationTitle({
        conversationId,
        title,
      });
    }

    // 7. Get last 20 messages for context replay (constructed in-memory to save a query)
    const historyMessages = userRow && !allMessages.some((m) => m.id === userRow!.id)
      ? [...allMessages, userRow]
      : allMessages;
    const HISTORY_TURNS = 20;
    const history = historyMessages.slice(-HISTORY_TURNS);

    // 8. Grounding retrieval
    let grounding = '';
    if (groundingResult) {
      const md = typeof groundingResult.analysisMarkdown === 'string' ? groundingResult.analysisMarkdown : '';
      const status = groundingResult.status;
      const description = groundingResult.description;
      const descriptionSection = description 
        ? `\n\n--- YOUTUBE VIDEO DESCRIPTION (contains official links & resources) ---\n${description}\n\n`
        : '';

      if (md.trim().length > 0) {
        grounding =
          `You are the analyst for the YouTube video "${groundingResult.title}"${groundingResult.channelTitle ? ` by ${groundingResult.channelTitle}` : ''}. ` +
          `Answer the user's questions using the structured analysis and the description below; be concise, accurate, and cite dimension names where relevant. ` +
          `Do not ask which video — you have it.` +
          descriptionSection +
          `--- ANALYSIS ---\n` +
          md.slice(0, 12000);
      } else {
        grounding =
          `You are the analyst for the YouTube video "${groundingResult.title}"${groundingResult.channelTitle ? ` by ${groundingResult.channelTitle}` : ''}. ` +
          `The full ${status === 'processing' ? 'analysis is still being generated' : 'analysis is not available yet'} — answer from the title/topic and description ` +
          `and let the user know richer answers will be available once the synthesis finishes. Never claim you don't know which video this is.` +
          descriptionSection;
      }
    }

    // 8b. GROUNDING GATE (security). The chat's entire universe is THIS video's
    // analysis — it must never answer from general knowledge or bind to another
    // video. If the bound analysis has no usable content, do NOT mint a stream
    // token; refuse with a controlled, persisted assistant turn instead. This is
    // what stops an ungrounded model from inventing answers (e.g. a full recipe)
    // for a video that has no transcript.
    const groundedMarkdown =
      typeof groundingResult?.analysisMarkdown === 'string' ? groundingResult.analysisMarkdown.trim() : '';
    if (groundedMarkdown.length === 0) {
      const refusal =
        groundingResult?.status === 'processing'
          ? "This video's analysis is still being generated — I'll be able to answer from it once the synthesis finishes."
          : "I can only answer from this video's own analysis, and it doesn't have one: no transcript or captions were available, so there's nothing for me to ground on. Try a video that has captions and I'll answer strictly from its analysis.";
      const assistant = await this.chatPersistence.createMessage({
        conversationId,
        userId,
        role: 'assistant',
        content: refusal,
        parentMessageId: userRow!.id,
      });
      return {
        type: 'success',
        data: {
          user: userRow!,
          assistant,
          ...(newTitle ? { title: newTitle } : {}),
        },
      };
    }

    // 9. Resolve LLM models based on reasoning flag
    const chatModels = isReasoning
      ? await this.modelResolution.resolveModels(tier, 'reasoning')
      : await this.modelResolution.resolveModels(tier, 'chat');

    // 10. Generate cryptographic stream token
    let sig: string;
    let exp: number;
    try {
      const token = await this.tokenCrypto.signChatToken({
        conversationId,
        userId,
        models: chatModels,
      });
      sig = token.sig;
      exp = token.exp;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ProcessChatMessageUseCase] Token signing failed:', msg);
      return {
        type: 'error',
        code: 'ERR_TOKEN_SIGNING_FAILED',
        status: 500,
        message: 'Security configuration error: unable to sign stream token.',
      };
    }

    return {
      type: 'success',
      data: {
        user: userRow!,
        ...(newTitle ? { title: newTitle } : {}),
        stream: {
          url: `${env.cloudflareWorkerUrl}/chat-stream`,
          sig,
          exp,
        },
        payload: {
          conversationId,
          userId,
          grounding,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          models: chatModels,
        },
      },
    };
  }
}
