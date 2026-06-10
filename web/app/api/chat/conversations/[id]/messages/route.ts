export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import {
  SupabaseAuthAdapter,
  SupabasePersistenceAdapter,
  SettingsModelAdapter,
  StreamTokenAdapter,
} from '@/lib/adapters';

const authAdapter = new SupabaseAuthAdapter();
const persistenceAdapter = new SupabasePersistenceAdapter();
const modelAdapter = new SettingsModelAdapter();
const tokenAdapter = new StreamTokenAdapter();

const HISTORY_TURNS = 20;

/* GET — load a thread's messages (RLS scopes to owner). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
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
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { userId, tier } = identity;

  try {
    const body = await request.json().catch(() => ({}));
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const clientMsgId = typeof body.clientMsgId === 'string' ? body.clientMsgId : null;
    if (!content) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 });
    }

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

    if (!userRow) {
      try {
        userRow = await persistenceAdapter.createMessage({
          conversationId: id,
          userId,
          role: 'user',
          content,
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
      const title = content.slice(0, 60);
      newTitle = title;
      await persistenceAdapter.updateConversationTitle({
        conversationId: id,
        title,
      });
    }

    // Replay bounded history (model is stateless).
    const allMessages = await persistenceAdapter.getMessages({ conversationId: id });
    // Bounded history: get the last HISTORY_TURNS messages
    const history = allMessages.slice(-HISTORY_TURNS);

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

    // Resolve the per-tier chat cascade and bind it into the token
    const chatModels = await modelAdapter.resolveModels(tier, 'chat');
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