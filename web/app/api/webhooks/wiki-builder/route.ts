export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for processing all users

/**
 * QStash Webhook: Monthly Wiki Builder (WAVE 4.2)
 * Triggered on a schedule (0 0 1 * * = first day of month, UTC)
 * Iterates all active users and builds knowledge wikis from captured questions.
 *
 * Signature-verified before processing. Implements pagination to handle
 * large user bases gracefully.
 *
 * Expected invocation:
 * Upstash QStash publishes POST request with no body.
 * Header: upstash-signature (HMAC-SHA256 verification)
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { buildMonthlyWiki, getAllActiveUsers } from '@/lib/skills/wiki-builder/wiki-builder';
import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

interface WebhookResult {
  ok: boolean;
  totalUsersProcessed: number;
  successfulWikis: number;
  failedWikis: number;
  skippedWikis: number;
  totalUsers: number;
  processingTime: number;
  errors: Array<{ userId: string; error: string }>;
}

/**
 * POST /api/webhooks/wiki-builder
 * QStash-triggered monthly wiki aggregation for all users.
 * Returns aggregate statistics about wiki builds.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify QStash signature for security
    const bodyText = await request.clone().text();
    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);

    if (!verified) {
      console.warn('[wiki-builder-webhook] QStash signature verification failed');
      return NextResponse.json(
        { error: 'Unauthorized: Invalid QStash signature' },
        { status: 401 }
      );
    }

    // Build wikis for all users
    const result = await processAllUsers();

    const processingTime = Date.now() - startTime;
    const finalResult: WebhookResult = {
      ...result,
      processingTime,
    };

    console.log('[wiki-builder-webhook] Processing complete', finalResult);

    return NextResponse.json(finalResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const processingTime = Date.now() - startTime;

    Sentry.captureException(error, {
      contexts: {
        api: { endpoint: '/api/webhooks/wiki-builder' },
        webhook: { processingTimeMs: processingTime },
      },
    });

    console.error('[wiki-builder-webhook] Processing failed:', message);

    return NextResponse.json(
      {
        error: message,
        code: 'ERR_WIKI_BUILDER_FAILED',
        processingTime,
      },
      { status: 500 }
    );
  }
}

/**
 * Process all users in batches, building wikis for each.
 * Handles pagination to avoid overwhelming the system.
 */
async function processAllUsers(): Promise<Omit<WebhookResult, 'processingTime'>> {
  const supabase = getSupabaseServiceClient();
  const batchSize = 50;
  let offset = 0;

  let totalUsersProcessed = 0;
  let successfulWikis = 0;
  let failedWikis = 0;
  let skippedWikis = 0;
  const errors: Array<{ userId: string; error: string }> = [];

  // Fetch users in batches
  let hasMore = true;
  while (hasMore) {
    const { users, totalCount } = await getAllActiveUsers(supabase, batchSize, offset);

    if (!users.length) {
      break;
    }

    const previousMonth = new Date();
    previousMonth.setMonth(previousMonth.getMonth() - 1);

    // Process each user in the batch
    // P0 Risk #5 Fix: Webhook error isolation
    // Each user's wiki build is wrapped in try-catch to prevent one failure from blocking others
    for (const user of users) {
      const userId = user.id;
      try {
        if (!userId || typeof userId !== 'string') {
          console.warn('[wiki-builder-webhook] Invalid userId, skipping:', { userId, userType: typeof userId });
          failedWikis++;
          errors.push({ userId: userId || 'unknown', error: 'Invalid userId' });
          totalUsersProcessed++;
          continue;
        }

        const result = await buildMonthlyWiki(userId, previousMonth);

        if (result && result.success) {
          successfulWikis++;
          console.debug('[wiki-builder-webhook] Wiki built successfully', { userId });
        } else if (result?.error?.includes('No questions')) {
          skippedWikis++;
          console.debug('[wiki-builder-webhook] Skipped user (no questions)', { userId });
        } else {
          failedWikis++;
          const errorMsg = result?.error || 'Unknown error';
          errors.push({ userId, error: errorMsg });
          console.warn('[wiki-builder-webhook] Wiki build failed for user', { userId, error: errorMsg });

          // Log to Sentry with user context for triage
          Sentry.captureException(new Error(`Wiki build failed: ${errorMsg}`), {
            tags: { service: 'wiki-builder-batch', phase: 'build' },
            extra: { userId, errorMsg },
            level: 'warning',
          });
        }

        totalUsersProcessed++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        failedWikis++;
        errors.push({ userId, error: msg });
        totalUsersProcessed++;

        // Log to Sentry with full context (userId is critical for RCA)
        Sentry.captureException(error, {
          tags: {
            service: 'wiki-builder-batch',
            phase: 'catch-block',
            status: 'isolated-error',
          },
          extra: {
            userId,
            errorMessage: msg,
            stack,
            processingIndex: totalUsersProcessed,
            batchSize,
          },
          level: 'error',
        });

        // Log explicitly at WARNING level (error isolation means we continue, not fail)
        console.warn('[wiki-builder-webhook] User wiki build failed (isolated, continuing to next user)', {
          userId,
          error: msg,
          continueProcessing: true,
        });
      }
    }

    // Check if there are more users
    if (totalUsersProcessed >= totalCount) {
      hasMore = false;
    } else {
      offset += batchSize;
    }
  }

  return {
    ok: true,
    totalUsersProcessed,
    successfulWikis,
    failedWikis,
    skippedWikis,
    totalUsers: totalUsersProcessed,
    errors: errors.slice(0, 100), // Cap error list to 100 entries for response size
  };
}
