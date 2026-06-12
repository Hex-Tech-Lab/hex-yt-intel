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
import { ProcessChatMessageUseCase } from '@/lib/usecases/ProcessChatMessageUseCase';

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
 * POST — append a user message and return token signed for streaming worker access
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
    const rawContent = typeof body.content === 'string' ? body.content : '';
    const clientMsgId = typeof body.clientMsgId === 'string' ? body.clientMsgId : null;

    const persistenceAdapter = new SupabasePersistenceAdapter();
    const modelAdapter = new SettingsModelAdapter();
    const tokenAdapter = new StreamTokenAdapter();

    const useCase = new ProcessChatMessageUseCase(
      persistenceAdapter,
      modelAdapter,
      tokenAdapter
    );

    const result = await useCase.execute({
      conversationId: id,
      userId,
      tier,
      content: rawContent,
      clientMsgId,
    });

    if (result.type === 'error') {
      return NextResponse.json(
        { error: result.message, code: result.code },
        { status: result.status }
      );
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error('[chat POST] Exception:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}