#!/usr/bin/env tsx
/**
 * Automated Historical Backfill Script: Stance Relations (ADR 031)
 *
 * Scans completed analyses in Supabase `analyses` table:
 * 1. Checks if `analysis_payload->'stance_relations'` already exists and matches current markdown hash.
 * 2. If missing, extracts dimensions and computes stance relations using `computeStanceRelationsStream`.
 * 3. Write-through persists results to both Redis (7d TTL) and Supabase (`analyses.analysis_payload`).
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
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnvFile(path.resolve(process.cwd(), 'web/.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env.local'));

import { computeStanceRelationsStream, type StanceDimension } from '../web/lib/intelligence/relations-engine';
import { DIMENSION_NAMES } from '../web/lib/types/dimension';
import type { RelationsResult, RelationInsight } from '../web/lib/types/knowledge-graph';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function parseDimensions(markdown: string): StanceDimension[] {
  const out: StanceDimension[] = [];
  const re = /#{1,4}\s*DIMENSION\s+(\d+)\s*[–\-:]?\s*([^\n]*)\n([\s\S]*?)(?=#{1,4}\s*DIMENSION\s+\d+|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const number = parseInt(m[1]!, 10);
    if (number < 1 || number > 11) continue;
    const name = (m[2] || '').trim() || DIMENSION_NAMES[number] || `Dimension ${number}`;
    const content = (m[3] || '').trim();
    out.push({ number, name, content });
  }
  return out;
}

async function hashContent(text: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

async function setRedisCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return;
  try {
    await fetch(`${UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?ex=${ttlSeconds}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    });
  } catch (err) {
    console.warn(`[backfill] Redis set error for key ${key}:`, err);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : 100;

  console.log('=== Stance Relations Historical Backfill (ADR 031) ===');
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (no mutations)' : 'LIVE BACKFILL'}`);
  console.log(`Limit: ${limit} analyses`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing Supabase URL or Key');
    process.exit(1);
  }

  if (!OPENROUTER_API_KEY) {
    console.error('❌ Missing OPENROUTER_API_KEY');
    process.exit(1);
  }

  console.log(`Connecting to Supabase at: ${SUPABASE_URL}`);
  const fetchUrl = `${SUPABASE_URL}/rest/v1/analyses?select=id,video_id,user_id,analysis_markdown,analysis_payload,created_at,billing_status&billing_status=eq.completed&order=created_at.desc&limit=${limit}`;

  const res = await fetch(fetchUrl, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    console.error(`Failed to fetch analyses: ${res.status} ${res.statusText}`, await res.text());
    process.exit(1);
  }

  const analyses = (await res.json()) as Array<{
    id: string;
    video_id: string;
    user_id: string;
    analysis_markdown?: string;
    analysis_payload?: Record<string, unknown> | null;
    created_at: string;
  }>;

  console.log(`Found ${analyses.length} completed analyses to evaluate.\n`);

  let alreadyPresent = 0;
  let backfilled = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < analyses.length; i++) {
    const analysis = analyses[i]!;
    const { id, video_id, user_id, analysis_markdown, analysis_payload } = analysis;

    if (!analysis_markdown || analysis_markdown.trim().length === 0) {
      console.log(`[${i + 1}/${analyses.length}] Analysis ${id} (${video_id}): Skipped (empty markdown)`);
      skipped++;
      continue;
    }

    const contentHash = await hashContent(analysis_markdown);
    const existingRelations = analysis_payload?.stance_relations as
      | (RelationsResult & { contentHash?: string })
      | undefined;

    if (existingRelations && existingRelations.contentHash === contentHash && Array.isArray(existingRelations.insights)) {
      console.log(`[${i + 1}/${analyses.length}] Analysis ${id} (${video_id}): Already present & up to date (${existingRelations.insights.length} insights).`);
      // Pre-warm Redis cache if needed
      const cacheKey = `relations:${id}:${contentHash}`;
      if (!isDryRun) {
        await setRedisCache(cacheKey, JSON.stringify(existingRelations), CACHE_TTL_SECONDS);
      }
      alreadyPresent++;
      continue;
    }

    const dimensions = parseDimensions(analysis_markdown);
    if (dimensions.length < 2) {
      console.log(`[${i + 1}/${analyses.length}] Analysis ${id} (${video_id}): Skipped (<2 dimensions parsed, found ${dimensions.length})`);
      skipped++;
      continue;
    }

    console.log(`[${i + 1}/${analyses.length}] Computing stance relations for ${id} (${video_id}, ${dimensions.length} dims)...`);

    if (isDryRun) {
      console.log(`  [dry-run] Would compute relations and persist to Supabase & Redis.`);
      backfilled++;
      continue;
    }

    try {
      const insights: RelationInsight[] = [];
      let modelUsed = 'unknown';

      for await (const chunk of computeStanceRelationsStream(dimensions, OPENROUTER_API_KEY, undefined, user_id)) {
        if (chunk.type === 'model') {
          modelUsed = chunk.model;
        } else if (chunk.type === 'insight') {
          insights.push(chunk.insight);
        }
      }

      const result: RelationsResult = {
        analysisId: id,
        generatedAt: new Date().toISOString(),
        model: modelUsed,
        insights,
      };

      console.log(`  ✓ Generated ${insights.length} insights using ${modelUsed}`);

      const updatedPayload = {
        ...(analysis_payload || {}),
        stance_relations: { ...result, contentHash },
      };

      // Write to Supabase
      const patchUrl = `${SUPABASE_URL}/rest/v1/analyses?id=eq.${id}`;
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ analysis_payload: updatedPayload }),
      });

      if (!patchRes.ok) {
        console.error(`  ❌ Failed to patch Supabase for ${id}: ${patchRes.status} ${patchRes.statusText}`);
        errors++;
        continue;
      }

      // Write to Redis
      const cacheKey = `relations:${id}:${contentHash}`;
      await setRedisCache(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);

      console.log(`  ✓ Persisted to Supabase and Redis (cacheKey: ${cacheKey})`);
      backfilled++;
    } catch (err) {
      console.error(`  ❌ Error backfilling ${id}:`, err);
      errors++;
    }
  }

  console.log('\n=== Backfill Summary ===');
  console.log(`Total Scanned:    ${analyses.length}`);
  console.log(`Already Present:  ${alreadyPresent}`);
  console.log(`Backfilled:       ${backfilled}`);
  console.log(`Skipped:          ${skipped}`);
  console.log(`Errors:           ${errors}`);
}

main().catch((err) => {
  console.error('Fatal backfill error:', err);
  process.exit(1);
});
