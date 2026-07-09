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

  // Step 1: Authenticate user
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: unknown = await req.json().catch(() => ({}));

    // Step 2: Validate request payload
    const parsed = QuestionCaptureRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid payload', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { conversationId, userId, question, analysisId, timestamp } = parsed.data;

    // Step 3: Verify user ID matches authenticated identity (double-check against token)
    if (userId !== identity.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Step 4: Verify conversation ownership (prevents IDOR via non-existent/foreign conversation)
    const persistenceAdapter = new SupabasePersistenceAdapter();
    const conversation = await persistenceAdapter.verifyChatOwnership({
      conversationId,
      userId: identity.userId,
      select: 'id', // Minimal columns needed
    });
    if (!conversation) {
      return NextResponse.json(
        { error: 'Forbidden: conversation not found or not owned' },
        { status: 403 }
      );
    }

    // Step 5: Generate question ID and timestamp
    const questionId = randomUUID();
    const now = new Date().toISOString();
    const storedAt = timestamp || now;

    // Step 6: Prepare metadata for storage
    const metadata: QuestionStorageMetadata = {
      conversationId,
      userId,
      analysisId,
      timestamp: storedAt,
      question,
    };

    // Step 7: Store question in Supabase Storage (fire-and-forget, non-blocking)
    // Failures are logged explicitly but don't interrupt the response
    captureQuestionToStorage(metadata, questionId).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      Sentry.captureException(error, {
        tags: { operation: 'question-capture-storage', phase: 'async-write' },
        contexts: { request: { questionId, userId, conversationId } },
      });
      // Log explicitly — this failure does NOT affect the chat response
      console.warn('[question-capture] Async storage failed (non-blocking):', msg);
    });

    // Step 8: Build and validate response
    const response: QuestionCaptureResponseOutput = {
      success: true,
      questionId,
      stored_at: storedAt,
    };

    const validatedResponse = QuestionCaptureResponseSchema.safeParse(response);
    if (!validatedResponse.success) {
      const err = validatedResponse.error;
      console.error('[question-capture] Response validation failed:', err.flatten());
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json(validatedResponse.data, { status: 200 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { operation: 'question-capture', phase: 'request-handler' },
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
 * Fire-and-forget pattern: errors are logged but don't propagate to the caller.
 *
 * File path: /raw/{userId}/questions/{ISO_TIMESTAMP}_{questionId}.md
 * Idempotency: upsert: false prevents overwrites; duplicate filenames are treated as success.
 */
async function captureQuestionToStorage(
  metadata: QuestionStorageMetadata,
  questionId: string
): Promise<void> {
  let filePath = '';
  try {
    const supabaseClient = getSupabaseServiceClient();

    // Sanitize userId to prevent path traversal (remove ../, ..\, etc.)
    const sanitizedUserId = metadata.userId.replace(/\.\.\//g, '').replace(/\.\.\\/g, '').replace(/[<>:"|?*]/g, '');

    // Construct file path with safe timestamp (ISO format → filename-safe)
    const isoTimestamp = metadata.timestamp.replace(/[:.]/g, '-').split('Z')[0];
    const fileName = `${isoTimestamp}_${questionId}.md`;
    filePath = `raw/${sanitizedUserId}/questions/${fileName}`;

    // Build markdown content (YAML front matter + question)
    const content = buildQuestionMarkdown(metadata, questionId);

    // Upload to Supabase Storage bucket
    const { error } = await supabaseClient.storage
      .from('analyses')
      .upload(filePath, content, {
        contentType: 'text/markdown; charset=utf-8',
        upsert: false, // Idempotency guard: fail if file already exists
      });

    // Handle upload errors
    if (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const isDuplicate = errorMsg.includes('already exists') || errorMsg.includes('Duplicate');
      if (isDuplicate) {
        // Treat duplicate as idempotent success
        console.debug('[question-capture] File already exists (idempotent)');
        return;
      }
      // Other errors (permission, storage full, etc.) are critical
      throw error;
    }

    console.debug('[question-capture] Question stored successfully');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Don't include filePath in error message (information disclosure prevention)
    const context = 'Failed to store question in Supabase Storage';
    throw new Error(`[question-capture] ${context}: ${msg}`);
  }
}

/**
 * Build markdown content for question storage.
 * Format: YAML front matter + content.
 *
 * P0 Security Fix: YAML injection prevention
 * - Quotes and escapes all YAML values to prevent injection via newlines/special chars
 * - Question content is stored as raw markdown (not in front matter)
 */
function buildQuestionMarkdown(metadata: QuestionStorageMetadata, questionId: string): string {
  // Helper: escape YAML string values (quote and escape internal quotes)
  const escapeYamlValue = (value: string | null | undefined): string => {
    if (!value) return 'null';
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  };

  const frontMatter = `---
questionId: ${escapeYamlValue(questionId)}
conversationId: ${escapeYamlValue(metadata.conversationId)}
userId: ${escapeYamlValue(metadata.userId)}
analysisId: ${escapeYamlValue(metadata.analysisId)}
timestamp: ${escapeYamlValue(metadata.timestamp)}
---

# User Question

${metadata.question}
`;

  return frontMatter;
}
