export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyQStashSignature } from '@/lib/qstash-client';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import { UpstashVectorAdapter } from '@/lib/adapters/UpstashVectorAdapter';
import { DeduplicateGraphUseCase } from '@/lib/usecases/DeduplicateGraphUseCase';

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.clone().text();
    const signature = request.headers.get('upstash-signature') || '';
    
    // Verify QStash signature
    const verified = await verifyQStashSignature(signature, bodyText);
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, analysisId } = await request.json();
    if (!tenantId || !analysisId) {
      return NextResponse.json({ error: 'Missing tenantId or analysisId' }, { status: 400 });
    }

    // Dependency Injection
    const persistence = new SupabasePersistenceAdapter();
    const vectorDedup = new UpstashVectorAdapter(
      process.env.UPSTASH_VECTOR_REST_URL!,
      process.env.UPSTASH_VECTOR_REST_TOKEN!
    );
    const useCase = new DeduplicateGraphUseCase(persistence, vectorDedup);

    // Execute use case
    await useCase.execute(tenantId, analysisId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[dream-sequence] Webhook failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
