export const dynamic = 'force-dynamic';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { DubShortLinkAdapter } from '@/lib/adapters/DubShortLinkAdapter';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = user.id;

  // Fetch analysis
  const { data: analysis, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !analysis) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Generate token (48 chars hex from 24 bytes)
  const token = randomBytes(24).toString('hex');

  // Update analysis with share token + expiry (30 days)
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);

  const { error: updateError, count } = await supabase
    .from('analyses')
    .update({
      shared_token: token,
      shared_expires_at: expiryDate.toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to generate link' }, { status: 500 });
  }

  if (!count) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const shareUrl = `${baseUrl}/share/${token}`;

  // Dub.co short link wrapping the public share URL (task #11, highlights-reel
  // share spec). Best-effort: a Dub outage must not block sharing -- the raw
  // shareUrl still works on its own, it's just longer/untracked.
  let shortUrl: string | null = null;
  try {
    const shortLinkAdapter = new DubShortLinkAdapter();
    const link = await shortLinkAdapter.createLink({ url: shareUrl, tenantId: userId });
    shortUrl = link.shortLink;
  } catch (err) {
    console.error('[analyses/share] Dub short-link creation failed, falling back to raw shareUrl:', err instanceof Error ? err.message : String(err));
    Sentry.captureException(err, { tags: { route: 'analyses/[id]/share', layer: 'dub-shortlink' }, extra: { analysisId: id } });
  }

  return NextResponse.json({
    shareUrl,
    shortUrl,
    token,
    expiresAt: expiryDate.toISOString(),
  });
}
