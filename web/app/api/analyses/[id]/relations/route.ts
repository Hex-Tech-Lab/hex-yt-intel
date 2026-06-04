export const dynamic = 'force-dynamic';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { getRedisValue, setRedisValue } from '@/lib/redis';
import { computeStanceRelations, type StanceDimension } from '@/lib/intelligence/relations-engine';
import { DIMENSION_NAMES } from '@/lib/types/synthesis-nucleus';
import type { RelationsResult } from '@/lib/types/knowledge-graph';
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/** Parse the stored synthesis markdown into dimensions ("### DIMENSION N – Name\n…"). */
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

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: analysis, error } = await supabase
      .from('analyses')
      .select('id, analysis_markdown')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      Sentry.captureException(error, { tags: { operation: 'relations', reason: 'fetch' } });
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    if (!analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
    }

    const markdown: string = analysis.analysis_markdown || '';
    const dimensions = parseDimensions(markdown);

    // Cache key is content-addressed so re-analysis invalidates automatically.
    const contentHash = createHash('sha256').update(markdown).digest('hex').slice(0, 16);
    const cacheKey = `relations:${id}:${contentHash}`;

    const cached = await getRedisValue(cacheKey);
    if (cached) {
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      return NextResponse.json({ ...parsed, cached: true } as RelationsResult);
    }

    const apiKey = process.env.OPENROUTER_API_KEY || '';
    const { insights, model } = await computeStanceRelations(dimensions, apiKey);

    const result: RelationsResult = {
      analysisId: id,
      generatedAt: new Date().toISOString(),
      model,
      insights,
    };

    // Only cache a genuine result (don't pin an empty failure for 7 days).
    if (insights.length > 0) {
      await setRedisValue(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS);
    }

    return NextResponse.json(result);
  } catch (err) {
    Sentry.captureException(err, { tags: { operation: 'relations', reason: 'unhandled' } });
    return NextResponse.json({ error: 'Failed to compute relations' }, { status: 500 });
  }
}
