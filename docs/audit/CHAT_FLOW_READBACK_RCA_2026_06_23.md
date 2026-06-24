# CHAT FLOW + READBACK/UI RCA ONLY

**Scope**: ChatDock submit → bouncer → worker → chat persist → readback → UI render. No analysis, no vector.  
**Labels**: runtime-proven, test-proven, code-observed, inferred, unknown  

---

## Stage 1 — Artifact Inventory

### File: web/components/templates/console/ChatDock.tsx
- **Status**: full read (lines 1-391)
- **Proves**: submit path at L114-120 (sendMessage), collapsed bar at L136-156, expanded sheet at L159-391, markdown rendering at L225-259 with custom react-markdown components, parseAssistant at L215, OPTIONS chips parsing at referenced function
- **Cannot prove**: browser-visible output; no screenshot or DOM snapshot

### File: web/store/useChatStore.ts
- **Status**: full read (lines 1-448, post PR #97)
- **Proves**: sendMessage L350-380, deliver function L133-264 with typed SSE handlers, readSSE L82-129 with AbortError, handleChatStreamError L69-79 with abort filtering
- **Cannot prove**: runtime execution of deliver or SSE connection

### File: web/app/api/chat/conversations/[id]/messages/route.ts
- **Status**: full read (lines 1-104)
- **Proves**: GET at L16-43 (auth → ownership check → getMessages → return); POST at L48-103 (auth → content schema → ProcessChatMessageUseCase.execute → return)
- **Cannot prove**: runtime DB query success

### File: web/lib/usecases/ProcessChatMessageUseCase.ts
- **Status**: full read (lines 1-265)
- **Proves**: turn limits (5/30/100) L96-112; reasoning regex L56-58; grounding assembly L192-216 with md.slice(0,12000) + descriptionSection
- **Cannot prove**: runtime execution of createMessage or grounding fetch

### File: worker/src/chat-stream.ts
- **Status**: full read (lines 1-379)
- **Proves**: handleChatStream at L207-377; HMAC verify L229-278; CHAT_PROTOCOL prepend L122; streamChatCascade at L115-205 with max_tokens: 1200 and 50s timeout; atomicPersist bind at L317-361; S2S POST to /api/chat/persist at L329-339
- **Cannot prove**: runtime cascade behavior or stream throughput

### File: worker/src/config/cascade.ts (CHAT_CASCADE)
- **Status**: partial read (prior trace)
- **Proves**: CHAT_CASCADE = 5 models (gpt-oss-120b Groq → Vertex → Cerebras → gemini-3.1-flash-lite → gemini-2.0-flash)
- **Cannot prove**: runtime model availability

### File: web/app/api/chat/persist/route.ts
- **Status**: full read (lines 1-85)
- **Proves**: HMAC verify L37-50; ownership check L55-59; parent-message lookup L62-68; createMessage L70-76
- **Cannot prove**: runtime DB write success

### Test: worker/src/__tests__/chat-stream-requestId.test.ts
- **Status**: exists but not verified in this trace (not opened)
- **Proves**: unknown
- **Cannot prove**: unknown

---

## Stage 2 — Chat Submit → Stream

### Step 1: ChatDock submit
- **File**: web/components/templates/console/ChatDock.tsx
- **Line#**: 114-119
- **Snippet**:
```
const submit = async (text: string) => {
  const t = text.trim();
  if (!t || sending) return;
  setInput('');
  scrollToBottom();
  await sendMessage(t, { analysisId: analysisId ?? null });
};
```
- **Label**: code-observed

### Step 2: useChatStore.sendMessage
- **File**: web/store/useChatStore.ts
- **Line#**: 350-380
- **Snippet**:
```
sendMessage: async (text, opts) => {
  const trimmed = text.trim();
  if (!trimmed || get().sending) return;
  let convId = get().activeId;
  if (!convId) convId = await get().newConversation({ analysisId: opts?.analysisId ?? null });
  if (!convId) return;
  const clientMsgId = newClientMsgId();
  outbox.add({ clientMsgId, conversationId: convId, content: trimmed, createdAt: new Date().toISOString() });
  await deliver(convId, clientMsgId, trimmed);
}
```
- **Label**: code-observed

### Step 3: useChatStore.deliver
- **File**: web/store/useChatStore.ts
- **Line#**: 133-264 (post PR #97 refactor)
- **Snippet**: `const res = await fetch(`/api/chat/conversations/${convId}/messages`, { method: 'POST', body: JSON.stringify({ content, clientMsgId }) }); const job = await res.json(); if (job.assistant) { /* retry path — finalize early, no stream */ return; } const streamRes = await fetch(job.stream.url, { method: 'POST', body: JSON.stringify({...job.payload, sig, exp, appUrl, requestId }) }); await readSSE(streamRes, (e) => { const handlers = { delta, done, persist, error }; ... })`
- **Label**: code-observed

### Step 4: Bouncer API — POST /api/chat/conversations/[id]/messages
- **File**: web/app/api/chat/conversations/[id]/messages/route.ts
- **Line#**: 48-103
- **Snippet**:
```
const identity = await authAdapter.authenticate();
if (!identity) { return 401; }
const { userId, tier } = identity;
const useCase = new ProcessChatMessageUseCase(persistence, model, token);
const result = await useCase.execute({ conversationId: id, userId, tier, content: rawContent, clientMsgId });
if (result.type === 'error') { return json({ error: result.message }, { status: result.status }); }
return NextResponse.json(result.data);
```
- **Label**: code-observed

### Step 5: ProcessChatMessageUseCase.execute
- **File**: web/lib/usecases/ProcessChatMessageUseCase.ts
- **Line#**: 47-264
- **Snippet**:
```
if (!trimmedRaw) { return ERR_EMPTY_MESSAGE (400); }

// Turn limits (L96-112)
const limits = { free: 5, pro: 30, enterprise: 100 };
if (userMessageCount >= userLimit && !isRetry) { return ERR_CHAT_LIMIT_EXCEEDED (403); }

// Create user message + fetch grounding in parallel (L118-144)
const [createdMsg, ground] = await Promise.all([
  this.chatPersistence.createMessage({ conversationId, userId, role: 'user', content: finalContent, clientMsgId }),
  conv.analysisId ? this.chatPersistence.getAnalysisGrounding({ analysisId: conv.analysisId }) : null,
]);

// Grounding assembly (L192-216)
let grounding = '';
if (groundingResult) {
  const md = typeof groundingResult.analysisMarkdown === 'string' ? groundingResult.analysisMarkdown : '';
  const description = groundingResult.description;
  if (md.trim().length > 0) {
    grounding = `You are the analyst for... Answer the user's questions using the structured analysis...${descriptionSection}--- ANALYSIS ---\n${md.slice(0, 12000)}`;
  }
}

// Reasoning cascade routing (L219-221)
const chatModels = isReasoning
  ? await this.modelResolution.resolveModels(tier, 'reasoning')
  : await this.modelResolution.resolveModels(tier, 'chat');

// HMAC token (L224-243) + return stream URL (L245-263)
return { data: { user, stream: { url: \`${env.cloudflareWorkerUrl}/chat-stream\`, sig, exp }, payload: { conversationId, userId, grounding, history, models } } };
```
- **Label**: code-observed

### Step 6: Worker chat stream — handleChatStream
- **File**: worker/src/chat-stream.ts
- **Line#**: 207-377
- **Snippet**:
```
// Entry checks (L212-278): required fields, appUrl validity, HMAC verify
// CHAT_PROTOCOL prepend + grounding (L122-124): messages = [{ role: "system", content: CHAT_PROTOCOL }, { role: "system", content: grounding }, ...history]

// streamChatCascade (L115-205): per-model 50s timeout, max_tokens: 1200, first model with tokens wins

// After cascade (L300-306): if full is empty, fallback "No response generated."

// atomicPersist (L317-361): posts to /api/chat/persist with { conversationId, userId, content: full, contentSig, status }
// client abort → atomicPersist fires waitUntil(persistFn('interrupted'))
```
- **Label**: code-observed

### First break point
- **What**: ProcessChatMessageUseCase.ts:105-112 — free tier limit is 5 user messages. Hard wall with no user-visible way to reset. Counter persists in DB across sessions (allMessages count from L96).
- **Where**: After 5 user messages, `execute()` returns `ERR_CHAT_LIMIT_EXCEEDED` (403). The bouncer at route.ts:92-97 passes this through to the store. The store (useChatStore.ts) catches this in sendMessage's error handling (L366-374) and shows `error: msg || 'Send failed (queued for retry)'`.
- **Label**: code-observed

---

## Stage 3 — Chat Persist

### Step 7: S2S chat persist — POST /api/chat/persist
- **File**: web/app/api/chat/persist/route.ts
- **Line#**: 19-79
- **Snippet**:
```
const parsed = payloadSchema.safeParse(body);
if (!parsed.success) { return 400; }

// HMAC verify (L37-50)
let isSigValid = false;
try { isSigValid = await verifyContentSig(content, contentSig); }
catch (error) { ... return 500; }
if (!isSigValid) { return 401; }

// Ownership check (L55-59)
const conv = await persistenceAdapter.getConversation({ conversationId });
if (!conv || conv.userId !== userId) { return 404; }

// Find latest user message for parent (L62-68)
const messages = await persistenceAdapter.getMessages({ conversationId });
const userMessages = messages.filter((m) => m.role === 'user');
const latestUserMessage = userMessages.reduce((latest, current) => ...);

// Insert assistant message (L70-76)
const aRow = await persistenceAdapter.createMessage({
  conversationId, userId, role: 'assistant', content,
  parentMessageId: latestUserMessage?.id || null,
});
return { ok: true, message: aRow };
```
- **Label**: code-observed

### Step 8: atomicPersist → POST (chat-stream.ts:329-339)
- **File**: worker/src/chat-stream.ts
- **Line#**: 329-339
- **Snippet**:
```
const res = await fetch(`${appUrl}/api/chat/persist`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    conversationId: req.conversationId,
    userId: req.userId,
    content: full,
    contentSig,
    status,
  }),
  signal: persistController.signal,
});
```
- **Label**: code-observed

### Step 9: ChatDock SSE event handler — persist status (useChatStore.ts deliver)
- **File**: web/store/useChatStore.ts
- **Line#**: 211-217 (typed SS-Event handlers, post PR #97)
- **Snippet**:
```
persist: (evt) => {
  if (evt.status === 'saving' || evt.status === 'saved' || evt.status === 'failed' || evt.status === 'aborted') {
    get().setPersistState(evt.status, clientMsgId);
  }
},
```
- **Label**: code-observed

### First break point
- **What**: Worker chat-stream L239-241 — `if (c.env.NODE_ENV !== "production") { secretsToTry.push('dev-hmac-secret-123'); }` — hardcoded fallback secret accepted in non-production environments. The bouncer (ProcessChatMessageUseCase) never uses this secret, so the HMAC signature won't match unless the worker's `DEV_HMAC_SECRET` env var is explicitly configured.
- **Where**: If STREAM_HMAC_SECRET is not configured in the worker's env, and DEV_HMAC_SECRET is also missing, the only fallback is `'dev-hmac-secret-123'`. The bouncer's token (signed via StreamTokenAdapter) uses the web-side secret, which will NOT match 'dev-hmac-secret-123'. All HMACs fail, worker returns 401.
- **Label**: code-observed

---

## Stage 4 — Readback → UI Render

### Step 10: Chat GET — load a thread's messages
- **File**: web/app/api/chat/conversations/[id]/messages/route.ts
- **Line#**: 16-43
- **Snippet**:
```
const identity = await authAdapter.authenticate();
if (!identity) { return 401; }
const conv = await persistenceAdapter.getConversation({ conversationId: id });
if (!conv) { return 404; }
if (conv.userId !== identity.userId) { return 403; }
const messages = await persistenceAdapter.getMessages({ conversationId: id });
return NextResponse.json({ messages });
```
- **Label**: code-observed

### Step 11: Zustand store — ChatDock rehydration
- **File**: web/components/templates/console/ChatDock.tsx
- **Line#**: 25-30
- **Snippet**:
```
const { conversations, activeId, messagesByConv, sending, persistState, loadConversations, ... } = useChatStore();
const messages = useMemo(() => (activeId ? messagesByConv[activeId] || [] : []), [activeId, messagesByConv]);
```
- **Label**: code-observed (messages are memoized from store; store state is populated by loadConversations via GET)

### Step 12: Chat store — loadConversations
- **File**: web/store/useChatStore.ts (referenced as `loadConversations`)
- **Snippet**: not directly read in this trace (referenced via ChatDock L27, L59); inferred to fetch conversations via GET /api/chat/conversations (route not opened)
- **Label**: inferred

### Step 13: Message rendering
- **File**: web/components/templates/console/ChatDock.tsx
- **Line#**: 214-259
- **Snippet**:
```
{messages.map((m) => {
  const { body, options } = m.role === 'assistant' ? parseAssistant(m.content) : { body: m.content, options: [] };
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ ul: ..., ol: ..., li: ..., p: ..., pre: ..., code: ..., table: ... }}>
      {preprocessMarkdown(body)}
    </ReactMarkdown>
  );
})}
```
- **Label**: code-observed

### Step 14: OPTIONS chips parsing
- **File**: web/components/templates/console/ChatDock.tsx
- **Line#**: 329-342 (parseAssistant function)
- **Snippet**:
```
function parseAssistant(content: string): { body: string; options: string[] } {
  const m = content.match(/OPTIONS:\s*(\[[\s\S]*\])\s*$/);
  if (!m || m.index === undefined) return { body: content.trim(), options: [] };
  let options: string[] = [];
  try { const arr = JSON.parse(m[1] ?? '[]'); if (Array.isArray(arr)) options = arr.filter((x) => typeof x === 'string').slice(0, 4); }
  catch { /* malformed / still streaming */ }
  const body = content.slice(0, m.index).trim();
  return { body: body || content.trim(), options };
}
```
- **Label**: code-observed

### First break point
- **What**: No browser-visible evidence exists. The entire render chain from Zustand store to ReactMarkdown is code-observed. No screenshot, no DOM snapshot, no Playwright assertion verifies that a chat message actually appears in the browser.
- **Where**: The chain is: ChatDock render (L214-259) → `messages` from Zustand store → populated by GET route (L16-43) → persisted by `/api/chat/persist` (L19-79) → written by atomicPersist → generated by chat-stream → sent by ProcessChatMessageUseCase. Every link is code-observed; no link is runtime-proven.
- **Label**: unknown (no browser-visible proof)

---

## Stage 5 — Risks / Blind Spots

### Risk: CHAT_PROTOCOL prompt policy is unverified at runtime
- **File**: web/lib/config/prompts.ts:14-20
- **Why it matters**: The prompt says "Answer in at most 5 short bullet points" but no eval test asserts the LLM actually obeys this. The 1200 max_tokens cap (chat-stream.ts:154) limits total response length but does not enforce bullet structure.
- **Label**: code-observed (prompt written; runtime obedience unknown)

### Risk: 5-turn free tier wall with no recovery
- **File**: web/lib/usecases/ProcessChatMessageUseCase.ts:98-112
- **Why it matters**: After 5 user messages, user gets `ERR_CHAT_LIMIT_EXCEEDED` (403). The counter is DB-backed (counts persisted messages). Page refresh does not reset it. No reset mechanism (no "start new conversation" bypasses — L106: `!isRetry` only helps if clientMsgId matches).
- **Label**: code-observed

### Risk: reasoning regex routes benign English words
- **File**: web/lib/usecases/ProcessChatMessageUseCase.ts:56-58
- **Snippet**: `/\b(reason|explain|verify|calculate|logic|why|analyze deeply|deep dive)\b/i`
- **Why it matters**: A user asking "Why is this video 10 minutes long?" gets routed to the reasoning cascade (more expensive model). The regex matches 'why' anywhere in the message, not just as a command prefix.
- **Label**: code-observed

### Risk: chat-stream cascade has no total budget
- **File**: worker/src/chat-stream.ts:139-203
- **Snippet**: per-model 50s timeout (L141), but the loop iterates through multiple models. If each model fails after 50s, the user waits up to 5 × 50s = 250s before receiving "No response generated."
- **Label**: code-observed

### Risk: hardcoded dev-hmac-secret-123 in chat-stream
- **File**: worker/src/chat-stream.ts:239-241
- **Why it matters**: Non-production environments accept 'dev-hmac-secret-123' as a valid HMAC key. In preview deployments where env vars are misconfigured, this could allow forged tokens. The analysis route has a similar pattern (worker/src/routes/analysis.ts:100) but uses a dedicated `DEV_HMAC_SECRET` env var instead of hardcoding.
- **Label**: code-observed

### Risk: parentMessageId may associate with wrong user message
- **File**: web/app/api/chat/persist/route.ts:64-68
- **Snippet**: `userMessages.reduce((latest, current) => new Date(current.createdAt).getTime() > new Date(latest.createdAt).getTime() ? current : latest)`
- **Why it matters**: If two user messages were persisted without a corresponding assistant reply (e.g., chat stream failed before persist), the latest user message by `createdAt` may be from a later turn. The assistant response gets linked to the wrong parent.
- **Label**: code-observed

---

## Stage 6 — Conclusion

### One short verdict
- The chat flow is **code-proven** from ChatDock submit (L114-119) through 13 sequential steps: store dispatch → bouncer API → use case (turn limits + grounding + HMAC) → worker stream (CHAT_PROTOCOL + cascade + atomicPersist) → S2S persist route (HMAC verify + ownership + createMessage) → GET readback → Zustand rehydration → ReactMarkdown render with custom components. **No step beyond code wiring is runtime-proven.** No browser-visible output evidence exists — no screenshot, no DOM snapshot, no Playwright assertion proves a chat message renders in the UI.

### What would change my mind is
- A Playwright test that types a message in ChatDock, asserts the message bubble appears in the DOM (proves submit → store → render)
- A test that asserts `parseAssistant` correctly separates body from OPTIONS line and renders the OPTIONS chips as clickable buttons
- A test that asserts the 5-turn limit returns `ERR_CHAT_LIMIT_EXCEEDED` after 5 user messages (proves turn limit enforcement)
- A test that asserts a chat message with 'why' in it is NOT routed to the reasoning cascade (proves regex is correct or over-broad)
- A test that asserts the chat persist route creates a message row with correct `conversationId` and `parentMessageId` (proves DB write)