/**
 * Backfill Tier 3 cochran comment runs for live analyses whose
 * analysis_payload has no `comments` key (THOS 2026-09-30 §2 step 4).
 *
 * Mirrors web/lib/services/aux-remediation.ts enqueueSystemCommentsBackfill
 * (system-triggered, no credit-wallet debit): insert a comment_sample_runs row,
 * sign the comments-tier3 token (same message format as
 * web/lib/stream-token.ts signCommentsTier3Token), POST the worker enqueue
 * endpoint with mode 'cochran' and the registry-resolved sampling config.
 * The worker's S2S callback lands classifications + commentInsights.
 *
 * Scope: non-archived rows (video_id without `_archived_`). Rows with no
 * known commentCount get a pre-flight lookup through the worker's
 * /fetch-metadata route (YouTube Data API videos.list, throttled); with
 * --apply the fetched count is written back to
 * validation_report.metadata.commentCount. Zero-comment videos are skipped
 * (nothing to classify). Idempotent: skips rows that already have a
 * non-failed cochran run.
 *
 * DRY-RUN by default. Env: web/.env.local (`set -a; source web/.env.local; set +a`)
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STREAM_HMAC_SECRET,
 *   CLOUDFLARE_WORKER_URL (or NEXT_PUBLIC_WORKER_URL)
 *
 * Usage:
 *   pnpm dlx tsx scripts/backfill-comments-cochran.ts                     # dry-run
 *   pnpm dlx tsx scripts/backfill-comments-cochran.ts --apply --only=<analysisId>
 *   pnpm dlx tsx scripts/backfill-comments-cochran.ts --apply [--limit=N]
 */

import { validateCochranSamplingConfig } from '../web/lib/config/comments-sampling-config';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const HMAC_SECRET = process.env.STREAM_HMAC_SECRET ?? '';
const WORKER_URL = process.env.CLOUDFLARE_WORKER_URL ?? process.env.NEXT_PUBLIC_WORKER_URL ?? '';
const APP_URL = 'https://getvintel.com';
const TOKEN_TTL_MS = 300_000;
const METADATA_THROTTLE_MS = 500;

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? Infinity);

const REGISTRY_DEFAULTS: Record<string, number> = {
  'comments.sampling.syncPoolMaxPages': 10,
  'comments.sampling.recencyPoolMaxPages': 10,
  'comments.sampling.likeBucketCount': 3,
  'comments.sampling.recencyBucketCount': 3,
  'comments.cochran.zScore': 1.96,
  'comments.cochran.marginOfError': 0.05,
  'comments.cochran.pEstimate': 0.5,
  'comments.jev.minConfidence': 0.5,
  'comments.jev.concurrency': 8,
  'comments.jev.requestTimeoutMs': 15000,
};

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Supabase ${path.split('?')[0]} ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function hmacHex(message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(HMAC_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function resolveSampling() {
  const keys = Object.keys(REGISTRY_DEFAULTS);
  const inList = `in.(${keys.map((k) => `"${k}"`).join(',')})`;
  const defs = await rest<Array<{ key: string; default_value: unknown }>>(`setting_definitions?select=key,default_value&key=${encodeURIComponent(inList)}`);
  const vals = await rest<Array<{ setting_key: string; value: unknown }>>(
    `setting_values?select=setting_key,value&scope_type=eq.system&scope_id=is.null&setting_key=${encodeURIComponent(inList)}`
  );
  const s: Record<string, unknown> = { ...REGISTRY_DEFAULTS };
  for (const d of defs) s[d.key] = d.default_value;
  for (const v of vals) s[v.setting_key] = v.value;
  return validateCochranSamplingConfig({
    syncPoolMaxPages: Number(s['comments.sampling.syncPoolMaxPages']),
    recencyPoolMaxPages: Number(s['comments.sampling.recencyPoolMaxPages']),
    likeBucketCount: Number(s['comments.sampling.likeBucketCount']),
    recencyBucketCount: Number(s['comments.sampling.recencyBucketCount']),
    cochran: {
      zScore: Number(s['comments.cochran.zScore']),
      marginOfError: Number(s['comments.cochran.marginOfError']),
      pEstimate: Number(s['comments.cochran.pEstimate']),
    },
    minConfidence: Number(s['comments.jev.minConfidence']),
    classifierConcurrency: Number(s['comments.jev.concurrency']),
    classifierRequestTimeoutMs: Number(s['comments.jev.requestTimeoutMs']),
  });
}

interface Row {
  id: string;
  user_id: string;
  video_id: string;
  validation_report: { metadata?: { commentCount?: unknown } & Record<string, unknown> } & Record<string, unknown> | null;
}

function knownCount(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Pre-flight: current commentCount from the worker's YouTube metadata route. */
async function fetchCommentCount(videoId: string): Promise<number | null> {
  await new Promise((r) => setTimeout(r, METADATA_THROTTLE_MS));
  const res = await fetch(`${WORKER_URL}/fetch-metadata?video_id=${encodeURIComponent(videoId)}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    console.error(`metadata ${videoId}: worker ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { commentCount?: unknown };
  return knownCount(body.commentCount);
}

async function writeCommentCount(row: Row, count: number): Promise<void> {
  const report = row.validation_report ?? {};
  const next = { ...report, metadata: { ...(report.metadata ?? {}), commentCount: count } };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/analyses?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ validation_report: next }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`validation_report update ${row.id}: ${res.status} ${await res.text()}`);
}

async function main() {
  for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_KEY, HMAC_SECRET, WORKER_URL })) {
    if (!v) throw new Error(`missing env: ${k}`);
  }
  const sampling = await resolveSampling();
  if (!sampling.ok) throw new Error(`invalid sampling config: ${sampling.errors.join('; ')}`);

  let rows = await rest<Row[]>(
    'analyses?select=id,user_id,video_id,validation_report&analysis_payload=not.is.null&analysis_payload->comments=is.null&video_id=not.like.*_archived_*'
  );
  if (only) rows = rows.filter((r) => r.id === only);

  const existing = await rest<Array<{ analysis_id: string }>>('comment_sample_runs?select=analysis_id&mode=eq.cochran&status=neq.failed');
  const done = new Set(existing.map((e) => e.analysis_id));

  let sent = 0;
  for (const row of rows) {
    if (sent >= limit) break;
    if (done.has(row.id)) { console.log(`skip ${row.id} ${row.video_id}: cochran run exists`); continue; }
    let count = knownCount(row.validation_report?.metadata?.commentCount);
    if (count === null) {
      count = await fetchCommentCount(row.video_id);
      if (count === null) { console.log(`skip ${row.id} ${row.video_id}: commentCount lookup failed`); continue; }
      console.log(`fetched commentCount ${row.id} ${row.video_id}: ${count}${apply ? ' (written)' : ''}`);
      if (apply) await writeCommentCount(row, count);
    }
    if (count <= 0) { console.log(`skip ${row.id} ${row.video_id}: zero comments`); continue; }
    if (!apply) { console.log(`would enqueue ${row.id} ${row.video_id} (${count} comments)`); sent++; continue; }

    const [run] = await rest<Array<{ id: string }>>('comment_sample_runs', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        analysis_id: row.id, user_id: row.user_id, tier: 3, total_comment_count: count, requested_percent: 100, status: 'pending',
      }),
    });
    const exp = Date.now() + TOKEN_TTL_MS;
    const sig = await hmacHex(`comments-tier3:${run.id}:${row.user_id}:${exp}`);
    const res = await fetch(`${WORKER_URL}/comments/tier3/enqueue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleRunId: run.id, videoId: row.video_id, userId: row.user_id, totalCommentCount: count,
        appUrl: APP_URL, mode: 'cochran', sampling: sampling.config, sig, exp,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`FAIL ${row.id} ${row.video_id}: worker ${res.status} ${await res.text()}`);
      await rest(`comment_sample_runs?id=eq.${run.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'failed' }) }).catch((e) => console.error(`could not mark run ${run.id} failed`, e));
      continue;
    }
    console.log(`enqueued ${row.id} ${row.video_id} run=${run.id}`);
    sent++;
  }
  console.log(`${apply ? 'enqueued' : 'would enqueue'}: ${sent}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
