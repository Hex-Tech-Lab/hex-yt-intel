import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { incrementRedisValue, setRedisExpiration } from '@/lib/redis';

// RFC 5321 local-part superset the browser's type="email" already accepts
// (adds the apostrophe etc.) -- kept in sync with the DB CHECK constraint's
// intent, but wider, so real names like o'connor@ don't dead-end silently
// (Ultrareview finding: DB regex was stricter than the browser).
const EMAIL_RE = /^[A-Za-z0-9._%+'!#$&*/=?^`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const MAX_EMAIL_LENGTH = 320;
const WINDOW_SECONDS = 600;
const MAX_PER_WINDOW = 5;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  let body: { email?: unknown; hp?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  // Honeypot: real users never fill this hidden field.
  if (typeof body.hp === 'string' && body.hp.length > 0) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const ip = clientIp(request);
  const rateKey = `waitlist:rl:${ip}`;
  const count = await incrementRedisValue(rateKey);
  if (count === 1) await setRedisExpiration(rateKey, WINDOW_SECONDS);
  if (count > MAX_PER_WINDOW) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    const supabase = getSupabaseServiceClient();
    // Plain insert, not upsert: the unique index is on lower(email) (an
    // expression), which PostgREST's onConflict can't target by column name.
    // Catching 23505 (unique_violation) explicitly and still returning ok:true
    // collapses new-vs-duplicate into one response shape -- no status-code
    // split for a caller to probe (Ultrareview finding: enumeration oracle).
    // source is always 'landing_page' here; only a trusted server path could
    // ever write 'cli_verification'.
    const { error } = await supabase.from('waitlist_signups').insert({ email, source: 'landing_page' });

    if (error && error.code !== '23505') throw error;
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    Sentry.captureException(err, { contexts: { waitlist: { layer: 'signup_insert' } } });
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }
}
