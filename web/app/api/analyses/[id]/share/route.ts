import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { getSupabaseClient } from '@/lib/supabase';
import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const session = await getServerSession(authConfig);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = (session.user as any).id;

  // Fetch analysis
  const supabase = getSupabaseClient();
  const { data: analysis, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !analysis) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Generate token (48 chars hex from 24 bytes)
  const token = randomBytes(24).toString('hex');

  // Update analysis with share token + expiry (30 days)
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);

  const { error: updateError } = await supabase
    .from('analyses')
    .update({
      shared_token: token,
      shared_expires_at: expiryDate.toISOString(),
    })
    .eq('id', id);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to generate link' }, { status: 500 });
  }

  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const shareUrl = `${baseUrl}/share/${token}`;

  return NextResponse.json({
    shareUrl,
    token,
    expiresAt: expiryDate.toISOString(),
  });
}
