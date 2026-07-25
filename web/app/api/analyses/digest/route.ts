export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SupabaseAuthAdapter, SupabasePersistenceAdapter } from '@/lib/adapters';
import { OpenRouterCompletionAdapter } from '@/lib/adapters/OpenRouterCompletionAdapter';
import { GenerateExecutiveDigestUseCase } from '@/lib/usecases/GenerateExecutiveDigestUseCase';
import { resolveChatCascade } from '@/lib/config/cascade';

/**
 * POST /api/analyses/digest — generate (once) the Dimension-0 executive digest
 * for an owned analysis. Idempotent: returns the stored digest without a second
 * model call if one already exists. Intended to be fired client-side when an
 * analysis settles to done.
 */
export async function POST(request: NextRequest) {
  const authAdapter = new SupabaseAuthAdapter();
  const identity = await authAdapter.authenticate();
  if (!identity) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = z.object({ analysisId: z.string().uuid() }).safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const useCase = new GenerateExecutiveDigestUseCase(
      new SupabasePersistenceAdapter(),
      new OpenRouterCompletionAdapter()
    );

    const result = await useCase.execute({
      analysisId: parsed.data.analysisId,
      userId: identity.userId,
      models: await resolveChatCascade(),
    });

    if (result.type === 'error') {
      return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
    }

    return NextResponse.json({ digest: result.digest, cached: result.cached });
  } catch (error) {
    console.error('[analyses/digest] Exception:', error);
    return NextResponse.json({ error: 'Failed to generate digest' }, { status: 500 });
  }
}
