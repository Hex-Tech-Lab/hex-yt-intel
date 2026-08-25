import { NextRequest, NextResponse } from 'next/server';
import { ProcessPaddleWebhookUseCase } from '@/lib/usecases/ProcessPaddleWebhookUseCase';
import { PaddleBillingAdapter } from '@/lib/adapters/PaddleBillingAdapter';


export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('paddle-signature');
    const secret = process.env.PADDLE_WEBHOOK_SECRET;

    const adapter = new PaddleBillingAdapter();
    const useCase = new ProcessPaddleWebhookUseCase(adapter);

    const result = await useCase.execute(rawBody, signatureHeader, secret);
    return NextResponse.json({ message: result.message }, { status: result.status });
  } catch (_e) {
    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}
