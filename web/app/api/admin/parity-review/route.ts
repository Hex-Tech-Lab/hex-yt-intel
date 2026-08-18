export const dynamic = 'force-dynamic';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
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
 * still absent, respond with `available: false` so the client renders its
 * explicit "no real data" empty state instead of a mock placeholder.
 *
 * KNOWN LIMITATION (Cubic P0 review, 2026-08-18): this reads the JSON off
 * the local filesystem relative to `process.cwd()`. That's fine for local
 * dev, but a real Vercel deployment does not guarantee `docs/` is bundled
 * into the serverless function's filesystem -- a full storage-layer
 * migration (e.g. move the artifact into Supabase Storage or a DB table) is
 * out of scope for this fix. The route now at least fails explicitly rather
 * than silently returning bad/empty data: schema validation below means a
 * malformed or partially-present file surfaces as a real 500 with Sentry
 * capture, not a payload the client renders as if it were a valid batch.
 */
const ParityDimensionPairSchema = z.object({
  haiku_output: z.string().optional(),
  gptoss_output: z.string().optional(),
});

const ParityVideoSchema = z.object({
  video_id: z.string(),
  title: z.string().optional(),
  language: z.string().optional(),
  domain: z.string().optional(),
  dimensions: z.record(z.string(), ParityDimensionPairSchema),
});

const ParityBatchSchema = z.object({
  videos: z.array(ParityVideoSchema),
});

export async function GET(): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/parity-review:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  const filePath = path.join(process.cwd(), '..', 'docs', 'research', '2026-08-18-parity-batch-results.json');

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    const validation = ParityBatchSchema.safeParse(parsed);
    if (!validation.success) {
      Sentry.captureException(new Error('parity-batch-results.json failed schema validation'), {
        tags: { operation: 'admin_parity_review_read' },
        extra: { issues: validation.error.issues },
      });
      return NextResponse.json(
        { error: 'Parity batch file exists but does not match the expected schema' },
        { status: 500 }
      );
    }

    return NextResponse.json({ available: true, data: validation.data });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return NextResponse.json({ available: false, reason: 'not_generated_yet' });
    }
    Sentry.captureException(err, { tags: { operation: 'admin_parity_review_read' } });
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to read parity batch results' }, { status: 500 });
  }
}
