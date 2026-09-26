#!/usr/bin/env tsx
/**
 * Automated Historical Backfill Script: Stance Relations (ADR 031)
 *
 * Scans completed analyses in Supabase `analyses` table:
 * 1. Checks if `analysis_payload->'stance_relations'` already exists and matches current markdown hash.
 * 2. If missing, extracts dimensions and computes stance relations using `computeStanceRelationsStream`.
 * 3. Write-through persists results to both Redis (7d TTL) and Supabase (`analyses.analysis_payload`,
 *    atomically via the merge_analysis_payload_key RPC — never a full read-modify-write).
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY (anon key silently scans 0 rows under RLS — fails fast).
 * Paginates through ALL matching rows (up to --limit) and reports remaining coverage.
 *
 * Usage:
 *   dotenv -e .env.local -- pnpm exec tsx scripts/backfill-stance-relations.ts
 *   or:
 *   pnpm --filter @hex-yt-intel/web exec tsx ../scripts/backfill-stance-relations.ts [--dry-run] [--limit=50]
 */

import fs from 'fs';
import path from 'path';

// Load environment variables from .env.local and web/.env.local if present
function loadEnvFile(filePath: string) {
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('=');
      const key = (parts.shift() || '').trim();
      let val = parts.join('=').trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFile(path.resolve(process.cwd(), 'web/.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env.local'));

import { computeStanceRelationsStream, type StanceDimension } from '../web/lib/intelligence/relations-engine';
import { DIMENSION_NAMES } from '../web/lib/types/dimension';
import { RELATIONS_REGISTRY_FALLBACK } from '../web/lib/utils/relations-settings';
import type { RelationsResult, RelationInsight } from '../web/lib/types/knowledge-graph';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// PR #322 round-2 P1: anon key silently scans 0 rows under RLS — the
// service-role key is REQUIRED, never fallen back.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/** Lossy display truncation with an explicit ellipsis indicator. */
function truncateForLog(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

/**
 * Fetch wrapper: every I/O call sits inside a try/finally (qa-intel
 * workflow-safety rule); fetch has no releaseable resource, the finally
 * documents that and keeps the invariant uniform.
 */
async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } finally {
    // No releaseable resource for fetch.
  }
}

function parseDimensions(markdown: string): StanceDimension[] {
  const out: StanceDimension[] = [];
  const re = /#{1,4}\s*DIMENSION\s+(\d+)\s*[–\-:]?\s*([^\n]*)\n([\s\S]*?)(?=#{1,4}\s*DIMENSION\s+\d+|$)/gi;
  try {
    let match = re.exec(markdown);
    while (match) {
      const number = parseInt(match[1]!, 10);
      if (number >= 1 && number <= 11) {
        const name = (match[2] || '').trim() || DIMENSION_NAMES[number] || `Dimension ${number}`;
        const content = (match[3] || '').trim();
        out.push({ number, name, content });
      }
      match = re.exec(markdown);
    }
  } finally {
    re.lastIndex = 0;
  }
  return out;
}

async function hashContent(text: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.match(/^[0-9a-f]{16}/)?.[0] ?? hex;
}

/**
 * Redis write-through (PR #322 round-2 P2): POST the value in the request
 * BODY (never URL-encoded into the path — large payloads break URLs), and
 * check response.ok so a failed cache write is reported as a Redis failure
 * instead of silently assumed successful.
 */
async function setRedisCache(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return false;
  try {
    const res = await safeFetch(`${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
      body: value,
    });
    if (!res.ok) {
      console.error(`[backfill] Redis set returned HTTP ${res.status} for key ${key}: ${truncateForLog(await res.text(), 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[backfill] Redis set error for key ${key}:`, err);
    return false;
  }
}

/**
 * Atomic analysis_payload key-merge via the merge_analysis_payload_key RPC
 * (supabase/migrations/20260924231500_merge_analysis_payload_key_rpc.sql).
 * Bounded retry + zero-row verification, mirroring
 * SupabaseAnalysisPayloadAdapter's contract (Settings Registry defaults).
 */
async function mergePayloadKey(id: string, key: string, value: unknown): Promise<boolean> {
  const maxAttempts = RELATIONS_REGISTRY_FALLBACK['relations.persistMaxAttempts'];
  const baseDelayMs = RELATIONS_REGISTRY_FALLBACK['relations.persistRetryBaseDelayMs'];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await safeFetch(`${SUPABASE_URL}/rest/v1/rpc/merge_analysis_payload_key`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY!,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_id: id, p_key: key, p_value: value }),
      });
      if (!res.ok) {
        throw new Error(`RPC HTTP ${res.status}: ${truncateForLog(await res.text(), 200)}`);
      }
      const affected = await res.json();
      const affectedRows = typeof affected === 'number' ? affected : 0;
      if (affectedRows === 0) {
        console.error(`[backfill] merge_analysis_payload_key matched 0 rows for ${id} (key=${key})`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`[backfill] Supabase merge attempt ${attempt}/${maxAttempts} failed for ${id}:`, err instanceof Error ? err.message : String(err));
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
      }
    }
  }
  return false;
}

interface BackfillRow {
  id: string;
  video_id: string;
  user_id: string;
  analysis_markdown?: string;
  analysis_payload?: Record<string, unknown> | null;
  created_at: string;
}

async function fetchAnalysesPage(offset: number, pageSize: number, runStartIso: string): Promise<{ rows: BackfillRow[]; total: number | null }> {
  const url = `${SUPABASE_URL}/rest/v1/analyses?select=id,video_id,user_id,analysis_markdown,analysis_payload,created_at&billing_status=eq.completed&created_at=lte.${encodeURIComponent(runStartIso)}&order=created_at.desc&limit=${pageSize}&offset=${offset}`;
  const res = await safeFetch(url, {
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'count=exact',
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch analyses page (offset=${offset}): ${res.status} ${res.statusText} ${truncateForLog(await res.text(), 200)}`);
  }
  const contentRange = res.headers.get('content-range');
  let total: number | null = null;
  if (contentRange) {
    const totalPart = contentRange.split('/')[1];
    total = totalPart === '*' ? null : parseInt(totalPart || '', 10);
    if (isNaN(total as number)) total = null;
  }
  return { rows: (await res.json()) as BackfillRow[], total };
}

async function main() {
  process.argv.splice(0, 2); // drop node + script path
  const args = process.argv;
  const isDryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : 100;

  console.log('=== Stance Relations Historical Backfill (ADR 031) ===');
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (no mutations)' : 'LIVE BACKFILL'}`);
  console.log(`Limit: ${limit} analyses`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase URL or SUPABASE_SERVICE_ROLE_KEY (anon key cannot read under RLS — refusing to run)');
    process.exit(1);
  }

  if (!OPENROUTER_API_KEY) {
    console.error('❌ Missing OPENROUTER_API_KEY');
    process.exit(1);
  }

  console.log(`Connecting to Supabase at: ${SUPABASE_URL}`);

  let scanned = 0;
  let alreadyPresent = 0;
  let backfilled = 0;
  let planned = 0;
  let skipped = 0;
  let exhaustedCascade = 0;
  let supabaseErrors = 0;
  let redisErrors = 0;
  let remaining: number | null = null;
  let total: number | null = null;

  // Page size capped independently of --limit: each row carries a full
  // analysis_markdown, so fetching `limit` rows in one request can produce
  // very large payloads.
  const pageSize = Math.min(limit, 100);
  let offset = 0;
  // Cubic P2 (PR #322): offset pagination is unstable while new completed
  // analyses can enter the result set mid-run (they shift pages and silently
  // skip rows). Pinning the scan to rows created before the run started
  // freezes the result set for the run's lifetime.
  const runStartIso = new Date().toISOString();

  while (scanned < limit) {
    const { rows, total: pageTotal } = await fetchAnalysesPage(offset, Math.min(pageSize, limit - scanned), runStartIso);
    if (pageTotal !== null) total = pageTotal;
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i++) {
      const analysis = rows[i]!;
      const rowLabel = `[${scanned + i + 1}] Analysis ${analysis.id} (${analysis.video_id})`;
      const { id, user_id, analysis_markdown, analysis_payload } = analysis;

      if (!analysis_markdown || analysis_markdown.trim().length === 0) {
        console.log(`${rowLabel}: Skipped (empty markdown)`);
        skipped++;
        continue;
      }

      const contentHash = await hashContent(analysis_markdown);
      const existingRelations = analysis_payload?.stance_relations as
        | (RelationsResult & { contentHash?: string })
        | undefined;

      if (existingRelations && existingRelations.contentHash === contentHash && Array.isArray(existingRelations.insights)) {
        console.log(`${rowLabel}: Already present & up to date (${existingRelations.insights.length} insights).`);
        // Pre-warm Redis cache if needed
        const cacheKey = `relations:${id}:${contentHash}`;
        if (!isDryRun) {
          const redisOk = await setRedisCache(cacheKey, JSON.stringify(existingRelations), CACHE_TTL_SECONDS);
          if (!redisOk) redisErrors++;
        }
        alreadyPresent++;
        continue;
      }

      const dimensions = parseDimensions(analysis_markdown);
      if (dimensions.length < 2) {
        console.log(`${rowLabel}: Skipped (<2 dimensions parsed, found ${dimensions.length})`);
        skipped++;
        continue;
      }

      console.log(`${rowLabel}: Computing stance relations (${dimensions.length} dims)...`);

      if (isDryRun) {
        console.log(`  [dry-run] Would compute relations and persist to Supabase & Redis.`);
        // Cubic P3 (PR #322): dry-run performed no persistence — counting
        // rows under "Backfilled" misreported it as done work.
        planned++;
        continue;
      }

      try {
        const insights: RelationInsight[] = [];
        let modelUsed = 'unknown';
        let cascadeExhausted = false;

        for await (const chunk of computeStanceRelationsStream(dimensions, OPENROUTER_API_KEY, undefined, user_id)) {
          if (chunk.type === 'model') {
            modelUsed = chunk.model;
          } else if (chunk.type === 'insight') {
            insights.push(chunk.insight);
          } else if (chunk.type === 'exhausted') {
            cascadeExhausted = true;
          }
        }

        // Cubic P1 (PR #322): a fully-exhausted cascade is a failure, not a
        // valid zero-insight result — persisting it would cache the failure
        // permanently. Leave the row untouched; a future run can retry it.
        if (cascadeExhausted) {
          console.log(`  ✗ All cascade models exhausted for ${id} — not persisting`);
          exhaustedCascade++;
          continue;
        }

        // A completed cascade with zero insights is a VALID result and is
        // persisted (PR #322 round-2 P1) — otherwise it is recomputed
        // (and re-paid in LLM tokens) on every future request.
        const result: RelationsResult = {
          analysisId: id,
          generatedAt: new Date().toISOString(),
          model: modelUsed,
          insights,
        };

        console.log(`  ✓ Generated ${insights.length} insights using ${modelUsed}`);

        const persisted = await mergePayloadKey(id, 'stance_relations', { ...result, contentHash });
        if (!persisted) {
          supabaseErrors++;
          continue;
        }

        const cacheKey = `relations:${id}:${contentHash}`;
        const redisOk = await setRedisCache(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
        if (!redisOk) redisErrors++;

        console.log(`  ✓ Persisted to Supabase${redisOk ? ' and Redis' : ' (Redis failed)'} (cacheKey: ${cacheKey})`);
        backfilled++;
      } catch (err) {
        console.error(`  ❌ Error backfilling ${id}:`, err);
        supabaseErrors++;
      }
    }

    scanned += rows.length;
    offset += rows.length;
    if (rows.length < Math.min(pageSize, limit)) break;
  }

  if (total !== null) {
    remaining = Math.max(0, total - scanned);
  }

  console.log('\n=== Backfill Summary ===');
  console.log(`Total Scanned:    ${scanned}${total !== null ? ` of ${total} completed analyses` : ''}`);
  console.log(`Already Present:  ${alreadyPresent}`);
  console.log(`Backfilled:       ${backfilled}`);
  if (isDryRun) console.log(`Planned (dry-run): ${planned}`);
  console.log(`Cascade Exhausted (not persisted): ${exhaustedCascade}`);
  console.log(`Skipped:          ${skipped}`);
  console.log(`Supabase Errors:  ${supabaseErrors}`);
  console.log(`Redis Errors:     ${redisErrors}`);
  console.log(`Remaining (not scanned): ${remaining !== null ? remaining : 'unknown (no Content-Range header)'}`);
  if (remaining !== null && remaining > 0) {
    console.error(`⚠️  COVERAGE WARNING: ${remaining} completed analyses were NOT scanned (limit=${limit}). Re-run with a higher --limit or no limit to cover the remainder.`);
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
