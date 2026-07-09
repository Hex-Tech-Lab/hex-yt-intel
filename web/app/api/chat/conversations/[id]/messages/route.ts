export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import * as Sentry from '@sentry/nextjs';
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
  const { id: conversationId } = await params;
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

    // Step 1: Verify conversation ownership (prevents IDOR via non-existent/foreign conversation)
    const persistenceAdapter = new SupabasePersistenceAdapter();
    const conversation = await persistenceAdapter.verifyChatOwnership({
      conversationId,
      userId,
      select: 'id, analysis_id', // Minimal columns; analysis_id needed for later capture
    });
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found or not owned' }, { status: 404 });
    }

    // Step 2: Process the message using the use case
    const modelAdapter = new SettingsModelAdapter();
    const tokenAdapter = new StreamTokenAdapter();

    // P0 Fix #1: Knowledge history lookup with timeout guard
    // If wiki lookup times out or fails, fall back to empty context
    // This prevents any delays in wiki fetching from blocking chat response
    const stubWikiPort = {
      getUserWiki: (_userId: string) => {
        // Stub implementation: returns empty wiki until actual adapter is integrated
        // Production: replace with real fetch from Supabase user_knowledge_wiki table
        return Promise.resolve([] as any[]);
      },
    };
    const knowledgeService = new KnowledgeHistoryService(stubWikiPort);

    const useCase = new ProcessChatMessageUseCase(
      persistenceAdapter,
      modelAdapter,
      tokenAdapter,
      knowledgeService
    );

    const result = await useCase.execute({
      conversationId,
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

    // Step 3: Trigger background question capture (fire-and-forget, non-blocking)
    // Isolated in a separate async function to ensure it doesn't affect response timing.
    // Failures are logged but don't interrupt the chat response.
    const analysisId = conversation.analysis_id || undefined;
    captureQuestionAsync(conversationId, userId, rawContent, analysisId, request).catch((error) => {
      // Explicitly log capture failures (non-blocking background operation)
      console.warn('[chat] Question capture failed (async, non-blocking):', error);
    });

    return NextResponse.json(result.data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      contexts: {
        chat: {
          conversationId,
          userId,
          action: 'POST /conversations/[id]/messages',
        },
      },
    });
    console.error('[chat POST] Unexpected error:', { msg, conversationId, userId });
    return NextResponse.json({ error: 'Failed to process message' }, { status: 500 });
  }
}

/**
 * Fire-and-forget background task to capture the question for wiki aggregation.
 * Isolated, non-blocking, and guarded to ensure it never interferes with chat response timing.
 *
 * Design:
 * - Called after successful message processing (response already sent to client)
 * - 5s timeout prevents hanging if capture endpoint is slow
 * - All failures are logged at WARN level but never thrown
 * - Uses env.appUrl validation to skip gracefully if not configured (preview environments)
 */
async function captureQuestionAsync(
  conversationId: string,
  userId: string,
  question: string,
  analysisId?: string | null,
  request?: NextRequest
): Promise<void> {
  try {
    // Guard 1: Ensure APP_URL is configured (required for internal fetch)
    if (!env.appUrl) {
      console.warn('[chat] APP_URL not configured, skipping question capture (preview environment)');
      return;
    }

    // Guard 2: Ensure question is non-empty (skip trivial captures)
    if (!question || question.trim().length === 0) {
      console.debug('[chat] Empty question, skipping capture');
      return;
    }

    const captureUrl = `${env.appUrl}/api/chat/capture-question`;

    // Prepare headers: preserve auth context via Cookie forwarding
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (request) {
      const cookie = request.headers.get('cookie');
      if (cookie) {
        headers['Cookie'] = cookie;
      }
    }

    // Execute capture request with strict timeout (5s hard limit)
    const response = await fetch(captureUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversationId,
        userId,
        question,
        analysisId: analysisId || undefined,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(5000), // Hard timeout to prevent hanging
    });

    // Log response status for visibility
    if (!response.ok) {
      console.warn('[chat] Question capture endpoint returned non-2xx:', {
        status: response.status,
        statusText: response.statusText,
      });
      return;
    }

    // Parse response and validate success
    let result: any;
    try {
      result = await response.json();
    } catch (parseError) {
      console.warn('[chat] Question capture response parse failed:', parseError);
      return;
    }

    if (!result.success) {
      console.warn('[chat] Question capture endpoint returned failure:', {
        success: result.success,
        error: result.error,
      });
      return;
    }

    console.debug('[chat] Question captured successfully:', result.questionId);
  } catch (error) {
    // Catch all errors (timeout, network, JSON errors, etc.) and log explicitly
    const msg = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const level = isTimeout ? 'debug' : 'warn'; // Timeout is expected, other errors are worth noting

    if (level === 'debug') {
      console.debug('[chat] Question capture timeout (5s limit exceeded, non-blocking)');
    } else {
      console.warn('[chat] Question capture failed (async, non-blocking):', msg);
    }
    // Never throw — fire-and-forget must never interfere with chat response
  }
}