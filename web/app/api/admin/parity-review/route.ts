export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { requireAdmin } from '@/lib/utils/require-admin';

/**
 * GET /api/admin/parity-review -- serves the Haiku-4.5-vs-GPT-OSS-120B parity
 * test batch for the internal side-by-side review page
 * (web/app/admin/parity-review). Reads the JSON dump from the private
 * companion checkout (docs/private/research/, git-ignored since 2026-10-11),
 * falling back to the legacy docs/research/ location, rather than a DB
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

const PARITY_FILE = '2026-08-18-parity-batch-results.json';
const PARITY_FILE_CANDIDATES: [string, ...string[]] = [
  path.join(process.cwd(), '..', 'docs', 'private', 'research', PARITY_FILE),
  path.join(process.cwd(), '..', 'docs', 'research', PARITY_FILE),
];

function isErrnoCode(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

/** Thrown when no candidate exists; carries every path that was tried. */
class ParityFileMissingError extends Error {
  readonly code = 'ENOENT';
  constructor(readonly tried: string[]) {
    super(`parity batch file not found in: ${tried.join(', ')}`);
  }
}

/**
 * Returns the first candidate that exists. A fallback past the first
 * (private) path is reported to Sentry, so a stale legacy copy is never
 * served silently. Non-ENOENT read errors propagate unchanged.
 */
async function readFirstExisting(candidates: [string, ...string[]]): Promise<string> {
  for (const [index, candidate] of candidates.entries()) {
    try {
      const raw = await readFile(candidate, 'utf-8');
      if (index > 0) {
        Sentry.captureMessage('admin parity-review served a fallback copy', {
          level: 'warning',
          tags: { operation: 'admin_parity_review_read' },
          extra: { served: candidate, missing: candidates.filter((_, i) => i < index) },
        });
      }
      return raw;
    } catch (err) {
      // ENOENT is the expected "not here" signal: try the next candidate.
      if (!isErrnoCode(err, 'ENOENT')) throw err;
      Sentry.addBreadcrumb({ category: 'admin_parity_review', message: `parity file absent: ${candidate}` });
    }
  }
  throw new ParityFileMissingError(candidates);
}

export async function GET(): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/parity-review:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }

  try {
    const raw = await readFirstExisting(PARITY_FILE_CANDIDATES);
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
    if (err instanceof ParityFileMissingError) {
      // Expected on deployments without the git-ignored private checkout;
      // logged so a missing file is distinguishable from a never-generated one.
      console.warn('[admin/parity-review] parity batch file missing', { tried: err.tried });
      return NextResponse.json({ available: false, reason: 'not_generated_yet' });
    }
    Sentry.captureException(err, { tags: { operation: 'admin_parity_review_read' } });
    // Fixed message: the raw error can contain absolute server paths.
    return NextResponse.json({ error: 'Failed to read parity batch results' }, { status: 500 });
  }
}
