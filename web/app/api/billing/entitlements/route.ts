export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { GetUserEntitlementsUseCase } from '@/lib/usecases/GetUserEntitlementsUseCase';
import * as Sentry from '@sentry/nextjs';

export async function GET(_request: NextRequest) {
  try {
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();

    const useCase = new GetUserEntitlementsUseCase();
    
    // If not authenticated, the UseCase returns defaultFree
    const entitlements = await useCase.execute(user?.id || '');

    return NextResponse.json({ success: true, entitlements });
  } catch (error) {
    console.error('[/api/billing/entitlements] Error:', error);
    Sentry.captureException(error);
    const useCase = new GetUserEntitlementsUseCase();
    const fallback = await useCase.execute('');
    return NextResponse.json({ success: true, entitlements: fallback });
  }
}
