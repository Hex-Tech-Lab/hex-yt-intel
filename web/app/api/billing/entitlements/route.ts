export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { GetUserEntitlementsUseCase } from '@/lib/usecases/GetUserEntitlementsUseCase';

export async function GET(_request: NextRequest) {
  try {
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const useCase = new GetUserEntitlementsUseCase();
    const entitlements = await useCase.execute(user.id, user.email ?? null);

    return NextResponse.json({ success: true, entitlements });
  } catch (error) {
    const isAuthError = error instanceof Error && error.message.toLowerCase().includes('auth');
    if (isAuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[/api/billing/entitlements] Error:', error);
    Sentry.captureException(error);
    // Return 503 so clients do not cache an outage as a Free entitlement.
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
}
