import type { Context } from "hono";
import * as Sentry from "@sentry/cloudflare";
// Chat config is bundled from web/lib by esbuild (same pattern as ReasoningEngine's
// getUCISPrompt import) — the protocol/model list stays a single source of truth.
import { CHAT_PROTOCOL, CHAT_MODELS } from "../../web/lib/config/prompts";
import { CASCADE_FALLBACKS } from "../../web/lib/config/cascade";

// Deploy-time snapshot only -- see CASCADE_FALLBACKS' doc comment in cascade.ts.
// Real per-request values come from ChatStreamRequest.cascade, registry-resolved
// server-side (ProcessChatMessageUseCase via resolveChatCascade) since the worker
// has no DB access (ADR 005).
const CHAT_CASCADE = CASCADE_FALLBACKS.chat;
import { translateModelId } from "./services/model-id-translator";
import { createAtomicPersist } from "./services/atomic-persist";
import { signBoundContent, secretFingerprint } from "./crypto";
import { isProductionEnv } from "./env-utils";
import { isValidAppUrl } from "./middleware/cors";
import { buildAdaptiveOptions, getStaticOptions, type UserKnowledgeContext } from "./services/AdaptiveOptionsBuilder";

/**
 * TTL for the bound chat-persist content signature. Generous (10 min) to absorb
 * the persist retry/timeout window while still bounding replay. Mirrors the
 * analysis persist TTL and must be tolerated by the Vercel verifier.
 */
const CHAT_PERSIST_SIG_TTL_MS = 600_000;

/**
 * Direct browser->worker chat streaming. Mirrors /analyze-llm-stream: the Vercel
 * bouncer (/api/chat/.../messages) authenticates, persists the user turn to Postgres,
 * and mints an HMAC token; the browser then connects here directly so conversational
 * tokens never traverse a Vercel function (consistent edge-streaming architecture,
 * and OPENROUTER_API_KEY stays off the Vercel request path). On completion the worker
 * persists the assistant turn server-to-server to /api/chat/persist with a content
 * signature, so Postgres remains the durable source of truth.
 */

type ChatEnv = {
  STREAM_HMAC_SECRET: string;
  OPENROUTER_API_KEY: string;
  APP_URL?: string;
  ALLOWED_APP_ORIGINS?: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  DEV_HMAC_SECRET?: string;
};

interface ChatStreamRequest {
  conversationId: string;
  userId: string;
  grounding: string;
  history: Array<{ role: string; content: string }>;
  // Per-tier chat cascade resolved by the bouncer (app_settings); bound into the HMAC.
  models?: string[];
  // Full registry-resolved cascade (2026-07-25, includes providerOrder per tier) --
  // see ProcessChatMessageUseCase's resolveChatCascade(). Preferred over `models`
  // when present.
  cascade?: Array<{ model: string; name: string; cost?: number; providerOrder?: string[] }>;
  sig: string;
  exp: number;
  appUrl?: string;
  requestId?: string;
  // Optional user knowledge context for adaptive OPTIONS generation
  knowledgeContext?: UserKnowledgeContext;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const HTTP_REFERER = "https://yt-intel.getmytestdrive.com";

// HMAC-SHA256 hex — byte-identical to web/lib/stream-token.ts so the token minted on
// Vercel verifies here and the content signature verifies back on Vercel.
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Run the chat cascade, committing to the first model that produces tokens. The model
 *  list comes from the bouncer (per-tier app_settings); falls back to CHAT_MODELS. */
async function streamChatCascade(
  apiKey: string,
  grounding: string,
  history: Array<{ role: string; content: string }>,
  onDelta: (chunk: string) => void,
  models?: string[],
  cascade?: Array<{ model: string; name: string; cost?: number; providerOrder?: string[] }>,
  userId?: string,
): Promise<{ content: string; servedByModel: string | null; servedByProvider: string | null; attempts: string[] }> {
  const attempts: string[] = [];
  const messages: Array<{ role: string; content: string }> = [{ role: "system", content: CHAT_PROTOCOL }];
  if (grounding) messages.push({ role: "system", content: grounding });
  for (const m of history) messages.push({ role: m.role, content: m.content });

  const chain = cascade && cascade.length > 0
    ? cascade
    : models && models.length > 0
    ? models.map((m, idx) => {
        if (CHAT_CASCADE[idx] && CHAT_CASCADE[idx].model === m) {
          return CHAT_CASCADE[idx];
        }
        const matched = CHAT_CASCADE.find((c) => c.model === m);
        return {
          model: m,
          providerOrder: matched?.providerOrder,
        };
      })
    : CHAT_CASCADE;

  for (const { model, providerOrder } of chain) {
    let full = "";
    let servedByProvider: string | null = null;
    const translatedModel = translateModelId(model);
    attempts.push(translatedModel);
    try {
      // skipcq: JS-0827
      console.log(`[chat-cascade] Attempting model=${translatedModel} with providers=${providerOrder?.join(',') || 'default'}`);
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": "hex-yt-intel / chat-stream",
        },
        body: JSON.stringify({
          model: translatedModel,
          temperature: 0.6,
          max_tokens: 1200,
          stream: true,
          reasoning: { effort: "low" },
          messages,
          ...(userId ? { user: userId } : {}),
          provider: {
            sort: "latency",
            allow_fallbacks: false,
            ...(providerOrder ? { order: providerOrder } : {}),
          },
        }),
        signal: AbortSignal.timeout(50000),
      });
      if (!res.ok) {
        // skipcq: JS-0827
        console.warn(`[chat-cascade] Model ${translatedModel} returned ${res.status} ${res.statusText}`);
        continue; // try next model
      }
      if (!res.body) {
        // skipcq: JS-0827
        console.warn(`[chat-cascade] Model ${translatedModel} returned empty body`);
        continue;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            // OpenRouter includes the actual serving provider on each chunk once
            // routing resolves -- capture it so we know who really served the
            // request instead of just which model/providerOrder we requested.
            if (!servedByProvider && typeof json.provider === 'string') {
              servedByProvider = json.provider;
            }
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              onDelta(delta);
            }
          } catch (e) {
            /* keep-alive / partial frame */
            // skipcq: JS-0827
            console.warn("[chat-stream] JSON parse delta skipped", e instanceof Error ? e.message : String(e));
          }
        }
      }
      if (full) {
        // skipcq: JS-0827
        console.log(`[chat-cascade] Model ${translatedModel} succeeded via provider=${servedByProvider || 'unknown'} with ${full.length} chars`);
        return { content: full, servedByModel: translatedModel, servedByProvider, attempts };
      }
      // skipcq: JS-0827
      console.warn(`[chat-cascade] Model ${translatedModel} produced empty response`);
    } catch (e) {
      /* timeout / network — fall through to next model */
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = e instanceof DOMException && e.name === 'AbortError';
      // skipcq: JS-0827
      console.warn(`[chat-cascade] Model ${translatedModel} failed: ${isTimeout ? 'timeout (50s)' : msg}`);
    }
  }
  // skipcq: JS-0827
  console.error(`[chat-cascade] All models in cascade exhausted (attempted: ${attempts.join(' -> ')}), returning empty response`);
  return { content: "", servedByModel: null, servedByProvider: null, attempts };
}

export async function handleChatStream(c: Context<{ Bindings: ChatEnv }>) {
  const req = (await c.req.json()) as ChatStreamRequest;
  const secret = c.env.STREAM_HMAC_SECRET;
  const apiKey = c.env.OPENROUTER_API_KEY;

  if (!req.conversationId || !req.userId || !req.sig || !req.exp) {
    return c.json({ error: "Missing required fields" }, 400);
  }
  if (!req.requestId) {
    return c.json({ error: "Missing requestId — client cannot correlate SSE events" }, 400);
  }
  if (!isValidAppUrl(req.appUrl, c.env.APP_URL, c.env.ALLOWED_APP_ORIGINS, isProductionEnv(c.env))) {
    // skipcq: JS-0827
    console.warn("[chat-stream] Blocked untrusted appUrl callback redirect:", req.appUrl);
    return c.json({ error: "Invalid appUrl callback destination" }, 400);
  }
  if (!secret || !apiKey) {
    // skipcq: JS-0827
    console.error("[chat-stream] Server misconfigured: missing signing key or model-router credentials");
    return c.json({ error: "Server misconfigured" }, 500);
  }
  if (Date.now() > req.exp) {
    return c.json({ error: "Token expired" }, 401);
  }
  let signingKey = secret;
  let isTokenValid = false;

  // Accept the configured DEV_HMAC_SECRET as a fallback ONLY outside production
  // (local `wrangler dev` / preview). The previous code also pushed a hardcoded
  // 'dev-hmac-secret-123' — a source-visible secret that, combined with the
  // broken NODE_ENV prod check, let anyone forge a valid chat token in
  // production. That hardcoded fallback is removed; local dev must set
  // DEV_HMAC_SECRET explicitly.
  const secretsToTry = [secret];
  if (!isProductionEnv(c.env) && c.env.DEV_HMAC_SECRET) {
    secretsToTry.push(c.env.DEV_HMAC_SECRET);
  }

  for (const s of secretsToTry) {
    if (!s) continue;
    const modelStr = [...(req.models ?? [])].sort().join(',');
    const msg = `chat:${req.conversationId}:${req.userId}:${req.exp}:${modelStr}`;
    const expected = await hmacHex(s, msg);

    if (timingSafeEqualHex(expected, req.sig)) {
      signingKey = s;
      isTokenValid = true;
      break;
    }
  }

  if (!isTokenValid) {
    // Diagnostics to SERVER logs only — never echo the internal signed message
    // (conversationId/userId/exp) or the sig to the client. Secret fingerprints
    // let ops compare the Worker's secrets against the Vercel signer's without
    // logging the secrets. (Expiry is already handled earlier, so this is a
    // signature mismatch.)
    const keyFpPrimary = await secretFingerprint(secret);
    const keyFpFallback = await secretFingerprint(c.env.DEV_HMAC_SECRET);
    // skipcq: JS-0827
    console.warn("[chat-stream] stream signature rejected", {
      reason: "invalid_signature",
      conversationId: req.conversationId,
      keyFpPrimary,
      keyFpFallback,
    });
    return c.json({ error: "Invalid token", reason: "invalid_signature" }, 401);
  }

  const encoder = new TextEncoder();
  const grounding = typeof req.grounding === "string" ? req.grounding : "";
  const history = Array.isArray(req.history) ? req.history : [];

  const rawReq = c.req.raw;
  const clientSignal = rawReq.signal;

  // Stream assembly order (ENFORCED and deterministic):
  // 1. OPTIONS event (adaptive or static) — sent BEFORE any DELTA
  // 2. Streaming chat deltas (LLM completion)
  // 3. PERSIST status (saving/saved/failed)
  // 4. DONE event (stream closed)
  //
  // P0 Risk #6 Fix: Stream ordering guarantees
  // OPTIONS MUST arrive before DELTA. We enforce this by:
  // - Generating OPTIONS immediately in the stream start handler
  // - Awaiting OPTIONS completion BEFORE starting LLM cascade
  // - Adding explicit ordering checks to catch violations
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch (e) {
          /* client gone */
        }
      };

      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch (e) {
          /* client gone */
          // skipcq: JS-0827
          console.warn("[chat-stream] client disconnected during stream send", e instanceof Error ? e.message : String(e));
        }
      };

      // Emit SSE metadata frame with tier and model cascade info for client-side observability (Task 3 / D2)
      sendEvent("meta", {
        tier: req.tier || "free",
        models: req.models || [],
        cascade: req.cascade ? req.cascade.map((c) => c.model) : [],
        requestId: req.requestId,
      });

      // STAGE 1: Generate and emit OPTIONS IMMEDIATELY (blocking step)
      // This ensures OPTIONS arrive before any DELTA events.
      // We await this BEFORE starting the LLM cascade to guarantee ordering.
      // In all code paths below, OPTIONS is guaranteed to be sent before proceeding.
      try {
        const currentTopic = history && history.length > 0
          ? history[history.length - 1]?.content || ""
          : grounding;
        const adaptiveOptions = await buildAdaptiveOptions(req.knowledgeContext, currentTopic);

        // Emit adaptive options if generated
        if (adaptiveOptions && adaptiveOptions.length > 0) {
          send({ type: "options", content: adaptiveOptions, requestId: req.requestId });
        } else {
          // Fallback to static options if adaptive generation produced nothing
          send({ type: "options", content: getStaticOptions(), requestId: req.requestId });
        }
      } catch (err) {
        // On error, always send static fallback to ensure OPTIONS are sent
        const msg = err instanceof Error ? err.message : String(err);
        Sentry.captureException(err, { contexts: { chat: { conversationId: req.conversationId, requestId: req.requestId, action: 'buildAdaptiveOptions' } } });
        // skipcq: JS-0827
        console.warn("[chat-stream] OPTIONS generation failed, sending static fallback", {
          conversationId: req.conversationId,
          error: msg,
        });
        send({ type: "options", content: getStaticOptions(), requestId: req.requestId });
      }

      // STAGE 2: Stream chat deltas (LLM completion)
      // OPTIONS have been sent; now safe to start LLM cascade.
      // DELTAs will arrive after OPTIONS.
      let full = "";
      let servedByModel: string | null = null;
      let servedByProvider: string | null = null;
      let cascadeAttempts: string[] = [];
      try {
        const result = await streamChatCascade(apiKey, grounding, history, (chunk) => {
          send({ type: "delta", content: chunk, requestId: req.requestId });
        }, req.models, req.cascade, req.userId);
        full = result.content;
        servedByModel = result.servedByModel;
        servedByProvider = result.servedByProvider;
        cascadeAttempts = result.attempts;
        if (!full) {
          full = "Sorry, I couldn't generate a response. All fallback models failed to respond. Please check your internet connection and try again.";
          send({ type: "delta", content: full, requestId: req.requestId });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Sentry.captureException(err, { contexts: { chat: { conversationId: req.conversationId, requestId: req.requestId, action: 'streamChatCascade' } } });
        // skipcq: JS-0827
        console.error("[chat-stream] streamChatCascade failed:", msg);
        full = "The model request failed. Your message is saved — please try again.";
        send({ type: "delta", content: full, requestId: req.requestId });
      }
      // Structured, queryable-once-persisted (Workers Logs) record of exactly who
      // served this request, so "why did it fall back" is a log query, not a guess.
      // skipcq: JS-0827
      console.log("[chat-cascade:summary]", {
        conversationId: req.conversationId,
        requestId: req.requestId,
        servedByModel,
        servedByProvider,
        attempts: cascadeAttempts,
      });

      // STAGE 3: Persist chat content server-to-server
      let hasSaved = false;

      const atomicPersist = createAtomicPersist({
        hasContent: () => full.length > 0,
        persist: async (status) => {
          if (hasSaved) return false;
          send({ type: "persist", status: "saving", requestId: req.requestId });
          // Bind the persist signature to this conversation + an expiry so an
          // observed body can't be replayed. Verified on Vercel by verifyContentSig.
          const persistExp = Date.now() + CHAT_PERSIST_SIG_TTL_MS;
          const contentSig = await signBoundContent(signingKey, "chat-persist", req.conversationId, persistExp, full);
          const appUrl = req.appUrl || c.env.APP_URL || "https://yt-intel.getmytestdrive.com";

          try {
            const res = await fetch(`${appUrl}/api/chat/persist`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                conversationId: req.conversationId,
                userId: req.userId,
                content: full,
                contentSig,
                exp: persistExp,
                status,
              }),
              // 10s server-side timeout; AbortSignal.timeout throws a TimeoutError.
              signal: AbortSignal.timeout(10_000),
            });
            if (res.ok) {
              hasSaved = true;
              send({ type: "persist", status: "saved", requestId: req.requestId });
            } else {
              send({ type: "persist", status: "failed", requestId: req.requestId });
            }
            return hasSaved;
          } catch (e) {
            send({ type: "persist", status: "failed", requestId: req.requestId });
            const isTimeout = e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");
            const reason = isTimeout ? "persist_timeout" : "persist_error";
            const message = e instanceof Error ? e.message : String(e);
            Sentry.captureException(e, { contexts: { chat: { conversationId: req.conversationId, requestId: req.requestId, action: 'chatPersist', reason } } });
            // skipcq: JS-0827
            console.error("[chat-stream]", { reason, message, conversationId: req.conversationId });
            return false;
          }
        },
        signal: clientSignal,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });

      // RCA (2026-07-24): must await -- flush() used to fire-and-forget via
      // waitUntil while this function closed the SSE stream immediately after,
      // so the 'persist'/'saved'/'failed' frames written inside persistFn()
      // were enqueued on an already-closed controller and never reached the
      // client. Every chat message hit the client's 8s "stuck at saving"
      // watchdog as a result -- not intermittent, the only path that ever fired.
      await atomicPersist.flush();

      // STAGE 4: Emit DONE event (stream closed)
      send({ type: "done", requestId: req.requestId });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}


