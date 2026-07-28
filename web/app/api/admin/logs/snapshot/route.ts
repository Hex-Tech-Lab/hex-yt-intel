export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import {
  fetchSynthesisLogs,
  fetchQstashLogs,
  fetchUpstashRedisLogs,
  fetchUpstashVectorLogs,
  fetchVercelLogs,
  fetchSupabaseLogs,
  fetchCloudflareLogs,
} from '@/lib/admin-logs/fetchers';

const SIG_TTL_MS = 60_000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies the `X-Snapshot-Sig` / `X-Snapshot-Exp` headers against
 * LOGS_SNAPSHOT_HMAC_SECRET. Signed message: `logs-snapshot:<exp>`.
 * Separate secret from STREAM_HMAC_SECRET on purpose -- this credential's
 * blast radius (read admin telemetry) is unrelated to the streaming flow's,
 * a leak of one must not unlock the other.
 */
async function verifySnapshotHmac(request: NextRequest): Promise<boolean> {
  const secret = process.env.LOGS_SNAPSHOT_HMAC_SECRET;
  if (!secret) return false;
  const sig = request.headers.get('x-snapshot-sig');
  const expHeader = request.headers.get('x-snapshot-exp');
  if (!sig || !expHeader) return false;
  const exp = Number(expHeader);
  if (!Number.isFinite(exp) || Date.now() > exp || exp > Date.now() + SIG_TTL_MS) return false;
  const expected = await hmacHex(secret, `logs-snapshot:${exp}`);
  return timingSafeEqualHex(expected, sig);
}

/**
 * GET /api/admin/logs/snapshot — single-call aggregate of every admin log
 * provider (synthesis, QStash, Upstash Redis/Vector, Vercel, Supabase,
 * Cloudflare), fanned out in-process via Promise.all against the same
 * fetch/format functions the individual /api/admin/logs/<provider> routes
 * use (web/lib/admin-logs/fetchers.ts) -- no duplicated logic, no 8 separate
 * external round-trips from the caller.
 *
 * Auth: admin session (browser) OR a signed HMAC header pair
 * (X-Snapshot-Sig / X-Snapshot-Exp, see verifySnapshotHmac) for
 * machine-to-machine polling without a browser session.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const hmacOk = await verifySnapshotHmac(request);
  if (!hmacOk) {
    const adminResult = await requireAdmin('admin/logs/snapshot:GET');
    if (!adminResult.ok) {
      return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
    }
  }

  const { searchParams } = new URL(request.url);

  const [synthesis, qstash, upstashRedis, upstashVector, vercel, supabase, cloudflare] = await Promise.all([
    fetchSynthesisLogs(searchParams),
    fetchQstashLogs(searchParams),
    fetchUpstashRedisLogs(searchParams),
    fetchUpstashVectorLogs(searchParams),
    fetchVercelLogs(searchParams),
    fetchSupabaseLogs(searchParams),
    fetchCloudflareLogs(searchParams),
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    synthesis: synthesis.body,
    qstash: qstash.body,
    upstashRedis: upstashRedis.body,
    upstashVector: upstashVector.body,
    vercel: vercel.body,
    supabase: supabase.body,
    cloudflare: cloudflare.body,
  });
}
