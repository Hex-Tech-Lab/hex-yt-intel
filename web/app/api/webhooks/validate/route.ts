export const dynamic = 'force-dynamic';

/**
 * QStash Webhook Handler: UCIS Validation & Embedding Generation
 * Receives guaranteed background task delivery from Upstash QStash
 * Processes UCIS v5.1 validation reports and prepares embeddings for semantic search
 */

import { NextRequest, NextResponse } from 'next/server';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import { UCISValidator } from '@/lib/ucis-v5-validator';
import { publishEmbeddingTask, verifyQStashSignature, type ValidationPayload } from '@/lib/qstash-client';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb, trackDatabaseQuery } from '@/lib/monitoring/sentry-utils';

export async function POST(request: NextRequest) {
  const startTime = performance.now();

  try {
    console.log('[validate-webhook] Request received');

    // Read cloned body: needed for signature verification without blocking request.json()
    const bodyText = await request.clone().text();

    // Early Return Security: Verify QStash signature BEFORE parsing JSON
    const signature = request.headers.get('upstash-signature') || '';
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      console.warn('[validate-webhook] QStash signature verification failed');
      return NextResponse.json(
        { error: 'Unauthorized: Invalid QStash signature' },
        { status: 401 }
      );
    }
    console.log('[validate-webhook] QStash signature verified');

    // Safely parse the structural payload straight from the verified cloned text string
    let payload: ValidationPayload;
    try {
      payload = JSON.parse(bodyText);
    } catch (err) {
      console.error('[validate-webhook] Malformed JSON payload:', err);
      return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
    }
    const { videoId, markdown, filename, userId, analysisId } = payload;

    console.log('[validate-webhook] Processing validation', {
      videoId,
      analysisId,
      markdownLength: markdown.length,
    });

    // Run UCIS v5.1 validation
    const report = UCISValidator.validate(markdown, filename);
    console.log('[validate-webhook] Validation report', {
      videoId,
      passed: report.passed,
      passedChecks: report.passedChecks,
      totalChecks: report.totalChecks,
      failedCount: report.failedChecks.length,
    });

    addBreadcrumb('UCIS validation executed', {
      videoId,
      passed: report.passed,
      checks: `${report.passedChecks}/${report.totalChecks}`,
    }, 'validation');

    // Save validation report to database via Persistence Adapter
    const persistence = new SupabasePersistenceAdapter();
    await trackDatabaseQuery(
      'update',
      'analyses',
      async () => {
        await persistence.updateValidationReport({
          analysisId,
          report,
          passed: report.passed,
        });
      },
      { analysisId, videoId }
    ).catch((err) => {
      console.warn('[validate-webhook] Failed to save validation report (non-blocking)', {
        analysisId,
        error: String(err),
      });
      addBreadcrumb('Validation report save failed', { analysisId, error: String(err) }, 'database');
    });

    // Log validation result to Sentry
    if (!report.passed) {
      Sentry.captureMessage(
        `UCIS Validation Failed: ${report.failedChecks.length} checks`,
        'warning'
      );
      console.warn('[validate-webhook] Validation checks failed:', report.failedChecks);
    } else {
      Sentry.captureMessage('UCIS Validation Passed', 'info');
    }

    // Trigger embedding generation (next step in pipeline)
    console.log('[validate-webhook] Publishing embedding task');
    await publishEmbeddingTask({
      analysisId,
      markdown,
      userId,
    }).catch((err) => {
      console.error('[validate-webhook] Embedding task publish failed', {
        analysisId,
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err, {
        tags: { service: 'webhook', operation: 'publish_embedding' },
        contexts: { analysis: { analysisId } },
      });
    });

    const duration = Math.round(performance.now() - startTime);
    console.log('[validate-webhook] Validation complete', {
      videoId,
      duration,
      passed: report.passed,
    });

    return NextResponse.json({
      success: true,
      analysisId,
      videoId,
      validationPassed: report.passed,
      checksPassed: report.passedChecks,
      totalChecks: report.totalChecks,
    });
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    const errorMsg = error instanceof Error ? error.message : String(error);

    console.error('[validate-webhook] UNHANDLED ERROR', {
      error: errorMsg,
      duration,
      stack: error instanceof Error ? error.stack : undefined,
    });

    Sentry.captureException(error, {
      tags: { service: 'webhook', operation: 'validate' },
      contexts: { timing: { duration } },
    });

    // Return 503 to signal QStash to retry on unexpected errors
    return NextResponse.json(
      { error: errorMsg, success: false },
      { status: 503 }
    );
  }
}
