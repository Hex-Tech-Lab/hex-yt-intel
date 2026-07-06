export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
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
    const body: unknown = await request.json().catch(() => ({}));
    const payloadSchema = z.object({
      analysisId: z.string().nullable().optional().default(null),
      title: z.string()
        .transform(val => val.trim())
        .transform(val => val ? val.slice(0, 120) : 'New chat')
        .optional()
        .default('New chat')
    });

    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const { analysisId, title } = parsed.data;

    // Bind a conversation only to an analysis the caller actually owns. Without
    // this, an authenticated user could pass any analysis UUID and ground their
    // chat in someone else's video (cross-video / cross-user grounding leak, and
    // an IDOR into private analysis content). Respond 404 — not 403 — so we don't
    // confirm the existence of an analysis the caller can't see.
    if (analysisId) {
      const owned = await persistenceAdapter.verifyOwnership({
        analysisId,
        userId: identity.userId,
        select: 'id',
      });
      if (!owned) {
        return NextResponse.json(
          { error: 'Analysis not found', code: 'ERR_ANALYSIS_NOT_FOUND' },
          { status: 404 }
        );
      }
    }

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
