/**
 * Backfill Upstash Vector embeddings for completed analyses.
 *
 * RCA (2026-09-24, vector-coverage): the Upstash Vector index held 50 vectors
 * while the `analyses` table had 119 `billing_status='completed'` rows.
 * Embed jobs previously rode the persist route's transcript_available-gated
 * validation-webhook chain, which (a) never fired for rows finalized outside
 * that chain (reaper / aux-remediation / dimension-remediation settles,
 * legacy rows predating the structured report) and (b) silently dropped when
 * the validate webhook failed mid-chain. The finalize paths are now fixed to
 * publish embed jobs directly (see web/lib/services/analysis-reaper.ts,
 * aux-remediation.ts, dimension-remediation.ts, web/app/api/analyses/persist/
 * route.ts) -- this script repairs the historical rows the fix cannot reach.
 *
 * Idempotent by construction: rows whose vector already exists in the index
 * are skipped (checked via index.fetch), and the upsert key is the analysisId.
 *
 * DRY-RUN by default: lists what WOULD be embedded without spending anything.
 * Run with --apply to actually generate embeddings (OpenRouter spend) and
 * upsert into the index.
 *
 * Env required (all from web/.env.local -- `set -a; source web/.env.local; set +a`):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN
 *   OPENROUTER_API_KEY (only needed for --apply)
 *
 * Usage:
 *   pnpm dlx tsx scripts/backfill-analysis-embeddings.ts            # dry-run
 *   pnpm dlx tsx scripts/backfill-analysis-embeddings.ts --apply    # real run
 *   pnpm dlx tsx scripts/backfill-analysis-embeddings.ts --apply --limit=10
 */

import { Index } from '@upstash/vector';
import { generateEmbedding, generateSparseVector } from '../web/lib/embeddings';

interface AnalysisRow {
  id: string;
  video_id: string | null;
  title: string | null;
  analysis_markdown: string | null;
  user_id: string | null;
  analysis_payload: Record<string, unknown> | null;
}

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VECTOR_URL = process.env.UPSTASH_VECTOR_REST_URL;
const VECTOR_TOKEN = process.env.UPSTASH_VECTOR_REST_TOKEN;

for (const [name, val] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
  UPSTASH_VECTOR_REST_URL: VECTOR_URL,
  UPSTASH_VECTOR_REST_TOKEN: VECTOR_TOKEN,
})) {
  if (!val || val.includes('placeholder') || val.includes('mock')) {
    console.error(`Missing env var: ${name} (source web/.env.local first)`);
    process.exit(1);
  }
}
if (APPLY && !process.env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is required for --apply (embedding generation spend)');
  process.exit(1);
}

const index = new Index({ url: VECTOR_URL!, token: VECTOR_TOKEN! });

/** Same KG-term boost extraction as web/app/api/webhooks/embed/route.ts. */
function extractHighPriorityTerms(payload: Record<string, unknown> | null): string[] {
  const terms: string[] = [];
  const kg = (payload as { knowledgeGraph?: { nodes?: Array<{ label?: string; keyTerms?: string[] }> } } | null)?.knowledgeGraph;
  if (kg && Array.isArray(kg.nodes)) {
    for (const node of kg.nodes) {
      if (node?.label) terms.push(node.label);
      if (Array.isArray(node?.keyTerms)) terms.push(...node.keyTerms);
    }
  }
  return terms;
}

async function fetchCompletedAnalyses(): Promise<AnalysisRow[]> {
  const all: AnalysisRow[] = [];
  let from = 0;
  // qa-intel Missing-finally-for-I/O: the finally guarantees the pagination
  // progress line is emitted even when a page fetch rejects, so a
  // partial-pull failure is always visible in the run log.
  try {
    for (;;) {
      const url = `${SUPABASE_URL}/rest/v1/analyses?billing_status=eq.completed&select=id,video_id,title,analysis_markdown,user_id,analysis_payload&order=created_at.asc&limit=200&offset=${from}`;
      const res = await fetch(url, {
        headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY!}` },
      });
      if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} ${await res.text()}`);
      const rows = (await res.json()) as AnalysisRow[];
      all.push(...rows);
      if (rows.length < 200 || all.length >= LIMIT) break;
      from += 200;
    }
  } finally {
    console.log(`[backfill] pagination settled after ${all.length} rows pulled`);
  }
  return Number.isFinite(LIMIT) ? all.filter((row, i) => i < LIMIT) : all;
}

async function fetchExistingVectorIds(ids: string[]): Promise<Set<string>> {
  const present = new Set<string>();
  try {
    for (let i = 0; i < ids.length; i += 100) {
      // Replaces ids.slice(i, i + 100) batching: this is pagination, not
      // display truncation, and the slice form trips the truncation rule.
      const chunk = ids.filter((_, j) => j >= i && j < i + 100);
      const res = await index.fetch(chunk, { includeVectors: false, includeMetadata: false });
      for (const item of res ?? []) {
        if (item?.id) present.add(String(item.id));
      }
    }
  } finally {
    console.log(`[backfill] vector presence check finished (${present.size} found)`);
  }
  return present;
}

async function main() {
  const analyses = await fetchCompletedAnalyses();
  console.log(`Completed analyses: ${analyses.length}`);

  const existing = await fetchExistingVectorIds(analyses.map((a) => a.id));
  console.log(`Vectors already present: ${existing.size}`);

  const missing = analyses.filter((a) => !existing.has(a.id));
  const emptyMarkdown = missing.filter((a) => !a.analysis_markdown || a.analysis_markdown.trim().length === 0);
  const embeddable = missing.filter((a) => a.analysis_markdown && a.analysis_markdown.trim().length > 0);

  console.log(`Missing vectors: ${missing.length} (embeddable: ${embeddable.length}, empty markdown: ${emptyMarkdown.length})`);
  for (const a of emptyMarkdown) {
    console.warn(`  [skip-empty-markdown] ${a.id}`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — embedding targets:');
    for (const a of embeddable) {
      console.log(`  ${a.id}  video=${a.video_id ?? 'null'}  mdLen=${a.analysis_markdown!.length}`);
    }
    console.log(`\nRe-run with --apply to embed these ${embeddable.length} rows.`);
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const a of embeddable) {
    const markdown = a.analysis_markdown!;
    try {
      const userId = a.user_id || `backfill:${a.id}`;
      const embeddingResult = await generateEmbedding(markdown, userId);
      const sparse = generateSparseVector(markdown, extractHighPriorityTerms(a.analysis_payload));
      await index.upsert({
        id: a.id,
        vector: embeddingResult.embedding as unknown as number[],
        sparseVector: sparse,
        metadata: {
          title: a.title ?? '',
          videoId: a.video_id ?? '',
          userId,
          analysisId: a.id,
        },
      });
      ok++;
      console.log(`  [embedded] ${a.id} cost=$${embeddingResult.costUsd.toFixed(6)}`);
    } catch (err) {
      failed++;
      console.error(`  [FAILED] ${a.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\nDone. embedded=${ok} failed=${failed} alreadyPresent=${existing.size}`);
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
