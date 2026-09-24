import { NextRequest, NextResponse } from 'next/server';
import { ProcessPaddleWebhookUseCase } from '@/lib/usecases/ProcessPaddleWebhookUseCase';
import { PaddleBillingAdapter } from '@/lib/adapters/PaddleBillingAdapter';

/**
 * LEGACY PADDLE WEBHOOK URL — THIN DELEGATE (PR #325 round 4)
 * ---------------------
 * It is UNKNOWN which webhook URL is actually registered in the Paddle
 * dashboard, so this legacy URL is RETAINED but no longer carries its own
 * handler logic: it runs the exact same signature verification +
 * ProcessPaddleWebhookUseCase path (including the per-event-id Redis
 * idempotency lock) as the canonical /api/webhooks/paddle route — one
 * implementation, two URLs.
 *
 * ACTION REQUIRED: confirm the registered webhook URL in the Paddle
 * dashboard. Once confirmed, remove whichever of the two routes is NOT
 * registered there.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signatureHeader = request.headers.get('paddle-signature');
    const secret = process.env.PADDLE_WEBHOOK_SECRET;

    const adapter = new PaddleBillingAdapter();
    const useCase = new ProcessPaddleWebhookUseCase(adapter);

    const result = await useCase.execute(rawBody, signatureHeader, secret);
    return NextResponse.json({ message: result.message }, { status: result.status });
  } catch (routeError: unknown) {
    console.error('[/api/billing/webhook] Error:', routeError);
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
