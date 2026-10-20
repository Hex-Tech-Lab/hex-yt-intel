export const dynamic = 'force-dynamic';

/**
 * QStash Webhook Handler: UCIS Validation & Embedding Generation
 * Receives guaranteed background task delivery from Upstash QStash
 * Processes UCIS v5.3 validation reports and prepares embeddings for semantic search
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

    // Run UCIS v5.3 validation
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

    // Save validation report to database via Persistence Adapter.
    // IMPORTANT: this legacy 22-check markdown validator predates the v2.0
    // structured-JSON pipeline and fails all v2 analyses on formatting checks.
    // It must NOT downgrade validation_passed that the persist route already
    // set from the authoritative stitched-payload validation — report only.
    // Stored under its own key and MERGED: replacing the whole report wiped
    // status, dimension_status, metadata and jev_partial_dimensions written
    // by the persist finalize two seconds earlier.
    const persistence = new SupabasePersistenceAdapter();
    await trackDatabaseQuery(
      'update',
      'analyses',
      async () => {
        await persistence.mergeValidationReport({
          analysisId,
          patch: { markdown_validation: report },
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
      // Fail-closed: rethrow so the outer catch answers 503 and QStash
      // redelivers this validate message (the old swallow-and-200 ghost-acked
      // the delivery while the embed task was silently lost). Redelivery is
      // safe: this route's only DB write is mergeValidationReport — an atomic
      // shallow-merge RPC, so replaying the same report merges to the same
      // state — there is no quota or row-creating write here, and the embed
      // webhook dedupes via its presence check + analysisId-keyed upsert.
      console.error('[validate-webhook] Embedding task publish failed — rethrowing for 503/QStash retry', {
        analysisId,
        error: err instanceof Error ? err.message : String(err),
      });
      addBreadcrumb('Embedding task publish failed — failing closed for QStash retry', { analysisId }, 'error');
      throw err;
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
