export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  SupabaseAuthAdapter,
  SupabasePersistenceAdapter,
  StreamTokenAdapter,
  SettingsModelAdapter,
} from '@/lib/adapters';
import { ProcessChatMessageUseCase } from '@/lib/usecases/ProcessChatMessageUseCase';
import { KnowledgeHistoryService } from '@/lib/services/KnowledgeHistoryService';
import { env } from '@/lib/env';

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
    const body: unknown = await request.json().catch(() => ({}));
    const payloadSchema = z.object({
      content: z.string().default(''),
      clientMsgId: z.string().nullable().optional().default(null)
    });

    const parsed = payloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const { content: rawContent, clientMsgId } = parsed.data;

    const persistenceAdapter = new SupabasePersistenceAdapter();
    const modelAdapter = new SettingsModelAdapter();
    const tokenAdapter = new StreamTokenAdapter();

    // Stub KnowledgeWikiPort for Wave 4.1 (full wiki grounding added in Wave 4.2+)
    const stubWikiPort = {
      getUserWiki: async () => [] as any[],
    };
    const knowledgeService = new KnowledgeHistoryService(stubWikiPort);

    const useCase = new ProcessChatMessageUseCase(
      persistenceAdapter,
      modelAdapter,
      tokenAdapter,
      knowledgeService
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

    // Fire-and-forget: capture the question for wiki aggregation
    // This happens after validation but doesn't block the response
    const conv = await persistenceAdapter.getConversation({ conversationId: id });
    const analysisId = conv?.analysisId;
    captureQuestionAsync(id, userId, rawContent, analysisId).catch((error) => {
      console.error('[chat] Question capture failed (non-blocking):', error);
    });

    return NextResponse.json(result.data);
  } catch (error) {
    console.error('[chat POST] Exception:', error);
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}

/**
 * Fire-and-forget helper to capture the question for wiki aggregation.
 * Does not block the response; failures are logged but swallowed.
 * Follows the fire-and-forget pattern: called after the main response is ready.
 */
async function captureQuestionAsync(
  conversationId: string,
  userId: string,
  question: string,
  analysisId?: string | null
): Promise<void> {
  try {
    // Use the capture-question endpoint if available (prefer this)
    // Otherwise, silently skip (graceful fallback)
    if (!env.appUrl) {
      console.debug('[chat] APP_URL not configured, skipping question capture');
      return;
    }

    const captureUrl = `${env.appUrl}/api/chat/capture-question`;

    const response = await fetch(captureUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversationId,
        userId,
        question,
        analysisId: analysisId || undefined,
        timestamp: new Date().toISOString(),
      }),
      // Use a short timeout so question capture doesn't slow down the response
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      console.warn('[chat] Question capture returned non-2xx:', response.status);
      return;
    }

    const result = await response.json();
    if (!result.success) {
      console.warn('[chat] Question capture failed:', result);
      return;
    }

    console.debug('[chat] Question captured successfully:', result.questionId);
  } catch (error) {
    // Swallow all errors; this is a non-critical background operation
    const msg = error instanceof Error ? error.message : String(error);
    console.debug('[chat] Question capture error (non-blocking):', msg);
  }
}