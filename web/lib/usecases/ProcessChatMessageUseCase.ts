import type {
  ChatPersistencePort,
  ModelResolutionPort,
  CryptographicTokenPort,
} from '@/lib/ports';
import type { UserTier } from '@/lib/types/billing';
import type { ChatMessage } from '@/lib/types/chat';

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

    // 1. Load conversation and validate ownership
    const conv = await this.chatPersistence.getConversation({ conversationId });
    if (!conv) {
      return { type: 'error', code: 'ERR_CONVERSATION_NOT_FOUND', status: 404, message: 'Conversation not found' };
    }
    if (conv.userId !== userId) {
      return { type: 'error', code: 'ERR_FORBIDDEN', status: 403, message: 'Forbidden' };
    }

    // 2. Idempotent user-message lookup
    let userRow: ChatMessage | null = null;
    let isRetry = false;

    if (clientMsgId) {
      const existing = await this.chatPersistence.findMessageByClientMsgId({
        conversationId,
        clientMsgId,
      });
      if (existing) {
        userRow = existing;
        isRetry = true;
      }
    }

    // 3. Enforce turn limits based on user tier
    const allMessages = await this.chatPersistence.getMessages({ conversationId });
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

    // 4. Create user message if not exists
    if (!userRow) {
      try {
        userRow = await this.chatPersistence.createMessage({
          conversationId,
          userId,
          role: 'user',
          content: finalContent,
          clientMsgId,
        });
      } catch (error: any) {
        // Handle race conditions/duplicate client message writes gracefully
        if (clientMsgId) {
          const raced = await this.chatPersistence.findMessageByClientMsgId({
            conversationId,
            clientMsgId,
          });
          if (raced) {
            userRow = raced;
            isRetry = true;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    // 5. If it's a retry and we already generated a reply, return it immediately without regening
    if (isRetry && userRow) {
      const laterAssistant = await this.chatPersistence.findAssistantMessageAfter({
        conversationId,
        timestamp: userRow.createdAt,
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

    // 7. Get last 20 messages for context replay (bounded history)
    const historyMessages = await this.chatPersistence.getMessages({ conversationId });
    const HISTORY_TURNS = 20;
    const history = historyMessages.slice(-HISTORY_TURNS);

    // 8. Grounding retrieval
    let grounding = '';
    if (conv.analysisId) {
      const a = await this.chatPersistence.getAnalysisGrounding({ analysisId: conv.analysisId });
      if (a) {
        const md = typeof a.analysisMarkdown === 'string' ? a.analysisMarkdown : '';
        const status = a.status;
        if (md.trim().length > 0) {
          grounding =
            `You are the analyst for the YouTube video "${a.title}"${a.channelTitle ? ` by ${a.channelTitle}` : ''}. ` +
            `Answer the user's questions using the structured analysis below; be concise and cite dimension names where relevant. ` +
            `Do not ask which video — you have it.\n\n--- ANALYSIS ---\n` +
            md.slice(0, 12000);
        } else {
          grounding =
            `You are the analyst for the YouTube video "${a.title}"${a.channelTitle ? ` by ${a.channelTitle}` : ''}. ` +
            `The full ${status === 'processing' ? 'analysis is still being generated' : 'analysis is not available yet'} — answer from the title/topic ` +
            `and let the user know richer answers will be available once the synthesis finishes. Never claim you don't know which video this is.`;
        }
      }
    }

    // 9. Resolve LLM models based on reasoning flag
    const chatModels = isReasoning
      ? await this.modelResolution.resolveModels(tier, 'reasoning')
      : await this.modelResolution.resolveModels(tier, 'chat');

    // 10. Generate cryptographic stream token
    const { sig, exp } = this.tokenCrypto.signChatToken({
      conversationId,
      userId,
      models: chatModels,
    });

    return {
      type: 'success',
      data: {
        user: userRow,
        ...(newTitle ? { title: newTitle } : {}),
        stream: {
          url: `${process.env.NEXT_PUBLIC_WORKER_URL || ''}/chat-stream`,
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
