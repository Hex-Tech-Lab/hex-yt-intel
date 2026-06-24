# CURRENT-BRANCH DIFF EVIDENCE AUDIT — PR #97

**Branch**: `fix/system-corrections-main-app`  
**Base**: `main` (HEAD diff: `main...fix/system-corrections-main-app`)  
**Scope**: Files touched by PR #97 diff only  
**Method**: Read PR #97 diff via `gh pr diff 97`, confirm current file state matches diff "after" hunks  
**Labels**: code-observed, test-proven, runtime-proven, inferred, unknown  

---

## Stage 1 — Artifact Inventory

### File: .memory/AGENT_LEDGER.md
- **Status**: Modified (append-only ledger entries)
- **What it can prove**: Agent activity log entries dated 2026-06-20 through 2026-06-22; 9 new lines
- **What it cannot prove**: Functional code behavior; ledger entries are claims, not executable evidence

### File: docs/qa-intel/qa-intel-final-audit-2026-06-20.md
- **Status**: NEW (44 lines added)
- **What it can prove**: Documentation of prior qa-intel work (concurrency=22, <45s scan time, 115 findings, 60 files) — these are documented claims
- **What it cannot prove**: Whether the optimizations actually achieve those numbers in current execution; no live benchmark output in the artifact

### File: docs/testing/chunk-97-review-matrix.md
- **Status**: NEW (48 lines added)
- **What it can prove**: Maps 9 review findings (Cubic/Sourcery/Codacy/CodeRabbit/QA-Intel) to claimed resolutions
- **What it cannot prove**: Whether each claimed resolution actually fixes the underlying issue; resolution column says "✅ RESOLVED" without inline diff against current code

### File: package.json
- **Status**: Modified (1 line added)
- **What it can prove**: `"ajv": "^8.17.1"` added to overrides
- **What it cannot prove**: Whether ajv 8.17.1 actually resolves the conflict it claims to

### File: pnpm-lock.yaml
- **Status**: Modified (multiple ajv version entries)
- **What it can prove**: ajv ^8.18.0 override removed, ajv 6.15.0 and ajv 8.6.3 added as transitive resolutions
- **What it cannot prove**: Whether the new ajv resolution graph is internally consistent

### File: pnpm-workspace.yaml
- **Status**: Modified (1 line removed)
- **What it can prove**: `"ajv": "^8.18.0"` line removed from overrides
- **What it cannot prove**: Whether removal resolves the documented AJV/ESLint crash

### File: scripts/verify-quality-engine.ts
- **Status**: Modified (1 line changed)
- **What it can prove**: `git diff --name-only --diff-filter=ACM HEAD` → `git diff --name-only --diff-filter=ACM origin/main`
- **What it cannot prove**: Whether origin/main exists in the test environment; whether diff mode actually picks up PR-introduced files now

### File: web/components/containers/DashboardContainer.tsx
- **Status**: Modified (63 insertions, 27 deletions)
- **What it can prove**: 6 distinct changes (Sentry import, toast aria, reportClipboardError, cleanDimensionContent rewrite, startTransition wrapping)
- **What it cannot prove**: Whether startTransition wrapping actually reduces INP; whether aria attributes reach the rendered DOM; whether cleanDimensionContent correctly strips dimension headers in all cases

### File: web/components/dashboard/SelectedDimensionReadout.tsx
- **Status**: Modified (13 insertions, 1 deletion)
- **What it can prove**: Null-dimension branch now returns a placeholder UI instead of `null`
- **What it cannot prove**: Whether the placeholder reaches the user; whether the conditional that selects this component passes through

### File: web/lib/types/chat.ts
- **Status**: Modified (21 lines added)
- **What it can prove**: New types `DeltaEvent`, `DoneEvent`, `PersistEvent`, `ErrorEvent`, `ChatSSEEvent` exported
- **What it cannot prove**: Whether downstream code consumes them; whether `PersistEvent.status === 'aborted'` is ever sent

### File: web/store/useChatStore.ts
- **Status**: Modified (266 insertions, 148 deletions — large refactor)
- **What it can prove**: readSSE now throws `DOMException('AbortError')` instead of generic Error; error handling extracted to `handleChatStreamError`; SSE event handlers typed via `ChatSSEEvent`
- **What it cannot prove**: Whether AbortError filtering actually prevents Sentry spam in production; whether typed handlers correctly route all 4 event types

### File: worker/src/services/MarkdownReconstructor.ts
- **Status**: Modified (93 insertions, 2 deletions)
- **What it can prove**: Sentry import added; `repairUnclosedJson` function added; `extractJsonPayload` now attempts repair on initial parse failure; persona validation relaxes from `return null` to `delete parsed.persona`
- **What it cannot prove**: Whether `repairUnclosedJson` produces valid JSON for all truncated streams; whether the persona relaxation preserves chunk stability

### File: worker/src/services/PersistService.ts
- **Status**: Modified (10 insertions, 2 deletions)
- **What it can prove**: `ChunkPayloadSchema` imported; `isChunk = options.chunkIndex !== undefined` selects schema in `persist()`; `settleAnalysis()` switched to `ChunkPayloadSchema`
- **What it cannot prove**: Whether chunk validation accepts/rejects the correct payloads; whether `settleAnalysis()` was previously using the wrong schema

### File: worker/src/services/ZodSchemas.ts
- **Status**: Modified (12 lines added)
- **What it can prove**: `ChunkPayloadSchema` exported: `schemaVersion: literal('2.0')`, `dimensions: array of {number, name, content}`
- **What it cannot prove**: Whether the schema fields cover all chunk-required properties; whether `passthrough()` is intended

---

## Stage 2 — Current-Branch Diff Evidence

### File: web/components/containers/DashboardContainer.tsx

- **Line#**: 37
- **Before**: (no Sentry import)
- **After**: `import * as Sentry from '@sentry/nextjs';`
- **Snippet**: `import * as Sentry from '@sentry/nextjs';`
- **Label**: code-observed

- **Line#**: 45-46
- **Before**: toast div had no ARIA attributes
- **After**: toast div has role="alert"/"status" and aria-live="assertive"/"polite"
- **Snippet**:
```
el.setAttribute('role', type === 'error' ? 'alert' : 'status');
el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
```
- **Label**: code-observed

- **Line#**: 53-57
- **Before**: (no function)
- **After**: `reportClipboardError(error, context)` calls `Sentry.captureException` + console.error
- **Snippet**:
```
function reportClipboardError(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  Sentry.captureException(error, { tags: { feature: 'clipboard', context } });
  console.error('[DashboardContainer] Clipboard copy failed:', { message, context });
}
```
- **Label**: code-observed

- **Line#**: 63-88
- **Before**: 5 regex `.replace()` calls including `/^\s*#{1,6}\s+.*$/gm`, `/^\s*DIMENSION\s+\d+\b.*$/gim`, `/^\s*\d+(?:\.\d+)*[.)]?\s+(?=\S)/gm`, `/\n{3,}/g`
- **After**: split/shift/pop-based code fence stripping, conditional first-line uppercase check + regex test for dimension headers
- **Snippet**:
```
if (content.startsWith('```')) {
  const lines = content.split(/\r?\n/);
  lines.shift();
  if (lines.length > 0 && lines[lines.length - 1]?.trim() === '```') {
    lines.pop();
  }
  content = lines.join('\n').trim();
}
const lines = content.split(/\r?\n/);
if (lines[0]) {
  const firstLine = lines[0].trim().toUpperCase();
  if (firstLine.startsWith('#') && /\bDIMENSION\s+\d+/.test(firstLine)) {
    lines.shift();
    content = lines.join('\n');
  }
}
```
- **Label**: code-observed

- **Line#**: 145-150, 152-157
- **Before**: 4 calls to `navigator.clipboard.writeText(text).catch(() => {})` with silent swallow
- **After**: `.catch((err) => reportClipboardError(err, '...'))` with structured error reporting
- **Snippet**:
```
navigator.clipboard.writeText(text).catch((err) => reportClipboardError(err, 'insights'));
navigator.clipboard.writeText(text).catch((err) => reportClipboardError(err, 'knowledge-graph'));
navigator.clipboard.writeText(text).catch((err) => reportClipboardError(err, 'word-cloud'));
navigator.clipboard.writeText(text).catch((err) => reportClipboardError(err, 'mind-map'));
```
- **Label**: code-observed

- **Line#**: 160-161
- **Before**: `catch {}` empty block
- **After**: `catch (err) { reportClipboardError(err, 'outer'); showToast('Copy failed', 'error'); }`
- **Snippet**: `} catch (err) { reportClipboardError(err, 'outer'); showToast('Copy failed', 'error'); }`
- **Label**: code-observed

- **Line#**: 301-304
- **Before**: `async () => { await startAnalysis(url, getUserTimezone()); }`
- **After**: sync wrapper with `startTransition(() => { startAnalysis(url, getUserTimezone()); });`
- **Snippet**:
```
const handleAnalyze = useCallback(() => {
  if (!url) return;
  startTransition(() => {
    startAnalysis(url, getUserTimezone());
  });
}, [url, startAnalysis]);
```
- **Label**: code-observed

- **Line#**: 306-310
- **Before**: `async () => { await startAnalysis(url, getUserTimezone(), true); }`
- **After**: same startTransition wrap for `handleReanalyze`
- **Snippet**:
```
const handleReanalyze = useCallback(() => {
  if (!url) return;
  startTransition(() => {
    startAnalysis(url, getUserTimezone(), true);
  });
}, [url, startAnalysis]);
```
- **Label**: code-observed

### File: web/components/dashboard/SelectedDimensionReadout.tsx

- **Line#**: 11-21
- **Before**: `if (!dimension) return null;`
- **After**: returns centered placeholder div with two text lines
- **Snippet**:
```
if (!dimension) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-8 flex flex-col items-center justify-center text-center gap-2 h-full">
      <div className="text-[var(--ink-secondary)] font-mono text-[13px] font-semibold">
        Select a dimension to view details.
      </div>
      <div className="text-[var(--ink-muted)] text-[12px] leading-relaxed max-w-[280px]">
        Choose an item from the list to see its structured analysis details here.
      </div>
    </div>
  );
}
```
- **Label**: code-observed

### File: web/lib/types/chat.ts

- **Line#**: 31-52
- **Before**: file ended at line 30
- **After**: 5 new types added
- **Snippet**:
```
export interface DeltaEvent { type: 'delta'; content: string; }
export interface DoneEvent { type: 'done'; }
export interface PersistEvent { type: 'persist'; status: 'saving' | 'saved' | 'failed' | 'aborted'; }
export interface ErrorEvent { type: 'error'; error: string; }
export type ChatSSEEvent = DeltaEvent | DoneEvent | PersistEvent | ErrorEvent;
```
- **Label**: code-observed

### File: web/store/useChatStore.ts

- **Line#**: 13
- **Before**: `import type { ChatConversation, ChatMessage } from '@/lib/types/chat';`
- **After**: `import type { ChatConversation, ChatMessage, ChatSSEEvent } from '@/lib/types/chat';`
- **Snippet**: `import type { ChatConversation, ChatMessage, ChatSSEEvent } from '@/lib/types/chat';`
- **Label**: code-observed

- **Line#**: 44-56
- **Before**: bare `api()` with no try/finally
- **After**: try block with `finally {}` empty block (WorkflowRule compliance)
- **Snippet**:
```
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
    if (!res.ok) {
      throw new Error(`${res.status}: ${await res.text().catch((err) => {
        console.debug('[api] text retrieval failed:', err);
        return '';
      })}`);
    }
    return res.json() as Promise<T>;
  } finally {
    // Complies with WorkflowRule finally block for fetch I/O
  }
}
```
- **Label**: code-observed

- **Line#**: 58-79
- **Before**: (no functions)
- **After**: `getErrorConfig`, `handleChatStreamError` extracted helpers
- **Snippet**:
```
interface ErrorConfig { isAbort: boolean; msg: string; }
const getErrorConfig = (err: unknown): ErrorConfig => {
  const isAbort = err instanceof DOMException && (err.name === 'AbortError' || err.message.includes('abort'));
  const msg = err instanceof Error ? err.message : String(err);
  return { isAbort, msg };
};
const handleChatStreamError = (err, context, setPersistState) => {
  const { isAbort, msg } = getErrorConfig(err);
  if (!isAbort) {
    Sentry.captureException(err, { contexts: { chat: context } });
    console.error('[ChatStore]', { message: `${context.action} failed`, error: msg, context });
  }
  setPersistState(isAbort ? 'aborted' : 'failed', context.clientMsgId);
  return { isAbort, msg };
};
```
- **Label**: code-observed

- **Line#**: 82-129 (readSSE)
- **Before**: typed `onEvent: (e: any) => void`; timeout fires `reader.cancel().catch(() => {})`; on exit, `if (timedOut) throw new Error('Chat stream timed out after 25s');`
- **After**: typed `onEvent: (e: Record<string, unknown>) => void`; cancel logs debug; on done+timedout, throws `DOMException('Stream timed out after 25s', 'AbortError')`; removed trailing throw
- **Snippet**:
```
async function readSSE(res: Response, onEvent: (e: Record<string, unknown>) => void): Promise<void> {
  if (!res.body) throw new Error('No stream body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    reader.cancel().catch((err) => {
      console.debug('[readSSE] reader cancel failed:', err);
    });
  }, 25000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        if (timedOut) {
          throw new DOMException('Stream timed out after 25s', 'AbortError');
        }
        break;
      }
      ...
```
- **Label**: code-observed

- **Line#**: 159-264 (deliver refactor)
- **Before**: large deliver() with `e.type === 'delta'/'done'/'persist'/'error'` if/else chain
- **After**: typed handlers object keyed by ChatSSEEvent['type']
- **Snippet**:
```
await readSSE(streamRes, (e: Record<string, unknown>) => {
  if (e.requestId && e.requestId !== clientMsgId) return;
  const handlers: {
    [K in ChatSSEEvent['type']]: (evt: Extract<ChatSSEEvent, { type: K }>) => void;
  } = {
    delta: (evt) => { ... },
    done: () => { ... },
    persist: (evt) => {
      if (evt.status === 'saving' || evt.status === 'saved' || evt.status === 'failed' || evt.status === 'aborted') {
        get().setPersistState(evt.status, clientMsgId);
      }
    },
    error: (evt) => { ... }
  };
  const type = e.type as ChatSSEEvent['type'];
  if (type && type in handlers) {
    (handlers[type] as any)(e);
  }
});
```
- **Label**: code-observed

- **Line#**: 369
- **Before**: 5 lines of inline error handling (`msg = e instanceof Error ? ...`, Sentry.captureException, console.error, isAbort, setPersistState)
- **After**: single call `handleChatStreamError(e, {...}, get().setPersistState)`
- **Snippet**: `const { msg } = handleChatStreamError(e, { convId: convId!, clientMsgId, action: 'sendMessage' }, get().setPersistState);`
- **Label**: code-observed

- **Line#**: 386-389
- **Before**: `catch {} /* optimistic */`
- **After**: `catch (err) { Sentry.captureException + console.error }`
- **Snippet**:
```
} catch (err) {
  Sentry.captureException(err, { tags: { action: 'renameConversation', conversationId: id } });
  console.error('[ChatStore]', { message: 'optimistic rename failed', error: err, conversationId: id });
}
```
- **Label**: code-observed

- **Line#**: 402-405
- **Before**: `catch {} /* already removed locally */`
- **After**: `catch (err) { Sentry.captureException + console.warn }`
- **Snippet**:
```
} catch (err) {
  Sentry.captureException(err, { tags: { action: 'deleteConversation', conversationId: id } });
  console.warn('[ChatStore] conversation delete failed or already removed locally:', err);
}
```
- **Label**: code-observed

- **Line#**: 427
- **Before**: 5 lines of inline flushOutbox error handling
- **After**: single call `handleChatStreamError(err, {...}, get().setPersistState)`
- **Snippet**: `handleChatStreamError(err, { convId: e.conversationId, clientMsgId: e.clientMsgId, action: 'flushOutbox' }, get().setPersistState);`
- **Label**: code-observed

### File: worker/src/services/MarkdownReconstructor.ts

- **Line#**: 1
- **Before**: no Sentry import
- **After**: `import * as Sentry from '@sentry/cloudflare';`
- **Snippet**: `import * as Sentry from '@sentry/cloudflare';`
- **Label**: code-observed

- **Line#**: 127-164
- **Before**: function did not exist
- **After**: `repairUnclosedJson` parses with stack limit 500, validates closer matches
- **Snippet**:
```
function repairUnclosedJson(text: string): string | null {
  let inStr = false;
  let esc = false;
  const closers: string[] = [];
  const openerToCloser: Record<string, string> = { '{': '}', '[': ']' };
  for (const char of text) {
    if (esc) { esc = false; continue; }
    if (char === '\\' && inStr) { esc = true; continue; }
    if (char === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    const closer = openerToCloser[char];
    if (closer) {
      if (closers.length > 500) return null;
      closers.push(closer);
    } else if (char === '}' || char === ']') {
      if (closers.length === 0 || closers[closers.length - 1] !== char) {
        return null;
      }
      closers.pop();
    }
  }
  if (inStr) text += '"';
  text = text.trim();
  if (text.endsWith(',')) { text = text.slice(0, -1); }
  text += closers.reverse().join('');
  try {
    JSON.parse(text);
    return text;
  } catch (error) {
    console.debug('[repairUnclosedJson] Parse failed:', error);
    return null;
  }
}
```
- **Label**: code-observed

- **Line#**: 170-225 (extractJsonPayload rewrite)
- **Before**: 
```
try {
  let cleanText = finalText.trim();
  if (cleanText.startsWith('```')) {
    const start = cleanText.indexOf('{');
    const end = cleanText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      cleanText = cleanText.slice(start, end + 1);
    }
  }
  const parsed = JSON.parse(cleanText);
  if (parsed && parsed.schemaVersion === '2.0' && Array.isArray(parsed.dimensions)) {
    if (parsed.persona) {
      if (!parsed.persona.primary || typeof parsed.persona.primary !== 'object' || !('id' in parsed.persona.primary)) {
        return null;
      }
    }
    return parsed as Partial<UCISPayloadV2>;
  }
} catch (error: any) {
  console.debug('[extractJsonPayload] Failed to parse JSON:', error instanceof Error ? error.message : String(error));
}
return null;
```
- **After**: null guard, explicit `{` locate, slice with trailing-char validation, two-phase parse (initial + repair attempt), Sentry on each failure, persona validation relaxes from `return null` to `delete parsed.persona`
- **Snippet** (key delta):
```
let parsed: Partial<UCISPayloadV2> | null = null;
try {
  parsed = JSON.parse(cleanText) as Partial<UCISPayloadV2>;
} catch (error) {
  Sentry.captureException(error);
  const message = error instanceof Error ? error.message : String(error);
  console.error('[extractJsonPayload]', { message, phase: 'initial_parse' });
  const repaired = repairUnclosedJson(cleanText);
  if (repaired) {
    try {
      parsed = JSON.parse(repaired) as Partial<UCISPayloadV2>;
    } catch (repairError) {
      Sentry.captureException(repairError);
      ...
    }
  }
}
if (parsed && parsed.schemaVersion === '2.0' && Array.isArray(parsed.dimensions)) {
  if (parsed.persona) {
    if (!parsed.persona.primary || typeof parsed.persona.primary !== 'object' || !('id' in parsed.persona.primary)) {
      delete parsed.persona;  // was: return null;
    }
  }
  return parsed;
}
```
- **Label**: code-observed

### File: worker/src/services/PersistService.ts

- **Line#**: 2
- **Before**: `import { UCISPayloadSchema } from './ZodSchemas';`
- **After**: `import { UCISPayloadSchema, ChunkPayloadSchema } from './ZodSchemas';`
- **Snippet**: `import { UCISPayloadSchema, ChunkPayloadSchema } from './ZodSchemas';`
- **Label**: code-observed

- **Line#**: 29-32
- **Before**: `const result = UCISPayloadSchema.safeParse(extracted);`
- **After**: chunk-or-full selection
- **Snippet**:
```
const isChunk = options.chunkIndex !== undefined;
const schema = isChunk ? ChunkPayloadSchema : UCISPayloadSchema;
const result = schema.safeParse(extracted);
```
- **Label**: code-observed

- **Line#**: 124
- **Before**: `const result = UCISPayloadSchema.safeParse(extracted);` in settleAnalysis
- **After**: `const result = ChunkPayloadSchema.safeParse(extracted);`
- **Snippet**: `const result = ChunkPayloadSchema.safeParse(extracted);`
- **Label**: code-observed

### File: worker/src/services/ZodSchemas.ts

- **Line#**: 94-103
- **Before**: file ended at line 92
- **After**: new `ChunkPayloadSchema` exported
- **Snippet**:
```
export const ChunkPayloadSchema = z.object({
  schemaVersion: z.literal('2.0'),
  dimensions: z.array(
    z.object({
      number: z.number().int().min(1),
      name: z.string(),
      content: z.string()
    }).passthrough()
  ),
}).passthrough();
```
- **Label**: code-observed

### File: scripts/verify-quality-engine.ts

- **Line#**: 58
- **Before**: `const diffOutput = execSync("git diff --name-only --diff-filter=ACM HEAD", ...);`
- **After**: `const diffOutput = execSync("git diff --name-only --diff-filter=ACM origin/main", ...);`
- **Snippet**: `const diffOutput = execSync("git diff --name-only --diff-filter=ACM origin/main", { encoding: "utf8" });`
- **Label**: code-observed

### File: package.json

- **Line#**: 8
- **Before**: `"undici": "6.21.2"`
- **After**: `"undici": "6.21.2",` + `"ajv": "^8.17.1"`
- **Snippet**:
```
"undici": "6.21.2",
"ajv": "^8.17.1"
```
- **Label**: code-observed

### File: pnpm-workspace.yaml

- **Line#**: 29
- **Before**: `"ajv": "^8.18.0"` override present
- **After**: ajv override removed
- **Snippet**: (line removed)
- **Label**: code-observed

### File: .memory/AGENT_LEDGER.md

- **Line#**: 372-378 (after append)
- **Before**: 371 lines
- **After**: 380 lines (9 ledger entries)
- **Snippet**: 9 timestamped agent entries dated 2026-06-20T20:49 through 2026-06-22T05:08
- **Label**: code-observed

### File: docs/qa-intel/qa-intel-final-audit-2026-06-20.md

- **Line#**: 1-44
- **Before**: file did not exist
- **After**: 44-line markdown describing QA engine optimization, 115 findings on 60 files, concurrency 22, <45s scan time
- **Snippet**: (entire file content is documentation; key claims: "from timeouts (>120s) to under 45 seconds", "115 total findings", "60 unique files")
- **Label**: code-observed (file exists); claims about performance numbers cannot be proven from current artifacts

### File: docs/testing/chunk-97-review-matrix.md

- **Line#**: 1-48
- **Before**: file did not exist
- **After**: 48-line review matrix mapping 9 findings to ✅ RESOLVED status, plus 100/100 confidence score
- **Snippet**: (resolution table for findings 01-09; confidence score: Cubic 30/30, CodeRabbit 20/20, Snyk 15/15, etc., totaling 100)
- **Label**: code-observed (file exists); "RESOLVED" status is self-claimed in the document, not externally verified

---

## Stage 3 — Verified Behavior

### Behavior: Toast notifications now expose ARIA attributes
- **Evidence**: DashboardContainer.tsx:45-46 adds `setAttribute('role', ...)` and `setAttribute('aria-live', ...)` to dynamically-created div
- **Label**: code-observed (the attribute-setting calls are present; whether screen readers receive them is not proven)

### Behavior: Clipboard copy failures now report to Sentry with structured context
- **Evidence**: DashboardContainer.tsx:53-57 defines `reportClipboardError`; 4 callsites pass context strings ('insights', 'knowledge-graph', etc.) instead of silent `.catch(() => {})`
- **Label**: code-observed

### Behavior: `cleanDimensionContent` no longer uses regex for header stripping
- **Evidence**: DashboardContainer.tsx:63-88 replaces 4 regex `.replace()` calls with split/shift/pop on code fences and an explicit first-line uppercase check
- **Snippet**: `if (firstLine.startsWith('#') && /\bDIMENSION\s+\d+/.test(firstLine))` — note: one regex test still remains
- **Label**: code-observed

### Behavior: `handleAnalyze` and `handleReanalyze` wrapped in `startTransition`
- **Evidence**: DashboardContainer.tsx:301-310 wraps both callbacks in `startTransition(() => { startAnalysis(...) })`; signature changed from `async` to sync
- **Label**: code-observed (the wrap exists; whether INP improves is not proven)

### Behavior: Empty dimension state shows placeholder UI
- **Evidence**: SelectedDimensionReadout.tsx:11-21 replaces `return null;` with a centered two-line placeholder div
- **Label**: code-observed

### Behavior: `readSSE` throws typed `DOMException('AbortError')` instead of generic Error on timeout
- **Evidence**: useChatStore.ts readSSE rewrite — `if (done) { if (timedOut) { throw new DOMException('Stream timed out after 25s', 'AbortError'); } break; }`; trailing `if (timedOut) throw new Error(...)` removed
- **Label**: code-observed

### Behavior: AbortError filtered out of Sentry/console.error
- **Evidence**: useChatStore.ts `handleChatStreamError` only calls `Sentry.captureException` and `console.error` when `!isAbort`; aborts set persistState to 'aborted' instead of 'failed'
- **Label**: code-observed

### Behavior: SSE events are now typed via discriminated union
- **Evidence**: useChatStore.ts:159-264 SSE handler uses typed `handlers` object keyed by `ChatSSEEvent['type']`; new `PersistEvent` adds `'aborted'` status case alongside existing `'saving'/'saved'/'failed'`
- **Label**: code-observed

### Behavior: `extractJsonPayload` attempts JSON repair on initial parse failure
- **Evidence**: MarkdownReconstructor.ts:170-225 wraps initial parse in try/catch, on failure calls `repairUnclosedJson(cleanText)`, then retries parse; both failures captured to Sentry
- **Label**: code-observed

### Behavior: Persona validation no longer rejects entire chunk — strips invalid persona instead
- **Evidence**: MarkdownReconstructor.ts:212-215: `delete parsed.persona;` replaces `return null;`
- **Label**: code-observed

### Behavior: `PersistService.persist()` selects schema based on `chunkIndex`
- **Evidence**: PersistService.ts:29-32: `const isChunk = options.chunkIndex !== undefined; const schema = isChunk ? ChunkPayloadSchema : UCISPayloadSchema;`
- **Label**: code-observed

### Behavior: `settleAnalysis` uses `ChunkPayloadSchema` (was `UCISPayloadSchema`)
- **Evidence**: PersistService.ts:124: `const result = ChunkPayloadSchema.safeParse(extracted);`
- **Label**: code-observed

### Behavior: Quality engine diff mode now compares against `origin/main` (was `HEAD`)
- **Evidence**: scripts/verify-quality-engine.ts:58: `git diff --name-only --diff-filter=ACM origin/main`
- **Label**: code-observed

### Behavior: ajv ^8.18.0 override removed; ajv ^8.17.1 added to root package.json
- **Evidence**: pnpm-workspace.yaml:29 deleted; package.json:8 added
- **Label**: code-observed (the diff exists; whether this resolves the AJV/ESLint crash is not proven)

### Behavior: Empty `finally {}` blocks added for WorkflowRule compliance
- **Evidence**: useChatStore.ts `api()` and `deliver()` both end with `} finally { /* comment */ }` blocks
- **Label**: code-observed

---

## Stage 4 — Unknowns

### Item: Whether `startTransition` actually reduces INP
- **Why unknown**: No INP measurements or Lighthouse runs in the current diff
- **What would prove it**: A runtime INP trace before/after, or a Playwright performance test

### Item: Whether `repairUnclosedJson` produces valid JSON for all truncated streams
- **Why unknown**: No test fixtures, no unit test for `repairUnclosedJson` in the diff
- **What would prove it**: A unit test exercising truncated input (e.g., `{ "a": 1, "b": [`)

### Item: Whether `ChunkPayloadSchema` accepts all valid chunk payloads
- **Why unknown**: No chunk payload test fixtures; schema only validates `schemaVersion + dimensions[].number/name/content` — no persona, no monetizationVerdict, no other UCISPayloadV2 fields
- **What would prove it**: Test with a real chunk JSON from worker LLM output

### Item: Whether `origin/main` exists in CI/local when quality engine runs
- **Why unknown**: scripts/verify-quality-engine.ts:58 now references `origin/main`; no fetch step shown
- **What would prove it**: A successful `pnpm tsx scripts/verify-quality-engine.ts --mode diff` run on the current branch

### Item: Whether ARIA attributes on dynamically-created toast div reach screen readers
- **Why unknown**: No accessibility test in the diff
- **What would prove it**: An axe-core or Playwright a11y test

### Item: Whether `ajv ^8.17.1` resolves the AJV/ESLint crash
- **Why unknown**: Diff shows the override change but no run output
- **What would prove it**: A clean `pnpm lint` and `pnpm install` output

### Item: Whether `cleanDimensionContent` correctly handles edge cases
- **Why unknown**: Diff shows the rewrite; no test for non-conforming inputs (e.g., lowercase `dimension 1`, headers mid-content)
- **What would prove it**: A unit test for `cleanDimensionContent`

### Item: Whether the QA-Intel findings count (115) is accurate on current branch
- **Why unknown**: docs/qa-intel/qa-intel-final-audit-2026-06-20.md claims 115 findings on 60 files; no live scan output in the current artifacts
- **What would prove it**: A `pnpm tsx scripts/verify-quality-engine.ts --mode full` run on current HEAD

### Item: Whether PR #97 review matrix "100/100 confidence" reflects actual tool output
- **Why unknown**: docs/testing/chunk-97-review-matrix.md self-claims the score; no external tool output attached
- **What would prove it**: A `gh pr checks 97` run with all green checks

### Item: Whether `extractJsonPayload` persona relaxation causes downstream schema failures
- **Why unknown**: Behavior change from `return null` to `delete parsed.persona` is significant; downstream schema validation may reject the result
- **What would prove it**: An integration test with persona-invalid input flowing through PersistService

### Item: Whether `handleAnalyze` async→sync signature change breaks any caller
- **Why unknown**: Diff shows `async` removed from callbacks but no caller verification
- **What would prove it**: Grep all callers of `handleAnalyze`/`handleReanalyze` and confirm none awaited the return value

### Item: Whether `readSSE` typed `e: Record<string, unknown>` correctly handles all event shapes from worker
- **Why unknown**: Cast `e.type as ChatSSEEvent['type']` + `(handlers[type] as any)(e)` bypasses type checking; runtime could pass unknown types
- **What would prove it**: A worker-side test emitting all 4 event types

---

## Stage 5 — Conclusion

**Verdict**: The current branch diff is a system-corrections PR that introduces 14 file changes (485 insertions, 148 deletions) focused on: Sentry instrumentation for previously-silent errors, `startTransition` wrapping of two click handlers, ARIA attribute addition to toast, an empty-state placeholder in `SelectedDimensionReadout`, `ChunkPayloadSchema` extraction, `extractJsonPayload` rewrite with JSON repair attempt, typed SSE event handlers, and AJV override reshuffling. None of the claimed resolutions are independently verifiable from the current artifacts alone.

**What would change my mind is**: A live `pnpm tsx scripts/verify-quality-engine.ts --mode diff --concurrency 22` run on `origin/main..HEAD` showing the 9 review findings actually closed, plus a unit test for `repairUnclosedJson` and `ChunkPayloadSchema`, plus a Playwright run showing the empty-state placeholder reaches the rendered DOM and `startTransition` reduces measured INP.

---

## End of Report