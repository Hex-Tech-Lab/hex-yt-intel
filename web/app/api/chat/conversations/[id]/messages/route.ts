export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  SupabaseAuthAdapter,
  SupabasePersistenceAdapter,
  StreamTokenAdapter,
  SettingsModelAdapter,
} from '@/lib/adapters';
import { resolveReasoningCascade } from '@/lib/services/settings';

  /* GET — load a thread's messages (RLS scopes to owner). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authAdapter = new SupabaseAuthAdapter();
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const persistenceAdapter = new SupabasePersistenceAdapter();
    const conv = await persistenceAdapter.getConversation({ conversationId: id });
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (conv.userId !== identity.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const messages = await persistenceAdapter.getMessages({ conversationId: id });
    return NextResponse.json({ messages });
  } catch (error) {
    console.error('[chat] load messages failed:', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }
}

/*
 * POST — append a user message (idempotent on client_msg_id) and STREAM the assistant
 * reply via SSE. Events: user | title | delta | done | error.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authAdapter = new SupabaseAuthAdapter();
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userId, tier } = identity;

  try {
    const body = await request.json().catch(() => ({}));
    const rawContent = typeof body.content === 'string' ? body.content.trim() : '';
    const clientMsgId = typeof body.clientMsgId === 'string' ? body.clientMsgId : null;
    if (!rawContent) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }

    let finalContent = rawContent;
    const isReasoning = rawContent.startsWith('/reason') || 
                        rawContent.startsWith('/think') || 
                        /\b(reason|explain|verify|calculate|logic|why|analyze deeply|deep dive)\b/i.test(rawContent);

    if (rawContent.startsWith('/reason')) {
      finalContent = rawContent.slice(7).trim();
    } else if (rawContent.startsWith('/think')) {
      finalContent = rawContent.slice(6).trim();
    }

    if (!finalContent) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }

    const persistenceAdapter = new SupabasePersistenceAdapter();
    const modelAdapter = new SettingsModelAdapter();
    const tokenAdapter = new StreamTokenAdapter();

    const conv = await persistenceAdapter.getConversation({ conversationId: id });
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (conv.userId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // --- Idempotent user-message write ---------------------------------------
    let userRow = null;
    let isRetry = false;

    if (clientMsgId) {
      const existing = await persistenceAdapter.findMessageByClientMsgId({
        conversationId: id,
        clientMsgId,
      });
      if (existing) {
        userRow = existing;
        isRetry = true;
      }
    }

    // --- Enforce turn limits based on user tier ------------------------------
    const allMessages = await persistenceAdapter.getMessages({ conversationId: id });
    const userMessageCount = allMessages.filter((m) => m.role === 'user').length;

    const limits: Record<string, number> = {
      free: 5,
      pro: 30,
      enterprise: 100,
    };
    const userLimit = limits[tier] || 5;

    if (userMessageCount >= userLimit && !isRetry) {
      return NextResponse.json({
        error: `Turn limit reached. Your plan (${tier}) is limited to ${userLimit} user messages per conversation. Please upgrade or start a new chat.`,
        code: 'ERR_CHAT_LIMIT_EXCEEDED'
      }, { status: 403 });
    }

    if (!userRow) {
      try {
        userRow = await persistenceAdapter.createMessage({
          conversationId: id,
          userId,
          role: 'user',
          content: finalContent,
          clientMsgId,
        });
      } catch (error: any) {
        // Unique violation or concurrency check
        if (clientMsgId) {
          const raced = await persistenceAdapter.findMessageByClientMsgId({
            conversationId: id,
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

    // If this is a retry that already produced an assistant reply, return it (no regen).
    if (isRetry && userRow) {
      const laterAssistant = await persistenceAdapter.findAssistantMessageAfter({
        conversationId: id,
        timestamp: userRow.createdAt,
      });
      if (laterAssistant) {
        return NextResponse.json({
          user: userRow,
          assistant: laterAssistant,
        });
      }
    }

    // Auto-title from the first user message.
    let newTitle: string | undefined;
    if (conv.title === 'New chat') {
      const title = finalContent.slice(0, 60);
      newTitle = title;
      await persistenceAdapter.updateConversationTitle({
        conversationId: id,
        title,
      });
    }

    // Replay bounded history (model is stateless).
    const historyMessages = await persistenceAdapter.getMessages({ conversationId: id });
    const HISTORY_TURNS = 20;
    // Bounded history: get the last HISTORY_TURNS messages
    const history = historyMessages.slice(-HISTORY_TURNS);

    // Grounding from the linked analysis.
    let grounding = '';
    if (conv.analysisId) {
      const a = await persistenceAdapter.getAnalysisGrounding({ analysisId: conv.analysisId });
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

    // Resolve the per-tier chat cascade (or reasoning cascade if triggered) and bind it into the token
    const chatModels = isReasoning
      ? await resolveReasoningCascade(tier)
      : await modelAdapter.resolveModels(tier, 'chat');
    const { sig, exp } = tokenAdapter.signChatToken({
      conversationId: id,
      userId,
      models: chatModels,
    });

    return NextResponse.json({
      user: userRow,
      ...(newTitle ? { title: newTitle } : {}),
      stream: {
        url: `${process.env.NEXT_PUBLIC_WORKER_URL || ''}/chat-stream`,
        sig,
        exp,
      },
      payload: {
        conversationId: id,
        userId,
        grounding,
        history: history.map((m) => ({ role: m.role, content: m.content })),
        models: chatModels,
      },
    });
  } catch (error) {
    console.error('[chat POST] Exception:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}