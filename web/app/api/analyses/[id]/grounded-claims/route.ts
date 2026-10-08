export const dynamic = 'force-dynamic';

/**
 * Phase C shadow mode (2026-10-08): worker -> Vercel write of the Epistemic
 * pipeline's grounded claims for one analysis. Authenticated only by a bound
 * S2S signature (purpose 'epistemic-claims', bound to the analysis id and an
 * expiry) over canonicalJson({ analysisId, groundedClaims, degradedSensors }) --
 * the same layout worker/src/services/EpistemicShadowRunner.ts signs.
 */
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { env } from '@/lib/env';
import { verifyEpistemicClaims } from '@/lib/config/epistemic-shadow';
import { canonicalJson } from '@/lib/utils/canonical-json';
import { GroundedExtractionPayloadSchema } from '@/lib/types/contracts';
import { SupabaseEpistemicAdapter } from '@/lib/adapters/SupabaseEpistemicAdapter';
import { ERROR_PHASES } from '@/lib/error-codes';
import { categorizeError, createErrorResponse } from '@/lib/services/error-handler';

// groundedClaims stays opaque here: the signature covers the bytes the worker
// sent, so it is verified first and the shared contract is enforced after.
const PersistBodySchema = z.object({
  analysisId: z.string().min(1),
  groundedClaims: z.unknown(),
  degradedSensors: z.boolean(),
  exp: z.number().finite(),
  contentSig: z.string().min(1),
});

/** Worker -> Vercel persist of one analysis's grounded claims (signed S2S). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch (error: unknown) {
    const err = categorizeError(error, ERROR_PHASES.JSON_PARSE);
    console.error('[grounded-claims] Malformed request body', { message: err.message, analysisId: id });
    return NextResponse.json(createErrorResponse(err), { status: err.statusCode });
  }

  const parsed = PersistBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 });
  }
  const { analysisId, groundedClaims, degradedSensors, exp, contentSig } = parsed.data;
  if (analysisId !== id) {
    return NextResponse.json({ error: 'Analysis id mismatch' }, { status: 400 });
  }

  const canonical = canonicalJson({ analysisId, groundedClaims, degradedSensors });
  const isSigValid = await verifyEpistemicClaims({ secret: env.streamHmacSecret, analysisId, exp, content: canonical, sig: contentSig });
  if (!isSigValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const contract = GroundedExtractionPayloadSchema.safeParse(groundedClaims);
  if (!contract.success) {
    return NextResponse.json({ error: 'Invalid grounded claims', details: contract.error.flatten() }, { status: 422 });
  }

  try {
    const { updated } = await SupabaseEpistemicAdapter.persistGroundedClaims({
      analysisId,
      groundedClaims: contract.data,
      unknowns: contract.data.unknowns,
      degradedSensors,
    });
    if (!updated) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    Sentry.captureException(error, { tags: { operation: 'grounded-claims-persist' }, extra: { analysisId } });
    console.error('[grounded-claims] persist failed', { analysisId, error });
    return NextResponse.json({ error: 'Persist failed' }, { status: 500 });
  }
}
