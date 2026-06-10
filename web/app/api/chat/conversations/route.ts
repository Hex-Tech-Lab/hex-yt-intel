export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';

const authAdapter = new SupabaseAuthAdapter();
const persistenceAdapter = new SupabasePersistenceAdapter();

/** GET /api/chat/conversations — list the signed-in user's threads (history). */
export async function GET() {
  const identity = await authAdapter.authenticate();
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const conversations = await persistenceAdapter.getConversations(identity.userId);
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('[chat] list conversations failed:', error);
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });
  }
}

/** POST /api/chat/conversations — start a new thread (optionally grounded). */
export async function POST(request: NextRequest) {
  const identity = await authAdapter.authenticate();
  if (!identity) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const analysisId = typeof body.analysisId === 'string' ? body.analysisId : null;
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'New chat';

    const conversation = await persistenceAdapter.createConversation({
      userId: identity.userId,
      analysisId,
      title,
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    console.error('[chat] create conversation failed:', error);
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
  }
}
