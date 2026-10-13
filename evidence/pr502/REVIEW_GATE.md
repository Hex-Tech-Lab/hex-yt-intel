# PR #502 Hostile-Adversarial Red-Team Review Gate Evidence

**PR Number**: #502
**Branch**: `fix/persist-saving-stuck`
**Target**: `origin/uat`
**Head SHA**: `2e88c0bf`
**Timestamp**: 2026-10-13T17:48:30+03:00

---

## 1. Skill Execution: `race-condition-guard`
- **Target**: `web/store/useChatStore.ts` (`deliver`, `readSSE`, `setPersistState`, `finally`)
- **Analysis**:
  - Race Condition in Pre-PR Code: `deliver()` optimistically invoked `get().setPersistState('saving', clientMsgId)` immediately on user send. `setPersistState('saving')` arms an 8-second watchdog timer. When LLM generation exceeds 8 seconds (typical for reasoning or long responses), the timer fired mid-stream, resetting `persistState: 'idle'`. The user UI unblocked prematurely while the worker was still streaming.
  - Remediated Concurrency Architecture:
    1. `deliver()` sets `{ persistState: 'saving' }` directly without arming the watchdog timer.
    2. Watchdog timer is armed ONLY when the worker finishes LLM generation and emits an authoritative SSE frame `event: persist`, `data: { status: 'saving' }`.
    3. The `finally` block unblocks UI if the stream aborts or errors before emitting a persist frame.
- **Verdict**: PASS.

---

## 2. Skill Execution: `agent:silent-failure-hunter`
- **Target**: `web/store/useChatStore.ts` error handling and Sentry captures
- **Audit Findings**:
  - `reader.cancel().catch(...)`: Added structured error logging and Sentry capture contexts:
    ```typescript
    reader.cancel().catch((cancelError: unknown) => {
      console.error('[ChatStore] SSE reader cancel failed after timeout', { timeoutMs, error: cancelError });
      Sentry.captureException(cancelError, { contexts: { chat: { action: 'readSSE.cancel', timeoutMs } } });
    });
    ```
  - Missing server `timeoutMs`: Explicitly throws `new Error('Chat stream timeout missing from server payload (chat.stream.timeoutMs)')` rather than silently defaulting to hardcoded numbers (adhering to §5.0.1 Settings Registry mandate).
  - Outbox failure logging: `console.warn('[ChatStore] sendMessage left queued in outbox for retry')` and `flushOutbox` warnings logged.
- **Verdict**: PASS.

---

## 3. ARTAS Hostile-Adversarial Red-Team Audit

### 3.1 Attacker & Failure Mode Modeling
- **Actor/Vector**: Unstable client connection / Malicious or slow LLM generation / Dropped worker connection.
- **Failure Mode**: UI state desynchronization & outbox queue head-of-line blocking.

### 3.2 Blast Radius & Dependency Tracing via `code-review-graph`
- **Graph Command**: `code-review-graph impact --files web/store/useChatStore.ts`
- **Impact Radius**: 17 impacted nodes across:
  - Containers: `web/components/containers/DashboardContainer.tsx`
  - UI Docks: `web/components/templates/console/ChatDock.tsx`
  - History & Views: `web/components/templates/console/AnalysisHistory.tsx`
  - Hooks: `web/hooks/useSSEStream.ts`, `web/hooks/useAutoRestoreAnalysis.ts`
  - Tests: `useChatStore-persist-watchdog.test.ts`, `useChatStore-resilience.test.ts`
- **Interface Stability**: Zero breaking changes to store state contracts (`ChatState` interface preserved).

### 3.3 Boundary Stress: Malformed Payload & Error Boundaries
- **Adversarial Scenario A: Missing/Malformed `timeoutMs`**:
  - If `job.payload.timeoutMs` is missing or `<= 0`:
    `useChatStore` throws `Error: Chat stream timeout missing from server payload (chat.stream.timeoutMs)`.
  - The throw is caught by `sendMessage`, captured in Sentry, and the message remains in the outbox.
  - **FINDING (P3 Operational Risk)**: If a message is persisted in IndexedDB outbox with an invalid `timeoutMs`, `flushOutbox` will encounter this message, throw, and execute `break`, halting processing of subsequent queued messages.
  - **Mitigation Recommendation for Wave 2**: When `flushOutbox` catches a permanent contract violation (e.g. missing `timeoutMs` after N attempts), it should mark the individual entry poisoned or purge it to prevent queue stalling.
- **Adversarial Scenario B: Stream Interruption Mid-Flight**:
  - What happens if the stream drops abruptly after partial generation without emitting `persist:saved`?
  - `finally` block triggers:
    ```typescript
    if (get().persistState === 'saving' && get().activePersistRequestId === clientMsgId) {
      set({ persistState: 'idle', activePersistRequestId: null });
    }
    ```
  - State cleanly resets to `idle`; `persistState` is NEVER falsely marked `saved`.

### 3.4 Runtime Verification & Negative Controls
- **Command**: `pnpm --filter @hex-yt-intel/web exec vitest run store/__tests__/useChatStore-persist-watchdog.test.ts`
- **Results**:
  ```text
  ✓ store/__tests__/useChatStore-persist-watchdog.test.ts (5 tests) 35ms
    ✓ does not clear to idle while the worker is still generating (no persist frame yet)
    ✓ a worker persist:saved frame drives the state to saved, not a client-side guess
    ✓ never marks saved when the stream ends without a persist frame
    ✓ the worker persist:saving frame arms the 8s watchdog, which then clears a stuck save
    ✓ fails loudly, without opening the worker stream, when the server omits timeoutMs
  Test Files  1 passed (1)
  Tests       5 passed (5)
  Duration    1.43s
  ```
- **Negative Control**: Removing the `finally` cleanup block causes test `never marks saved when the stream ends without a persist frame` to hang in 'saving'. Reapplying ensures immediate reset to 'idle'.

---

## 4. ARTAS Phase 2.2 P3 Remediation & Verification

### 4.1 Outbox Poisoned Message Discard & Non-Blocking Replay
- **Target**: `web/store/useChatStore.ts:720-726` (`flushOutbox()`)
- **Implementation**:
  ```typescript
  } catch (err) {
    handleChatStreamError(err, { convId: e.conversationId, clientMsgId: e.clientMsgId, action: 'flushOutbox' }, get().setPersistState);
    const isPermanentContractBreak = err instanceof Error && err.message.includes('Chat stream timeout missing');
    if (isPermanentContractBreak) {
      outbox.remove(e.clientMsgId);
      console.warn('[ChatStore] flushOutbox discarded permanently unprocessable entry (missing timeoutMs)', { clientMsgId: e.clientMsgId });
      continue;
    }
    console.warn('[ChatStore] flushOutbox stopped; remaining entries wait for the next online event', { clientMsgId: e.clientMsgId });
    break;
  }
  ```
- **Validation**:
  - Permanently invalid messages (e.g. missing `chat.stream.timeoutMs`) are logged to Sentry, marked as `failed`, and discarded from the outbox queue.
  - The replay loop executes `continue`, unblocking subsequent healthy messages. Transient network disconnects continue to halt replay gracefully with `break`.

### 4.2 Empirical Verification
- **Command**: `pnpm --filter @hex-yt-intel/web exec vitest run store/__tests__/useChatStore-persist-watchdog.test.ts`
- **Results**:
  ```text
  ✓ store/__tests__/useChatStore-persist-watchdog.test.ts (6 tests) 53ms
    ✓ does not clear to idle while the worker is still generating (no persist frame yet)
    ✓ a worker persist:saved frame drives the state to saved, not a client-side guess
    ✓ never marks saved when the stream ends without a persist frame
    ✓ the worker persist:saving frame arms the 8s watchdog, which then clears a stuck save
    ✓ fails loudly, without opening the worker stream, when the server omits timeoutMs
    ✓ flushOutbox discards permanently unprocessable entry (missing timeoutMs) and continues processing subsequent messages
  Test Files  1 passed (1)
  Tests       6 passed (6)
  Duration    1.90s
  ```

---

## 5. Overall Review Verdict
**Status**: APPROVED & REMEDIATED (Hostile-Adversarial Red-Team passed with empirical proof; P3 outbox blocking closed).

