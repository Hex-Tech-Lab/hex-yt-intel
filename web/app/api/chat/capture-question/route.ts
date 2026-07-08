export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/nextjs';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';
import { getSupabaseServiceClient } from '@/lib/supabase';
import {
  QuestionCaptureRequestSchema,
  QuestionCaptureResponseSchema,
  type QuestionCaptureResponseOutput,
  type QuestionStorageMetadata,
} from '@/lib/types/question-capture';

/**
 * POST /api/chat/capture-question
 * Captures user questions for wiki aggregation and knowledge loop.
 * Stores questions in Supabase Storage at `/raw/{userId}/questions/{ISO_TIMESTAMP}_{questionId}.md`
 *
 * Expected JSON body:
 * {
 *   "conversationId": string,
 *   "userId": string,
 *   "question": string,
 *   "analysisId"?: string,
 *   "timestamp"?: ISO8601 string
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "questionId": string,
 *   "stored_at": ISO8601 string
 * }
 */
export async function POST(req: NextRequest) {
  const authAdapter = new SupabaseAuthAdapter();

  // Authenticate user
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: unknown = await req.json().catch(() => ({}));

    // Validate request payload
    const parsed = QuestionCaptureRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { conversationId, userId, question, analysisId, timestamp } = parsed.data;

    // Verify user ownership (route-level security check)
    if (userId !== identity.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify that the conversation belongs to the user
    const persistenceAdapter = new SupabasePersistenceAdapter();
    const conversation = await persistenceAdapter.getConversation({ conversationId });
    if (!conversation || conversation.userId !== identity.userId) {
      return NextResponse.json({ error: 'Forbidden: conversation not found or not owned' }, { status: 403 });
    }

    // Generate question ID and timestamp
    const questionId = randomUUID();
    const now = new Date().toISOString();
    const storedAt = timestamp || now;

    // Prepare metadata
    const metadata: QuestionStorageMetadata = {
      conversationId,
      userId,
      analysisId,
      timestamp: storedAt,
      question,
    };

    // Store question in Supabase Storage (fire-and-forget pattern)
    // If storage fails, log but don't fail the chat request
    captureQuestionToStorage(metadata, questionId).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      Sentry.captureException(error, {
        tags: { operation: 'question-capture-storage' },
        contexts: {
          request: { questionId, userId, conversationId }
        },
      });
      console.error('[question-capture] Storage write failed:', msg);
      // Silently fail — don't interrupt chat flow
    });

    // Build response
    const response: QuestionCaptureResponseOutput = {
      success: true,
      questionId,
      stored_at: storedAt,
    };

    // Validate response before returning
    const validatedResponse = QuestionCaptureResponseSchema.safeParse(response);
    if (!validatedResponse.success) {
      console.error('[question-capture] Response validation failed:', validatedResponse.error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json(validatedResponse.data, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { operation: 'question-capture' },
      contexts: { api: { endpoint: '/api/chat/capture-question' } },
    });
    console.error('[question-capture] Unexpected error:', msg);
    return NextResponse.json(
      { error: 'Failed to capture question' },
      { status: 500 }
    );
  } finally {
    if (typeof Sentry.flush === 'function') {
      void Sentry.flush(2000);
    }
  }
}

/**
 * Store question metadata in Supabase Storage as markdown file.
 * File path: /raw/{userId}/questions/{ISO_TIMESTAMP}_{questionId}.md
 *
 * Fire-and-forget: errors are logged but don't propagate to the caller.
 */
async function captureQuestionToStorage(
  metadata: QuestionStorageMetadata,
  questionId: string
): Promise<void> {
  try {
    const supabaseClient = getSupabaseServiceClient();

    // Construct file path
    const isoTimestamp = metadata.timestamp.replace(/[:.]/g, '-').split('Z')[0]; // Safe for filenames
    const fileName = `${isoTimestamp}_${questionId}.md`;
    const filePath = `raw/${metadata.userId}/questions/${fileName}`;

    // Build markdown content
    const content = buildQuestionMarkdown(metadata, questionId);

    // Upload to storage
    const { error } = await supabaseClient.storage
      .from('analyses')
      .upload(filePath, content, {
        contentType: 'text/markdown; charset=utf-8',
        upsert: false, // Fail if file already exists (idempotency guard)
      });

    if (error) {
      // If file exists (idempotency), silently succeed; other errors propagate
      if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
        console.debug('[question-capture] File already exists (idempotent):', filePath);
        return;
      }
      throw error;
    }

    console.debug('[question-capture] Question stored:', filePath);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to store question in Supabase Storage: ${msg}`);
  }
}

/**
 * Build markdown content for question storage.
 * Format: YAML front matter + content.
 */
function buildQuestionMarkdown(metadata: QuestionStorageMetadata, questionId: string): string {
  const frontMatter = `---
questionId: ${questionId}
conversationId: ${metadata.conversationId}
userId: ${metadata.userId}
analysisId: ${metadata.analysisId || 'null'}
timestamp: ${metadata.timestamp}
---

# User Question

${metadata.question}
`;

  return frontMatter;
}
