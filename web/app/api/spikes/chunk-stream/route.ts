import { after } from 'next/server';
import { NextResponse } from 'next/server';
import { setRedisValue } from '@/lib/redis';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PROMPT = `Write a single JSON object (no markdown fences) shaped like a video-analysis dimension payload, with keys: "summary" (string), "takeaways" (array of 12 objects with "text" and "timestamp"), "entities" (array of 30 objects with "name", "type", "relevance"), "insights" (array of 20 strings), and "meta" (object with "dimension_id" and "version"). Make every field verbose and detailed — fill the entire 6000-token budget. Do not stop early; keep generating until the JSON is complete and large.`;

interface SpikeMetrics {
  rawBytes: number;
  textBytes: number;
  finishReason: string | null;
  model: string;
  startedAt: string;
  firstByteAt: string | null;
  upstreamDoneAt: string | null;
  persistedAt: string | null;
  upstreamError: string | null;
}

export async function GET(request: Request): Promise<Response> {
  const secret = request.headers.get('x-spike-secret');
  if (!secret || secret !== process.env.LOGS_SNAPSHOT_HMAC_SECRET) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const model = params.get('model') ?? 'anthropic/claude-haiku-4.5';
  const runId = params.get('runId') ?? `s4-${Date.now()}`;

  const metrics: SpikeMetrics = {
    rawBytes: 0,
    textBytes: 0,
    finishReason: null,
    model,
    startedAt: new Date().toISOString(),
    firstByteAt: null,
    upstreamDoneAt: null,
    persistedAt: null,
    upstreamError: null,
  };

  let collectResolve: (() => void) | null = null;
  const collected = new Promise<void>((resolve) => {
    collectResolve = resolve;
  });

  const started = performance.now();

  let upstream: Response;
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 6500,
        stream: true,
        messages: [{ role: 'user', content: PROMPT }],
      }),
    });
  } catch (err) {
    metrics.upstreamError = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: metrics.upstreamError }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    metrics.upstreamError = `upstream ${upstream.status}`;
    return NextResponse.json(
      { error: metrics.upstreamError },
      { status: 502 }
    );
  }

  const [clientBranch, collectBranch] = upstream.body.tee();

  // Branch 2: collect fully server-side, parse SSE lines for finish_reason.
  void (async () => {
    const reader = collectBranch.getReader();
    const decoder = new TextDecoder();
    let lineBuf = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        metrics.rawBytes += value.byteLength;
        if (metrics.firstByteAt === null) metrics.firstByteAt = new Date().toISOString();
        lineBuf += decoder.decode(value, { stream: true });
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
          try {
            const parsed: unknown = JSON.parse(trimmed.slice(6));
            const reason = (
              parsed as {
                choices?: { finish_reason?: string }[];
                error?: { message?: string };
              }
            ).choices?.[0]?.finish_reason;
            if (reason) metrics.finishReason = reason;
          } catch {
            // malformed SSE line — only finish_reason matters
          }
        }
      }
    } catch (err) {
      metrics.upstreamError = err instanceof Error ? err.message : String(err);
    } finally {
      metrics.upstreamDoneAt = new Date().toISOString();
      if (collectResolve) collectResolve();
    }
  })();

  after(async () => {
    try {
      await collected;
      metrics.persistedAt = new Date().toISOString();
      await setRedisValue(`spike:s4:${runId}`, metrics, 86400);
    } catch (err) {
      console.error('[spike-s4]', {
        message: err instanceof Error ? err.message : String(err),
        runId,
      });
    }
  });

  console.log('[spike-s4] streaming', {
    runId,
    model,
    setupMs: Math.round(performance.now() - started),
  });

  return new Response(clientBranch, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'x-spike-run-id': runId,
    },
  });
}
