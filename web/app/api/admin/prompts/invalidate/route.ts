export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceClient, getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabasePromptAdapter } from '@/lib/adapters/SupabasePromptAdapter';
import * as Sentry from '@sentry/nextjs';

const BodySchema = z.object({
  key: z.string().min(1),
});

/**
 * Admin-only: drop a prompt's Redis cache entry (SupabasePromptAdapter's
 * `prompt:<key>` key, 24h TTL) so the next read picks up a freshly-edited
 * Vault secret immediately instead of serving the stale cached value for up
 * to 24h. This is the write-path gap flagged in the roster ("Settings admin
 * write-path UI is unexercised") -- there is still no UI to edit the Vault
 * secret itself (that remains a direct SQL operation), this endpoint only
 * closes the cache-invalidation half so an edit actually takes effect.
 */
export async function POST(request: NextRequest): Promise<NextResponse<{ ok: true; key: string } | { error: string }>> {
  try {
    const authClient = await getSupabaseClientWithAuth();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseServiceClient();
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (userError) {
      Sentry.captureException(userError, {
        tags: { operation: 'admin_role_check', route: 'prompts/invalidate' },
        contexts: { admin: { userId: user.id, operation: 'role_check' } },
      });
      return NextResponse.json({ error: 'Failed to verify admin status' }, { status: 500 });
    }
    if (!userData || userData.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid body: expected { key: string }' }, { status: 400 });
    }

    await SupabasePromptAdapter.invalidate(parsed.data.key);
    return NextResponse.json({ ok: true, key: parsed.data.key });
  } catch (error) {
    Sentry.captureException(error, { tags: { operation: 'prompts_invalidate' } });
    return NextResponse.json({ error: 'Invalidation failed' }, { status: 500 });
  }
}
