import type { Context } from "hono";
import * as Sentry from "@sentry/cloudflare";
// Chat config is bundled from web/lib by esbuild (same pattern as ReasoningEngine's
// getUCISPrompt import) — the protocol/model list stays a single source of truth.
import { CHAT_PROTOCOL, CHAT_MODELS } from "../../web/lib/config/prompts";
import { CHAT_CASCADE } from "../../web/lib/config/cascade";
import { translateModelId } from "./services/model-id-translator";
import { createAtomicPersist } from "./services/atomic-persist";
import { signBoundContent, secretFingerprint } from "./crypto";
import { isProductionEnv } from "./env-utils";

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
  sig: string;
  exp: number;
  appUrl?: string;
  requestId?: string;
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

function isValidAppUrl(
  urlStr: string | undefined,
  envAppUrl: string | undefined,
  allowedOrigins?: string,
  isProd?: boolean
): boolean {
  if (!urlStr) return true;

  try {
    const parsedUrl = new URL(urlStr);
    const origin = parsedUrl.origin.toLowerCase();

    // 1. If it matches envAppUrl's origin, it's safe
    if (envAppUrl) {
      const parsedEnv = new URL(envAppUrl);
      if (origin === parsedEnv.origin.toLowerCase()) {
        return true;
      }
    }

    // 2. Check explicitly allowed origins from env
    if (allowedOrigins) {
      const list = allowedOrigins.split(",").map((o) => o.trim().toLowerCase());
      if (list.includes(origin)) {
        return true;
      }
    }

    // 3. For non-production/preview environments, OR if it's a vercel preview domain, OR it's the prod domain, allow
    const hostname = parsedUrl.hostname.toLowerCase();
    if (!isProd || hostname.endsWith(".vercel.app") || hostname === "yt-intel.getmytestdrive.com") {
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.endsWith(".vercel.app") ||
        hostname === "yt-intel.getmytestdrive.com"
      ) {
        return true;
      }
    }
  } catch (e) {
    return false;
  }

  return false;
}

/** Run the chat cascade, committing to the first model that produces tokens. The model
 *  list comes from the bouncer (per-tier app_settings); falls back to CHAT_MODELS. */
async function streamChatCascade(
  apiKey: string,
  grounding: string,
  history: Array<{ role: string; content: string }>,
  onDelta: (chunk: string) => void,
  models?: string[],
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [{ role: "system", content: CHAT_PROTOCOL }];
  if (grounding) messages.push({ role: "system", content: grounding });
  for (const m of history) messages.push({ role: m.role, content: m.content });

  const chain = models && models.length > 0
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
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 50000);
    let full = "";
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": HTTP_REFERER,
        },
        body: JSON.stringify({
          model: translateModelId(model),
          temperature: 0.6,
          max_tokens: 1200,
          stream: true,
          reasoning: { effort: "low" },
          messages,
          provider: {
            sort: "latency",
            allow_fallbacks: false,
            ...(providerOrder ? { order: providerOrder } : {}),
          },
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        continue; // try next model
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
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              onDelta(delta);
            }
          } catch (e) {
            /* keep-alive / partial frame */
            console.warn("[chat-stream] JSON parse delta skipped", e instanceof Error ? e.message : String(e));
          }
        }
      }
      if (full) return full; // committed to this model
    } catch (e) {
      /* timeout / network — fall through to next model */
      console.error("[chat-stream] model cascade fetch failed, trying next", e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(t);
    }
  }
  return "";
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
    console.warn("[chat-stream] Blocked untrusted appUrl callback redirect:", req.appUrl);
    return c.json({ error: "Invalid appUrl callback destination" }, 400);
  }
  if (!secret || !apiKey) {
    console.error("[chat-stream] Server misconfigured: missing STREAM_HMAC_SECRET or OPENROUTER_API_KEY");
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
    console.warn("[chat-stream] stream token rejected", {
      reason: "invalid_signature",
      conversationId: req.conversationId,
      workerSecretFp: await secretFingerprint(secret),
      workerDevSecretFp: await secretFingerprint(c.env.DEV_HMAC_SECRET),
    });
    return c.json({ error: "Invalid token", reason: "invalid_signature" }, 401);
  }

  const encoder = new TextEncoder();
  const grounding = typeof req.grounding === "string" ? req.grounding : "";
  const history = Array.isArray(req.history) ? req.history : [];

  const rawReq = c.req.raw;
  const clientSignal = rawReq.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch (e) {
          /* client gone */
          console.warn("[chat-stream] client disconnected during stream send", e instanceof Error ? e.message : String(e));
        }
      };

      let full = "";
      try {
        full = await streamChatCascade(apiKey, grounding, history, (chunk) => {
          send({ type: "delta", content: chunk, requestId: req.requestId });
        }, req.models);
        if (!full) {
          full = "No response generated.";
          send({ type: "delta", content: full, requestId: req.requestId });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        Sentry.captureException(err, { contexts: { chat: { conversationId: req.conversationId, requestId: req.requestId, action: 'streamChatCascade' } } });
        console.error("[chat-stream] streamChatCascade failed:", msg);
        full = "The model request failed. Your message is saved — please try again.";
        send({ type: "delta", content: full, requestId: req.requestId });
      }

      let persisted = false;

      const atomicPersist = createAtomicPersist({
        hasContent: () => full.length > 0,
        persist: async (status) => {
          if (persisted) return false;
          send({ type: "persist", status: "saving", requestId: req.requestId });
          // Bind the persist signature to this conversation + an expiry so an
          // observed body can't be replayed. Verified on Vercel by verifyContentSig.
          const persistExp = Date.now() + CHAT_PERSIST_SIG_TTL_MS;
          const contentSig = await signBoundContent(signingKey, "chat-persist", req.conversationId, persistExp, full);
          const appUrl = req.appUrl || c.env.APP_URL || "https://yt-intel.getmytestdrive.com";

          const persistController = new AbortController();
          const timeout = setTimeout(() => persistController.abort(), 10_000);

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
              signal: persistController.signal,
            });
            if (res.ok) {
              persisted = true;
              send({ type: "persist", status: "saved", requestId: req.requestId });
            } else {
              send({ type: "persist", status: "failed", requestId: req.requestId });
            }
            return persisted;
          } catch (e) {
            send({ type: "persist", status: "failed", requestId: req.requestId });
            const isAbort = e instanceof DOMException && e.name === "AbortError";
            const reason = isAbort ? "persist_timeout" : "persist_error";
            const message = e instanceof Error ? e.message : String(e);
            console.error("[chat-stream]", { reason, message, conversationId: req.conversationId });
            return false;
          } finally {
            clearTimeout(timeout);
          }
        },
        signal: clientSignal,
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });

      atomicPersist.flush();

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


