export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as Sentry from '@sentry/nextjs';
import { requireAdmin } from '@/lib/utils/require-admin';

/**
 * GET /api/admin/parity-review -- serves the Haiku-4.5-vs-GPT-OSS-120B parity
 * test batch for the internal side-by-side review page
 * (web/app/admin/parity-review). Reads directly from the repo-tracked JSON
 * dump at docs/research/2026-08-18-parity-batch-results.json rather than a DB
 * table -- this is a one-off manual-review artifact from a parallel research
 * task, not durable app data.
 *
 * That file did not exist yet when this route was written (2026-08-18); if
 * still absent, respond with `available: false` so the client can render its
 * documented mock-shape placeholder instead of erroring.
 */
export async function GET(): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/parity-review:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const filePath = path.join(process.cwd(), '..', 'docs', 'research', '2026-08-18-parity-batch-results.json');

  try {
    const raw = await readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return NextResponse.json({ available: true, data });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return NextResponse.json({ available: false, reason: 'not_generated_yet' });
    }
    Sentry.captureException(err, { tags: { operation: 'admin_parity_review_read' } });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to read parity batch results' }, { status: 500 });
  }
}
