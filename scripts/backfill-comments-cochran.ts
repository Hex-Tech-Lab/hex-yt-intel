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
/** A run still 'pending' after this long was never picked up (e.g. the enqueue call died mid-flight). */
const STALE_PENDING_MS = 60 * 60 * 1000;

const [, , ...args] = process.argv;
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

/** Every network call goes through here: timeout via AbortController, timer always cleared. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  }, 15_000);
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
  const settings: Record<string, unknown> = { ...REGISTRY_DEFAULTS };
  for (const def of defs) settings[def.key] = def.default_value;
  for (const val of vals) settings[val.setting_key] = val.value;
  return validateCochranSamplingConfig({
    syncPoolMaxPages: Number(settings['comments.sampling.syncPoolMaxPages']),
    recencyPoolMaxPages: Number(settings['comments.sampling.recencyPoolMaxPages']),
    likeBucketCount: Number(settings['comments.sampling.likeBucketCount']),
    recencyBucketCount: Number(settings['comments.sampling.recencyBucketCount']),
    cochran: {
      zScore: Number(settings['comments.cochran.zScore']),
      marginOfError: Number(settings['comments.cochran.marginOfError']),
      pEstimate: Number(settings['comments.cochran.pEstimate']),
    },
    minConfidence: Number(settings['comments.jev.minConfidence']),
    classifierConcurrency: Number(settings['comments.jev.concurrency']),
    classifierRequestTimeoutMs: Number(settings['comments.jev.requestTimeoutMs']),
  });
}

interface Row {
  id: string;
  user_id: string;
  video_id: string;
  validation_report: { metadata?: { commentCount?: unknown } & Record<string, unknown> } & Record<string, unknown> | null;
}

/** Strict: a non-negative safe integer, or a string that is exactly one ("12junk" is rejected). */
function knownCount(raw: unknown): number | null {
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Pre-flight: current commentCount from the worker's YouTube metadata route. */
async function fetchCommentCount(videoId: string): Promise<number | null> {
  await new Promise((resolve) => setTimeout(resolve, METADATA_THROTTLE_MS));
  const res = await fetchWithTimeout(`${WORKER_URL}/fetch-metadata?video_id=${encodeURIComponent(videoId)}`, {}, 20_000);
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
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/analyses?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ validation_report: next }),
  }, 15_000);
  if (!res.ok) throw new Error(`validation_report update ${row.id}: ${res.status} ${await res.text()}`);
}

type Sampling = Extract<Awaited<ReturnType<typeof resolveSampling>>, { ok: true }>['config'];

async function loadCandidates(): Promise<Row[]> {
  const rows = await rest<Row[]>(
    `analyses?select=id,user_id,video_id,validation_report&analysis_payload=not.is.null&analysis_payload->comments=is.null&video_id=not.like.${encodeURIComponent('*\\_archived\\_*')}`
  );
  return only ? rows.filter((row) => row.id === only) : rows;
}

/**
 * Analyses that already have a live cochran run, scoped to the candidates
 * (batched, so no PostgREST row cap can hide one). A run stuck in 'pending'
 * past STALE_PENDING_MS is marked failed (with --apply) so the row is retried.
 */
async function loadDoneSet(rows: Row[]): Promise<Set<string>> {
  const done = new Set<string>();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const ids = rows.filter((_, index) => index >= offset && index < offset + 100).map((row) => row.id);
    const runs = await rest<Array<{ id: string; analysis_id: string; status: string; created_at: string }>>(
      `comment_sample_runs?select=id,analysis_id,status,created_at&mode=eq.cochran&status=neq.failed&analysis_id=in.(${ids.join(',')})`
    );
    for (const run of runs) {
      const stale = run.status === 'pending' && Date.now() - Date.parse(run.created_at) > STALE_PENDING_MS;
      if (!stale) { done.add(run.analysis_id); continue; }
      console.log(`stale pending run ${run.id} for ${run.analysis_id}${apply ? ': marking failed' : ': would mark failed'}`);
      if (apply) {
        await rest(`comment_sample_runs?id=eq.${run.id}&status=eq.pending`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'failed' }) });
      }
    }
  }
  return done;
}

/** Stored count, else the pre-flight lookup (written back with --apply); null when unknown. */
async function resolveCount(row: Row): Promise<number | null> {
  const stored = knownCount(row.validation_report?.metadata?.commentCount);
  if (stored !== null) return stored;
  const fetched = await fetchCommentCount(row.video_id);
  if (fetched === null) return null;
  console.log(`fetched commentCount ${row.id} ${row.video_id}: ${fetched}${apply ? ' (written)' : ''}`);
  if (apply) await writeCommentCount(row, fetched);
  return fetched;
}

/** Insert the system run, sign, enqueue. A definite worker rejection marks the run failed; an ambiguous error leaves it pending for the stale sweep. */
async function enqueueRow(row: Row, count: number, sampling: Sampling): Promise<boolean> {
  const [run] = await rest<Array<{ id: string }>>('comment_sample_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      analysis_id: row.id, user_id: row.user_id, tier: 3, total_comment_count: count, requested_percent: 100, status: 'pending', mode: 'cochran',
    }),
  });
  const exp = Date.now() + TOKEN_TTL_MS;
  const sig = await hmacHex(`comments-tier3:${run.id}:${row.user_id}:${exp}`);
  const res = await fetchWithTimeout(`${WORKER_URL}/comments/tier3/enqueue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sampleRunId: run.id, videoId: row.video_id, userId: row.user_id, totalCommentCount: count,
      appUrl: APP_URL, mode: 'cochran', sampling, sig, exp,
    }),
  }, 15_000);
  if (res.ok) {
    console.log(`enqueued ${row.id} ${row.video_id} run=${run.id}`);
    return true;
  }
  console.error(`FAIL ${row.id} ${row.video_id}: worker ${res.status} ${await res.text()}`);
  await rest(`comment_sample_runs?id=eq.${run.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'failed' }) })
    .catch((err) => console.error(`could not mark run ${run.id} failed`, err));
  return false;
}

async function main() {
  for (const [name, value] of Object.entries({ SUPABASE_URL, SERVICE_KEY, HMAC_SECRET, WORKER_URL })) {
    if (!value) throw new Error(`missing env: ${name}`);
  }
  const sampling = await resolveSampling();
  if (!sampling.ok) throw new Error(`invalid sampling config: ${sampling.errors.join('; ')}`);
  const rows = await loadCandidates();
  const done = await loadDoneSet(rows);

  let sent = 0;
  for (const row of rows) {
    if (sent >= limit) break;
    if (done.has(row.id)) { console.log(`skip ${row.id} ${row.video_id}: cochran run exists`); continue; }
    const count = await resolveCount(row);
    if (count === null) { console.log(`skip ${row.id} ${row.video_id}: commentCount lookup failed`); continue; }
    if (count <= 0) { console.log(`skip ${row.id} ${row.video_id}: zero comments`); continue; }
    if (!apply) { console.log(`would enqueue ${row.id} ${row.video_id} (${count} comments)`); sent++; continue; }
    if (await enqueueRow(row, count, sampling.config)) sent++;
  }
  console.log(`${apply ? 'enqueued' : 'would enqueue'}: ${sent}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
