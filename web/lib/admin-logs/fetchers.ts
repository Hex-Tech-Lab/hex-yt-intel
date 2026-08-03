import { getSupabaseServiceClient } from '@/lib/supabase';
import { computeTimeWindow } from '@/lib/utils/time-range';
import * as Sentry from '@sentry/nextjs';

/**
 * Shared fetch/format logic for every admin log provider. Extracted so the
 * individual /api/admin/logs/<provider> routes and the aggregate
 * /api/admin/logs/snapshot route call the exact same code -- no duplicated,
 * driftable copies of the same upstream-fetch logic. Each function owns
 * only the fetch + format step; auth (requireAdmin / snapshot HMAC) stays
 * the caller's responsibility.
 */
export interface FetcherResult {
  status: number;
  body: Record<string, unknown>;
}

function parseRange(searchParams: URLSearchParams): { startTimeIso: string; endTimeIso: string; range: string } {
  const range = searchParams.get('range') || '1h';
  const customStart = searchParams.get('start');
  const customEnd = searchParams.get('end');
  const now = new Date();

  let startTimeIso: string;
  if (range === '30m') {
    startTimeIso = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  } else if (range === '1h') {
    startTimeIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  } else if (range === 'today') {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    startTimeIso = todayStart.toISOString();
  } else if (range === 'custom' && customStart) {
    startTimeIso = new Date(customStart).toISOString();
  } else {
    startTimeIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  }
  const endTimeIso = range === 'custom' && customEnd ? new Date(customEnd).toISOString() : now.toISOString();
  return { startTimeIso, endTimeIso, range };
}

export async function fetchSynthesisLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const { startTimeIso, endTimeIso, range } = parseRange(searchParams);
  try {
    const service = getSupabaseServiceClient();

    const { data: analyses, error: analysesError } = await service
      .from('analyses')
      .select('id, video_id, title, billing_status, model_used, validation_passed, created_at, updated_at')
      .gte('updated_at', startTimeIso)
      .lte('updated_at', endTimeIso)
      .order('updated_at', { ascending: true })
      .limit(200);
    if (analysesError) throw analysesError;

    const { data: sampleRuns } = await service
      .from('comment_sample_runs')
      .select('id, analysis_id, tier, total_comment_count, sampled_count, status, created_at, completed_at')
      .gte('created_at', startTimeIso)
      .lte('created_at', endTimeIso)
      .order('created_at', { ascending: true })
      .limit(100);

    const logLines: string[] = [];
    (analyses || []).forEach((row) => {
      const statusTag = (row.billing_status || 'unknown').toUpperCase();
      const level = row.billing_status === 'failed' ? 'ERROR' : row.billing_status === 'processing' ? 'WARN' : 'INFO';
      logLines.push(`[${row.updated_at}] [${level}] [synthesis:${statusTag}] analysisId=${row.id} videoId=${row.video_id} model=${row.model_used || 'edge-stream'} valid=${row.validation_passed} title="${row.title}"`);
    });
    (sampleRuns || []).forEach((run) => {
      const statusTag = (run.status || 'unknown').toUpperCase();
      const level = run.status === 'failed' ? 'ERROR' : 'INFO';
      logLines.push(`[${run.created_at}] [${level}] [comment-sample-run:${statusTag}] runId=${run.id} analysisId=${run.analysis_id} tier=${run.tier} totalCount=${run.total_comment_count} sampledCount=${run.sampled_count || 0}`);
    });
    logLines.sort((a, b) => a.localeCompare(b));

    const content = logLines.length > 0
      ? logLines.join('\n')
      : `[${new Date().toISOString()}] [INFO] No synthesis activity recorded between ${startTimeIso} and ${endTimeIso}.`;

    return { status: 200, body: { range, startTime: startTimeIso, endTime: endTimeIso, totalEntries: logLines.length, logs: content } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_synthesis_logs' } });
    return { status: 500, body: { error: `Failed to fetch synthesis logs: ${message}` } };
  }
}

export async function fetchQstashLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    return { status: 503, body: { error: 'QSTASH_TOKEN is not configured in environment variables.' } };
  }
  const range = searchParams.get('range') || '1h';
  const customStart = searchParams.get('start');
  const customEnd = searchParams.get('end');
  const now = Date.now();
  let startTimeMs: number;
  if (range === '30m') startTimeMs = now - 30 * 60 * 1000;
  else if (range === '1h') startTimeMs = now - 60 * 60 * 1000;
  else if (range === 'today') { const t = new Date(); t.setHours(0, 0, 0, 0); startTimeMs = t.getTime(); }
  else if (range === 'custom' && customStart) startTimeMs = new Date(customStart).getTime();
  else startTimeMs = now - 60 * 60 * 1000;
  const endTimeMs = range === 'custom' && customEnd ? new Date(customEnd).getTime() : now;

  try {
    const res = await fetch('https://qstash.upstash.io/v2/events', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upstash QStash API returned ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const rawEvents = Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : [];
    const events = rawEvents.filter((evt: any) => {
      const timeMs = typeof evt.time === 'number' ? evt.time : new Date(evt.time || evt.createdAt || 0).getTime();
      return timeMs >= startTimeMs && timeMs <= endTimeMs;
    });
    const logLines: string[] = events.map((evt: any) => {
      const time = new Date(evt.time || evt.createdAt || Date.now()).toISOString();
      const state = (evt.state || evt.status || 'UNKNOWN').toUpperCase();
      const level = state === 'ERROR' || state === 'FAILED' ? 'ERROR' : 'INFO';
      return `[${time}] [${level}] [qstash:${state}] msgId=${evt.messageId || evt.id} url="${evt.url || ''}" topic="${evt.topicName || ''}" retries=${evt.retryCount ?? 0}`;
    });
    const content = logLines.length > 0 ? logLines.join('\n') : `[${new Date().toISOString()}] [INFO] No QStash events recorded in the selected window.`;
    return {
      status: 200,
      body: { range, startTime: new Date(startTimeMs).toISOString(), endTime: new Date(endTimeMs).toISOString(), totalEntries: logLines.length, logs: content, events },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_qstash_logs' } });
    return { status: 500, body: { error: `Failed to fetch QStash logs: ${message}` } };
  }
}

async function fetchUpstashHistory(provider: 'redis' | 'vector'): Promise<Array<{ polledAt: string; ok: boolean; stats: Record<string, unknown>; error: string | null }>> {
  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from('upstash_snapshots')
      .select('polled_at, ok, stats, error')
      .eq('provider', provider)
      .order('polled_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data || []).map((row) => ({ polledAt: row.polled_at, ok: row.ok, stats: row.stats, error: row.error }));
  } catch (error) {
    Sentry.captureException(error, { tags: { operation: `admin_upstash_${provider}_history` } });
    console.error(`[admin-logs] failed to load ${provider} history:`, error);
    return [];
  }
}

export async function fetchUpstashRedisLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const wantHistory = searchParams.get('history') === '1';
  const history = wantHistory ? await fetchUpstashHistory('redis') : [];

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return { status: 503, body: { error: 'UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN is not configured.' } };
  }
  try {
    const res = await fetch(`${url}/info`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upstash Redis REST API returned ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const infoText = typeof data.result === 'string' ? data.result : JSON.stringify(data);
    const timeIso = new Date().toISOString();
    const lines = infoText.split('\n').filter((l: string) => l.trim().length > 0 && !l.startsWith('#'));
    const formatted = lines.map((l: string) => `[${timeIso}] [INFO] [redis:stat] ${l.trim()}`).join('\n');
    return {
      status: 200,
      body: { totalEntries: lines.length, logs: formatted || `[${timeIso}] [INFO] Redis info query completed with no output lines.`, rawInfo: infoText, ...(wantHistory ? { history } : {}) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_upstash_redis_logs' } });
    return { status: 500, body: { error: `Failed to fetch Upstash Redis stats: ${message}` } };
  }
}

export async function fetchUpstashVectorLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const wantHistory = searchParams.get('history') === '1';
  const history = wantHistory ? await fetchUpstashHistory('vector') : [];

  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token || url.includes('placeholder') || token.includes('mock')) {
    return { status: 503, body: { error: 'UPSTASH_VECTOR_REST_URL or UPSTASH_VECTOR_REST_TOKEN is missing or set to placeholder/mock value.' } };
  }
  try {
    const res = await fetch(`${url}/info`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Upstash Vector REST API returned ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const resultObj = data.result || data;
    const timeIso = new Date().toISOString();
    const lines = Object.entries(resultObj).map(([k, v]) => `[${timeIso}] [INFO] [vector:info] ${k}=${JSON.stringify(v)}`);
    const formatted = lines.join('\n');
    return {
      status: 200,
      body: { totalEntries: lines.length, logs: formatted || `[${timeIso}] [INFO] Upstash Vector index query completed cleanly.`, result: resultObj, ...(wantHistory ? { history } : {}) },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_upstash_vector_logs' } });
    return { status: 500, body: { error: `Failed to fetch Upstash Vector stats: ${message}` } };
  }
}

export async function fetchVercelLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    return {
      status: 503,
      body: { error: 'VERCEL_TOKEN or VERCEL_PROJECT_ID not configured in Vercel environment variables.', missingEnvVars: ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID'].filter((k) => !process.env[k]) },
    };
  }
  const limit = searchParams.get('limit') || '100';
  const { startTimeMs, endTimeMs } = computeTimeWindow(searchParams);
  try {
    // Vercel's /v2/events wants since/until as ISO 8601 dates, not epoch ms --
    // confirmed via a live 400 ("must be valid ISO 8601 dates") in production.
    const res = await fetch(`https://api.vercel.com/v2/events?projectId=${projectId}&limit=${limit}&since=${new Date(startTimeMs).toISOString()}&until=${new Date(endTimeMs).toISOString()}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Vercel API returned status ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : Array.isArray(data) ? data : [];
    const filteredEvents = events.filter((e: any) => {
      const ts = new Date(e.created || e.timestamp || e.date || Date.now()).getTime();
      return ts >= startTimeMs && ts <= endTimeMs;
    });
    const logLines = filteredEvents.map((e: any) => {
      const time = new Date(e.created || e.timestamp || Date.now()).toISOString();
      const level = e.level || (e.text?.includes('Error') ? 'ERROR' : 'INFO');
      return `[${time}] [${level}] [vercel:${e.type || 'runtime'}] ${e.text || e.message || JSON.stringify(e)}`;
    });
    return { status: 200, body: { totalEntries: logLines.length, logs: logLines.join('\n') || `[${new Date().toISOString()}] [INFO] No Vercel events found in selected time range.`, events: filteredEvents } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_vercel_logs' } });
    return { status: 500, body: { error: `Failed to fetch Vercel logs: ${message}` } };
  }
}

/**
 * RCA (2026-08-03): The `logs.all` endpoint has been deprecated by Supabase
 * in favor of the new `/logs` endpoint (ClickHouse SQL). The old endpoint
 * still works but may be removed upstream without notice. The new endpoint
 * returns `{"error":"Backend error! Retry your query."}` for `postgres_logs`
 * as of 2026-08-03 — likely a ClickHouse migration issue with the `postgres_logs`
 * source table. This function implements a dual-path strategy:
 *
 * 1. Try the new `/logs` endpoint with ClickHouse SQL first.
 * 2. If that fails, fall back to the deprecated `logs.all` endpoint.
 * 3. Track which path was used via Sentry and console.warn.
 *
 * When the new endpoint stabilizes, the fallback path can be removed.
 * See docs/TECH_DEBT_LEDGER.md item 17 for the full investigation.
 */
async function fetchSupabaseLogsFromEndpoint(
  endpoint: 'logs' | 'logs.all',
  sql: string,
  token: string,
  projectRef: string,
  isoStart: string,
  isoEnd: string,
): Promise<{ result: unknown[]; endpointUsed: string }> {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/${endpoint}?sql=${encodeURIComponent(sql)}&iso_timestamp_start=${encodeURIComponent(isoStart)}&iso_timestamp_end=${encodeURIComponent(isoEnd)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Supabase Management API (${endpoint}) returned status ${res.status}: ${errText}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`Supabase analytics query (${endpoint}) failed: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}`);
  }
  const resultList = Array.isArray(data.result) ? data.result : Array.isArray(data) ? data : [];
  return { result: resultList, endpointUsed: endpoint };
}

export async function fetchSupabaseLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/(.*?)\.supabase\.co/)?.[1];
  if (!token || !projectRef) {
    return { status: 503, body: { error: 'SUPABASE_ACCESS_TOKEN is missing or project reference could not be parsed.', missingEnvVars: ['SUPABASE_ACCESS_TOKEN'].filter((k) => !process.env[k]) } };
  }
  const { startTimeMs, endTimeMs } = computeTimeWindow(searchParams);
  const clampedStart = Math.max(startTimeMs, endTimeMs - 86400000);
  const isoStart = new Date(clampedStart).toISOString();
  const isoEnd = new Date(endTimeMs).toISOString();
  try {
    // Try the new ClickHouse `/logs` endpoint first
    const clickhouseSql = `select timestamp, event_message from logs where source = 'postgres_logs' order by timestamp desc limit 100`;
    let { result: resultList, endpointUsed } = await fetchSupabaseLogsFromEndpoint(
      'logs', clickhouseSql, token, projectRef, isoStart, isoEnd,
    );
    // If the new endpoint returned empty but the old one might have data, try fallback
    if (resultList.length === 0) {
      const legacySql = `select timestamp, event_message from postgres_logs order by timestamp desc limit 100`;
      const fallback = await fetchSupabaseLogsFromEndpoint(
        'logs.all', legacySql, token, projectRef, isoStart, isoEnd,
      );
      resultList = fallback.result;
      endpointUsed = fallback.endpointUsed;
      console.warn('[admin-logs] Supabase /logs endpoint returned empty, fell back to logs.all', { projectRef });
      Sentry.captureMessage('Supabase logs: /logs returned empty, fell back to logs.all', {
        level: 'warning',
        extra: { projectRef, endpoint: 'logs.all' },
      });
    }
    if (endpointUsed === 'logs.all') {
      console.warn('[admin-logs] Using deprecated logs.all endpoint — migrate to /logs when it stabilizes', { projectRef });
      Sentry.captureMessage('Supabase logs: using deprecated logs.all endpoint', {
        level: 'info',
        extra: { projectRef, endpoint: 'logs.all' },
      });
    }
    const filteredList = resultList.filter((e: any) => {
      const ts = e.timestamp ? (typeof e.timestamp === 'number' ? e.timestamp / 1000 : new Date(e.timestamp).getTime()) : Date.now();
      return ts >= startTimeMs && ts <= endTimeMs;
    });
    const targetList = filteredList.length > 0 ? filteredList : resultList;
    const logLines = targetList.map((e: any) => {
      const tsNum = typeof e.timestamp === 'number' ? e.timestamp / 1000 : new Date(e.timestamp || Date.now()).getTime();
      const time = new Date(tsNum).toISOString();
      const msg = e.event_message || e.message || JSON.stringify(e);
      const level = msg.includes('ERROR') || msg.includes('FATAL') ? 'ERROR' : msg.includes('WARN') ? 'WARN' : 'INFO';
      return `[${time}] [${level}] [supabase:postgres] ${msg}`;
    });
    return { status: 200, body: { totalEntries: logLines.length, logs: logLines.join('\n') || `[${new Date().toISOString()}] [INFO] No Supabase log entries returned.`, resultList: targetList, endpointUsed } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_supabase_logs' } });
    return { status: 500, body: { error: `Failed to fetch Supabase logs: ${message}` } };
  }
}

export async function fetchCloudflareLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    return { status: 503, body: { error: 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not configured in Vercel environment variables.', missingEnvVars: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((k) => !process.env[k]) } };
  }
  const query = `
    query GetWorkerLogs($accountTag: string!) {
      viewer {
        accounts(filter: {accountTag: $accountTag}) {
          workersInvocationsAdaptive(limit: 50, orderBy: [datetime_DESC]) {
            dimensions { scriptName status datetime }
            quantiles { cpuTimeP50 }
          }
        }
      }
    }
  `;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { accountTag: accountId } }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Cloudflare GraphQL API returned ${res.status}: ${errText}`);
    }
    const json = await res.json();
    const rawInvocations = json?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
    const { startTimeMs, endTimeMs } = computeTimeWindow(searchParams);
    const invocations = rawInvocations.filter((inv: any) => {
      const ts = new Date(inv.dimensions?.datetime || 0).getTime();
      return ts >= startTimeMs && ts <= endTimeMs;
    });
    const logLines = invocations.map((inv: any) => {
      const dims = inv.dimensions || {};
      const time = dims.datetime || new Date().toISOString();
      const status = dims.status || 'unknown';
      const level = status === 'success' || status === 'ok' ? 'INFO' : 'ERROR';
      return `[${time}] [${level}] [cf-worker:${dims.scriptName || 'yt-intel'}] status=${status} p50CpuTime=${inv.quantiles?.cpuTimeP50 ?? 0}ms`;
    });
    return { status: 200, body: { totalEntries: logLines.length, logs: logLines.join('\n') || `[${new Date().toISOString()}] [INFO] No Cloudflare worker invocations returned.`, invocations } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_cloudflare_logs' } });
    return { status: 500, body: { error: `Failed to fetch Cloudflare logs: ${message}` } };
  }
}

export async function fetchContractAuditLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  try {
    const service = getSupabaseServiceClient();
    const limit = Number(searchParams.get('limit')) || 30;
    const { data: runs, error } = await service
      .from('contract_audit_runs')
      .select('id, run_at, source, commit_sha, critical_count, warning_count, findings')
      .order('run_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const logLines: string[] = [];
    (runs || []).forEach((run) => {
      const level = run.critical_count > 0 ? 'ERROR' : run.warning_count > 0 ? 'WARN' : 'INFO';
      logLines.push(`[${run.run_at}] [${level}] [contract-audit:${run.source}] critical=${run.critical_count} warning=${run.warning_count} commit=${run.commit_sha || 'local'}`);
      const findings = Array.isArray(run.findings) ? run.findings : [];
      findings.forEach((f: any) => {
        const fLevel = f.severity === 'critical' ? 'ERROR' : 'WARN';
        logLines.push(`  [${fLevel}] ${f.rule} @ ${f.file}:${f.line} -- ${f.why}`);
      });
    });

    const content = logLines.length > 0
      ? logLines.join('\n')
      : `[${new Date().toISOString()}] [INFO] No contract-auditor runs recorded yet. Run \`pnpm --filter @hex-yt-intel/web contract-audit\` locally, or wait for the next CI push to main.`;

    return { status: 200, body: { totalEntries: logLines.length, logs: content, runs } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_contract_audit_logs' } });
    return { status: 500, body: { error: `Failed to fetch contract audit logs: ${message}` } };
  }
}

export async function fetchOpenRouterLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const key = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!key) {
    return { status: 503, body: { error: 'OPENROUTER_MANAGEMENT_KEY is not configured in environment variables.' } };
  }
  const { startTimeMs, endTimeMs } = computeTimeWindow(searchParams);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/activity', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenRouter Activity API returned status ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const rows = Array.isArray(data.data) ? data.data : [];
    const filtered = rows.filter((r: any) => {
      const ts = r.date ? new Date(r.date).getTime() : Date.now();
      return ts >= startTimeMs && ts <= endTimeMs;
    });
    const targetRows = filtered.length > 0 ? filtered : rows;
    const logLines = targetRows.map((r: any) => {
      const time = new Date(r.date || Date.now()).toISOString();
      return `[${time}] [INFO] [openrouter:${r.model || r.model_permaslug || 'unknown'}] provider=${r.provider_name || 'unknown'} requests=${r.requests ?? 0} promptTokens=${r.prompt_tokens ?? 0} completionTokens=${r.completion_tokens ?? 0} reasoningTokens=${r.reasoning_tokens ?? 0} usage=$${(r.usage ?? 0).toFixed(4)}`;
    });
    return {
      status: 200,
      body: {
        totalEntries: logLines.length,
        logs: logLines.join('\n') || `[${new Date().toISOString()}] [INFO] No OpenRouter activity in selected time range.`,
        rows: targetRows,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_openrouter_logs' } });
    return { status: 500, body: { error: `Failed to fetch OpenRouter activity: ${message}` } };
  }
}

const SENTRY_ORG_SLUG = 'hex-org';
const SENTRY_REGION_HOST = 'de.sentry.io';
const SENTRY_PROJECT_ID = '4511384514461776';

export async function fetchSentryLogs(searchParams: URLSearchParams): Promise<FetcherResult> {
  const token = process.env.SENTRY_LOGS_AUTH_TOKEN;
  if (!token) {
    return { status: 503, body: { error: 'SENTRY_LOGS_AUTH_TOKEN is not configured in environment variables.' } };
  }
  try {
    const url = `https://${SENTRY_REGION_HOST}/api/0/organizations/${SENTRY_ORG_SLUG}/issues/?project=${SENTRY_PROJECT_ID}&limit=50&sort=date&query=is:unresolved`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Sentry Issues API returned status ${res.status}: ${errText}`);
    }
    const issues = (await res.json()) as any[];
    const { startTimeMs, endTimeMs } = computeTimeWindow(searchParams);
    const filtered = issues.filter((i) => {
      const ts = i.lastSeen ? new Date(i.lastSeen).getTime() : Date.now();
      return ts >= startTimeMs && ts <= endTimeMs;
    });
    const targetIssues = filtered.length > 0 ? filtered : issues;
    const logLines = targetIssues.map((i) => {
      const level = i.level === 'error' || i.level === 'fatal' ? 'ERROR' : i.level === 'warning' ? 'WARN' : 'INFO';
      return `[${i.lastSeen}] [${level}] [sentry:${i.shortId}] count=${i.count} culprit=${i.culprit || 'unknown'} -- ${i.title} (${i.permalink})`;
    });
    return {
      status: 200,
      body: {
        totalEntries: logLines.length,
        logs: logLines.join('\n') || `[${new Date().toISOString()}] [INFO] No unresolved Sentry issues in selected time range.`,
        issues: targetIssues,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, { tags: { operation: 'admin_sentry_logs' } });
    return { status: 500, body: { error: `Failed to fetch Sentry issues: ${message}` } };
  }
}
