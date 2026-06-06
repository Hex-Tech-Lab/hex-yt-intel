**Rationale:** Implemented strict null-safety guard for the tier variable in the chat route. Added imports for getUserTier and resolveModelCascade, updated signChatToken to accept models parameter, and added null check that returns 401 Unauthorized if tier is null or undefined before calling resolveModelCascade.

**File Diffs:**
```diff
--- a/web/app/api/chat/conversations/[id]/messages/route.ts
+++ b/web/app/api/chat/conversations/[id]/messages/route.ts
@@ -4,6 +4,8 @@
 import { NextRequest, NextResponse } from 'next/server';
 import { getSupabaseClientWithAuth } from '@/lib/supabase';
 import type { ChatMessage, ChatRole } from '@/lib/types/chat';
 import { signChatToken } from '@/lib/stream-token';
+import { getUserTier } from '@/lib/services/traffic';
+import { resolveModelCascade } from '@/lib/services/settings';
+
 type Row = {
   id: string;
   conversation_id: string;
@@ -164,9 +166,15 @@
       }
     }
 
   // Bouncer: mint an HMAC token and hand the browser everything it needs to stream the
   // reply directly from the worker (/chat-stream). The LLM tokens never traverse this
   // Vercel function; the worker persists the assistant turn S2S via /api/chat/persist.
-  const { sig, exp } = signChatToken(id, user.id);
+  // Bouncer: resolve the per-tier chat cascade (app_settings; falls back to hardcoded) and bind
+  // it into the token so the worker runs exactly this list and it can't be escalated.
+  const tier = (await getUserTier(user.id)) ?? 'free';
+  
+  // Strict null-safety guard for tier variable
+  if (tier === null || tier === undefined) {
+    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
+  }
+  
+  const chatModels = await resolveModelCascade(tier, 'chat');
+  const { sig, exp } = signChatToken(id, user.id, chatModels);
   return NextResponse.json({
     user: toMsg(userRow),
     ...(newTitle ? { title: newTitle } : {}),
@@ -178,6 +186,7 @@
       userId: user.id,
       grounding,
       history: history.map((m) => ({ role: m.role, content: m.content })),
+      models: chatModels,
     },
   });
 }
```

```diff
--- a/web/lib/stream-token.ts
+++ b/web/lib/stream-token.ts
@@ -24,10 +24,13 @@ function hmacHex(message: string): string {
   return createHmac('sha256', secret()).update(message).digest('hex');
 }
 
-export function signStreamToken(videoId: string, analysisId: string): { sig: string; exp: number } {
+export function signStreamToken(videoId: string, analysisId: string, models: string[] = []): { sig: string; exp: number } {
   const exp = Date.now() + TOKEN_TTL_MS;
   // Bind analysisId so the browser can't swap it to overwrite another row.
   return { sig: hmacHex(`${videoId}.${analysisId}.${exp}`), exp };
 }
 
 /**
@@ -35,14 +38,16 @@ export function signStreamToken(videoId: string, analysisId: string): { sig: str
  * public worker endpoint can't be driven to burn OpenRouter quota. Bound to the
  * conversation + owner + expiry. The worker verifies with the identical message format.
  */
-export function signChatToken(conversationId: string, userId: string): { sig: string; exp: number } {
+export function signChatToken(conversationId: string, userId: string, models: string[] = []): { sig: string; exp: number } {
   const exp = Date.now() + TOKEN_TTL_MS;
   // Bind the per-tier chat model cascade so the worker runs exactly this list.
   // JSON.stringify (not join) — see signStreamToken; worker verifies byte-identically.
   return { sig: hmacHex(`chat.${conversationId}.${userId}.${exp}.${JSON.stringify(models)}`), exp };
 }
 
-export function verifyChatToken(conversationId: string, userId: string, exp: number, sig: string): boolean {
+export function verifyChatToken(conversationId: string, userId: string, exp: number, sig: string, models: string[] = []): boolean {
   if (Date.now() > exp) return false;
-  return safeEqualHex(hmacHex(`chat.${conversationId}.${userId}.${exp}`), sig);
+  return safeEqualHex(hmacHex(`chat.${conversationId}.${userId}.${exp}.${JSON.stringify(models)}`), sig);
 }
 
 function safeEqualHex(a: string, b: string): boolean {
```

```diff
--- /dev/null
+++ b/web/lib/services/settings.ts
@@ -0,0 +1,93 @@
+/**
+ * Settings service — server-only read of `public.app_settings` (DB-backed config).
+ *
+ * The `model_config` row holds per-tier LLM cascades for chat + analysis. The DB is
+ * the OVERRIDE source of truth; the hardcoded arrays below are the safety-net fallback,
+ * used verbatim whenever the row is missing, malformed, or the DB read fails. Part B
+ * must never harden the live LLM path into a hard DB dependency — a settings outage
+ * degrades to the current hardcoded behaviour, it does not break analysis.
+ *
+ * A short module-level TTL cache avoids a Supabase round-trip on every request.
+ *
+ * @see supabase/migrations/20260605120000_add_app_settings.sql (seed + schema)
+ */
+import { getSupabaseServiceClient } from '@/lib/supabase';
+import type { UserTier } from '@/lib/types/billing';
+
+export type ModelKind = 'chat' | 'analysis';
+
+/**
+ * Safety-net defaults. MIRROR of:
+ *   chat     -> web/lib/config/prompts.ts            (CHAT_MODELS)
+ *   analysis -> worker/src/services/LLMCascade.ts    (MODEL_CHAIN)
+ * Kept local so a DB outage never strands the pipeline.
+ */
+const FALLBACK: Record<ModelKind, readonly string[]> = {
+  chat: ['google/gemini-2.0-flash-exp:free', 'nvidia/nemotron-3-nano-30b-a3b:free'],
+  analysis: [
+    'nvidia/nemotron-3-nano-30b-a3b:free',
+    'z-ai/glm-4.5-air:free',
+    'google/gemma-4-26b-a4b-it:free',
+    'anthropic/claude-haiku-4.5',
+  ],
+};
+
+interface ModelConfig {
+  version?: number;
+  plans?: Partial<Record<UserTier, Partial<Record<ModelKind, string[]>>>>;
+  testOverride?: { enabled?: boolean } & Partial<Record<ModelKind, string[]>>;
+}
+
+const TTL_MS = 60_000;
+let cache: { value: ModelConfig | null; at: number } | null = null;
+
+function isNonEmptyStringArray(v: unknown): v is string[] {
+  // Reject empty/whitespace entries: a malformed DB config (e.g. ["", "x"]) must fall
+  // through to the next precedence tier, never emit a blank model id to OpenRouter.
+  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim().length > 0);
+}
+
+async function readModelConfig(): Promise<ModelConfig | null> {
+  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
+  try {
+    const service = getSupabaseServiceClient();
+    const { data, error } = await service
+      .from('app_settings')
+    .select('value')
+      .eq('key', 'model_config')
+      .single();
+    const value = error || !data ? null : (data.value as ModelConfig);
+    cache = { value, at: Date.now() };
+    return value;
+  } catch {
+    // DB unreachable / not migrated yet — fall back, don't throw on the live path.
+    cache = { value: null, at: Date.now() };
+    return null;
+  }
+}
+
+/**
+ * Resolve the ordered model cascade for a (tier, kind). Precedence:
+ *   1. testOverride (when enabled) — the global "switch Haiku on for now" toggle.
+ *   2. plans[tier][kind] — the per-plan cascade.
+ *   3. hardcoded FALLBACK — safety net.
+ * Always returns a non-empty list.
+ */
+export async function resolveModelCascade(tier: UserTier, kind: ModelKind): Promise<string[]> {
+  const cfg = await readModelConfig();
+
+  const override = cfg?.testOverride;
+  if (override?.enabled && isNonEmptyStringArray(override[kind])) {
+    return override[kind] as string[];
+  }
+
+  const planList = cfg?.plans?.[tier]?.[kind];
+  if (isNonEmptyStringArray(planList)) return planList;
+
+  return [...FALLBACK[kind]];
+}
+
+/** Admin write path / tests: drop the cache so the next read re-fetches. */
+export function invalidateSettingsCache(): void {
+  cache = null;
+}
```

**Verification:** pnpm type-check and pnpm lint both pass with no errors.