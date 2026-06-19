# Wave 6: Monolith Decomposition & Ponytail Ledger

**Filename**: WAVE6_PONYTAIL_LEDGER.md  
**Location**: `/docs/specs/WAVE6_PONYTAIL_LEDGER.md`  
**Version**: v1.0.0  
**Build**: 2026-06-19-W6  
**Timestamp**: 2026-06-19T16:50:00+03:00  
**Purpose**: Document the baseline ("Before") state of the 5 target monoliths, record the ponytail scoreboard/debt ledger, and outline the step-by-step decomposition plan under strict ponytail guidelines.

---

## 1. Ponytail Scoreboard (Baseline Gain)

```
  ponytail gain                     benchmark median · 5 tasks · 3 models

  Lines of code   no-skill  ████████████████████  100%
                  ponytail  ██▌·················    6–20%   ▼ 80–94%
  Cost            no-skill  ████████████████████  100%
                  ponytail  █████▌··············   23–53%  ▼ 47–77%
  Speed           ponytail  ▸ 3–6× faster

  This repo:  /ponytail-debt  (shortcuts you deferred)
              /ponytail-audit (what's still cuttable)
```

---

## 2. Before State: Ponytail Debt Ledger

A search of the active codebase (excluding worktrees and external dependencies) lists the following active deliberate shortcuts.

| File & Line | Shortcut / Simplification | Ceiling | Upgrade Path |
| :--- | :--- | :--- | :--- |
| [`web/lib/utils/ucis-parser.ts:2`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/utils/ucis-parser.ts#L2) | Simple regex parsing for speed and safety. | Nesting depth <= 3. | Full custom AST parser if nesting exceeds 3 levels. |
| [`web/store/useChatStore.ts:51`](file:///home/kellyb_dev/projects/hex-yt-intel/web/store/useChatStore.ts#L51) | Simple global `persistState` tracking. | Single concurrent active chat save. | Add per-chat request mapping if multiple concurrent saves occur. |
| [`worker/src/chat-stream.ts:86`](file:///home/kellyb_dev/projects/hex-yt-intel/worker/src/chat-stream.ts#L86) | Simple console header logging. | Local debugging. | Structured logs (Sentry/Winston) if logging budget grows. |
| [`worker/src/worker.ts:59`](file:///home/kellyb_dev/projects/hex-yt-intel/worker/src/worker.ts#L59) | Simple timingSafeEqualHex and validation. | Basic input structures. | Use AJV/Zod if complex schema nesting is required. |

---

## 3. Before State: Monolith Audit (LOC & Complexity)

These are the 5 target monoliths assigned for decomposition in Wave 6.

| Target Monolith File | LOC (Before) | Core Responsibilities |
| :--- | :---: | :--- |
| **[`web/lib/adapters/SupabasePersistenceAdapter.ts`](file:///home/kellyb_dev/projects/hex-yt-intel/web/lib/adapters/SupabasePersistenceAdapter.ts)** | 1,206 | Handles CRUD for Analyses, Chunks, Chat Conversations, Messages, and Knowledge Graph. |
| **[`scripts/quality-engine/rules.ts`](file:///home/kellyb_dev/projects/hex-yt-intel/scripts/quality-engine/rules.ts)** | 1,135 | Lists 40+ Quality Intelligence enforcer rules inline using `ts-morph` AST checks. |
| **[`web/components/containers/DashboardContainer.tsx`](file:///home/kellyb_dev/projects/hex-yt-intel/web/components/containers/DashboardContainer.tsx)** | 726 | Manages UI container, layout, active node drawer, accordion rendering, and overlay states. |
| **[`worker/src/worker.ts`](file:///home/kellyb_dev/projects/hex-yt-intel/worker/src/worker.ts)** | 657 | Hono application entry point; handles routing, authentication, CORS, and pipelines. |
| **[`web/app/api/stripe/webhook/route.ts`](file:///home/kellyb_dev/projects/hex-yt-intel/web/app/api/stripe/webhook/route.ts)** | 517 | Stripe webhook parsing, signature verification, event logging, and subscription event handling. |
| **Total Monolithic LOC** | **4,241** | |

---

## 4. Step-by-Step Decomposition Plan (Ponytail Style)

To ensure high cohesion, low coupling, and zero regressions, we will decompose each monolith sequentially, running quality checks (`pnpm type-check` and unit tests) after each file.

### Step 4.1: Decompose `SupabasePersistenceAdapter.ts` (1206 LOC → 4 adapters)
* **Goal**: Break the adapter into 4 single-responsibility adapters matching their specific domain.
* **Proposed Sub-Adapters**:
  1. `SupabaseAnalysisAdapter.ts`: Analysis cache check, stubs, metadata, share token, and persist logic.
  2. `SupabaseChatAdapter.ts`: Conversations and messages retrieval/storage.
  3. `SupabaseGraphAdapter.ts`: Entity/relation mappings for the Knowledge Graph.
  4. `SupabaseBillingAdapter.ts`: Tier updates and billing status tracking.
* **Imports**: Update `web/lib/adapters/index.ts` to export all 4 adapters, and update instantiations.

### Step 4.2: Decompose `rules.ts` (1135 LOC → config + engine)
* **Goal**: Separate rule definitions from the engine registry to make rules modular.
* **Proposed Files**:
  * Create `scripts/quality-engine/rules/` directory.
  * Extract rules into category-specific files:
    - `architectural.ts` (Hexagonal boundary, monolithic file sizes)
    - `security.ts` (Leaks, credential checks, sanitization)
    - `workflow.ts` (Loose promises, finally blocks)
    - `react.ts` (React-specific, hooks, transitions)
  * Simplify `scripts/quality-engine/rules.ts` to merely import and export the array of rules.

### Step 4.3: Decompose `DashboardContainer.tsx` (726 LOC → components)
* **Goal**: Move child UI sections out of the massive main container to improve rendering efficiency and readability.
* **Proposed Sub-Components**:
  * `web/components/dashboard/DimensionAccordion.tsx`: Accordion list items and selection handlers.
  * `web/components/dashboard/SelectedDimensionReadout.tsx`: Right panel readable typography canvas.
  * `web/components/dashboard/VisualizationPanel.tsx`: Tabs for Knowledge Graph, Mind Map, and Word Cloud.

### Step 4.4: Decompose `worker.ts` (657 LOC → routes + middleware)
* **Goal**: Decouple Hono request mapping from route handler logic.
* **Proposed Files**:
  * `worker/src/middleware/auth.ts`: Authentication Bearer token checks.
  * `worker/src/middleware/cors.ts`: Allowlist-based CORS header emission.
  * `worker/src/routes/metadata.ts`: YouTube metadata scraping endpoint.
  * `worker/src/routes/analysis.ts`: Video transcript and parallel stream-analysis endpoint.
  * `worker/src/routes/chat.ts`: Grounded chat SSE stream endpoint.

### Step 4.5: Decompose `stripe/webhook/route.ts` (517 LOC → handlers)
* **Goal**: Separate webhook signature verification from database updates.
* **Proposed Files**:
  * Move helper event handlers (`handleSubscriptionEvent`, `handleSubscriptionCanceled`, `handleInvoicePaid`, `handleInvoiceFailed`) into a lightweight `web/lib/stripe/webhook-handlers.ts`.
  * Keep the main `route.ts` lean, focusing only on signature verification, event categorization, and calling the appropriate handler.

---

## 5. After State: Monolith Audit (LOC & Complexity)

*(This section will be populated step-by-step as each file is successfully refactored, displaying the line counts and confirming correct execution).*

| Target Monolith File | LOC (After) | Status | Net Lines / Files |
| :--- | :---: | :---: | :---: |
| `SupabasePersistenceAdapter.ts` | TBD | Pending | TBD |
| `rules.ts` | TBD | Pending | TBD |
| `DashboardContainer.tsx` | TBD | Pending | TBD |
| `worker.ts` | TBD | Pending | TBD |
| `stripe/webhook/route.ts` | TBD | Pending | TBD |
