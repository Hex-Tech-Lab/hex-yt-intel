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
      hasMore = false;
      break;
    }

    const previousMonth = new Date();
    previousMonth.setMonth(previousMonth.getMonth() - 1);

    // Process each user in the batch
    for (const user of users) {
      try {
        const result = await buildMonthlyWiki(user.id, previousMonth);

        if (result.success) {
          successfulWikis++;
        } else if (result.error?.includes('No questions')) {
          skippedWikis++;
        } else {
          failedWikis++;
          errors.push({ userId: user.id, error: result.error || 'Unknown error' });
        }

        totalUsersProcessed++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failedWikis++;
        errors.push({ userId: user.id, error: msg });
        totalUsersProcessed++;

        Sentry.captureException(error, {
          tags: { service: 'wiki-builder-batch' },
          extra: { userId: user.id },
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
