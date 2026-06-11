export const dynamic = 'force-dynamic';
export const runtime = 'edge';

import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { getRedisValue, setRedisValue, deleteRedisKey } from '@/lib/redis';
import { computeStanceRelationsStream, type StanceDimension } from '@/lib/intelligence/relations-engine';
import { DIMENSION_NAMES } from '@/lib/types/synthesis-nucleus';
import type { RelationsResult, RelationInsight } from '@/lib/types/knowledge-graph';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const serverInFlight = new Map<string, Promise<RelationsResult>>();

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
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const timeoutTimer = setTimeout(() => {
        send({ type: 'error', error: 'Request timed out (25s window exceeded)' });
        controller.close();
      }, 25000);

      try {
        const supabase = await getSupabaseClientWithAuth();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          send({ type: 'error', error: 'Unauthorized' });
          controller.close();
          return;
        }

        const { data: analysis, error } = await supabase
          .from('analyses')
          .select('id, analysis_markdown')
          .eq('id', id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (error || !analysis) {
          send({ type: 'error', error: 'Analysis not found' });
          controller.close();
          return;
        }

        const markdown: string = analysis.analysis_markdown || '';
        const dimensions = parseDimensions(markdown);
        const contentHash = await hashContent(markdown);
        const cacheKey = `relations:${id}:${contentHash}`;

        const cached = await getRedisValue(cacheKey);
        if (cached) {
          try {
            const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
            send({ ...parsed, cached: true, type: 'complete' });
            controller.close();
            return;
          } catch (e) {
            console.error('[relations/route] Malformed cache, purging:', cacheKey, e);
            await deleteRedisKey(cacheKey).catch(() => {});
          }
        }

        // Check for in-flight server computation first
        const existingPromise = serverInFlight.get(cacheKey);
        if (existingPromise) {
          try {
            const result = await existingPromise;
            send({ ...result, type: 'complete' });
          } catch (err) {
            send({ type: 'error', error: 'Failed to compute relations' });
          }
          controller.close();
          return;
        }

        const apiKey = process.env.OPENROUTER_API_KEY || '';
        const insights: RelationInsight[] = [];
        let modelUsed = 'unknown';

        let resolvePromise: (val: RelationsResult) => void = () => {};
        let rejectPromise: (err: any) => void = () => {};
        const computePromise = new Promise<RelationsResult>((res, rej) => {
          resolvePromise = res;
          rejectPromise = rej;
        });
        serverInFlight.set(cacheKey, computePromise);

        try {
          for await (const chunk of computeStanceRelationsStream(dimensions, apiKey)) {
            if (chunk.type === 'model') {
              modelUsed = chunk.model;
              send({ type: 'status', stage: 'computing', model: chunk.model });
            } else if (chunk.type === 'insight') {
              insights.push(chunk.insight);
              send({ type: 'insight', insight: chunk.insight });
            }
          }

          const result: RelationsResult = {
            analysisId: id,
            generatedAt: new Date().toISOString(),
            model: modelUsed,
            insights,
          };

          if (insights.length > 0) {
            await setRedisValue(cacheKey, JSON.stringify(result), CACHE_TTL_SECONDS).catch(() => {});
          }

          resolvePromise(result);
          serverInFlight.delete(cacheKey);

          send({ ...result, type: 'complete' });
        } catch (err) {
          rejectPromise(err);
          serverInFlight.delete(cacheKey);
          throw err;
        }
      } catch (err) {
        Sentry.captureException(err, { tags: { operation: 'relations', reason: 'unhandled' } });
        send({ type: 'error', error: 'Failed to compute relations' });
      } finally {
        clearTimeout(timeoutTimer);
        controller.close();
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  });
}
