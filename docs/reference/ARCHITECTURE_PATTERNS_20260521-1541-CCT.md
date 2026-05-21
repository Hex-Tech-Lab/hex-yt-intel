# Architecture Patterns: hex-yt-intel

**Last Updated**: 2026-05-21  
**Documented In**: Session Snapshot + Memory files  
**Status**: Ready for Phase 2 implementation

Three architectural patterns are documented and ready for implementation when building batch operations, PDF generation, and real-time progress tracking features.

---

## Table of Contents

* [SWR, Zod, and Zustand Implementation Blueprint](#swr-zod-and-zustand-implementation-blueprint)
* [The Asynchronous Multi-File/List Pipeline](#the-asynchronous-multifilelist-pipeline)
* [Sprint Handover Validation](#sprint-handover-validation)

---

## Quick Reference

| Pattern | Problem | Solution | Use Case |
|---------|---------|----------|----------|
| **Multi-Tenancy & Zero Cost** | Vercel project limits (free tier = 2 projects max) | Path-based API routing (`/api/pdf`, `/api/batch`) within single project | Adding new API endpoints without exceeding quota |
| **Async Pipeline & Progress Meters** | Synchronous processing blocks browser, risks Vercel 29.5s timeout | 202 Accepted + QStash workers + Redis polling | Batch video processing, PDF generation, channel scraping |
| **SWR/Zod/Zustand Matrix** | Unvalidated data, flaky polling, scattered UI state | Zod validation → SWR polling → Zustand global store | Real-time progress meters that survive route navigation |

---

## Pattern 1: Multi-Tenancy & Zero Cost

**File**: `memory/arch_multi_tenancy_zero_cost_20260521-1541-CCT.md`

### Core Idea

Vercel charges per **project**, not per **route**. Keep everything in one project using path-based routing.

### Bad Pattern ❌
```
Project 1: hex-yt-intel (analyses)
Project 2: hex-yt-intel-pdf (PDF generation)
Project 3: hex-yt-intel-worker (background jobs)
= Exceeds free tier limit, requires paid plan
```

### Good Pattern ✅
```
hex-yt-intel (Single Vercel Project)
├── /api/analyses → Analysis generation
├── /api/pdf → PDF conversion
├── /api/batch → Batch processing
├── /api/admin → Admin dashboard
= Single project quota, zero cost
```

### Implementation

1. Create new API route: `web/app/api/pdf/route.ts`
2. Reference shared environment variables (no new secrets)
3. Use existing rate-limiting, error handling, authentication
4. Add route gating in `web/middleware.ts` if access control needed

---

## Pattern 2: Asynchronous Pipeline & Progress Meters

**File**: `memory/arch_async_pipeline_progress_20260521-1541-CCT.md`

### Core Idea

Don't block the browser waiting for slow operations. Use 202 Accepted + background workers.

### The Flow

```
User Action (20 videos selected)
    ↓
POST /api/batch/process
    ↓
Returns 202 + batch_id immediately
    ↓
QStash Job Queue (asynchronous processing)
    ├── Process video 1
    ├── Process video 2
    └── ... (guaranteed execution, retries)
    ↓
Redis State (fast polling-friendly)
    ├── batch_xyz:total = 20
    ├── batch_xyz:completed = 3
    └── batch_xyz:failed = 0
    ↓
Frontend Polls /api/batch/status?id=batch_xyz
    ↓
Top-bar progress meter updates in real-time
```

### Key Benefits

- ✅ Browser unlocks immediately (202 response)
- ✅ User can navigate freely (background processing continues)
- ✅ No timeout risk (streaming connection not required)
- ✅ Resilient (QStash retries guarantee delivery)
- ✅ Fast polling (Redis counters, not database queries)

### Implementation Steps

1. Create `POST /api/batch/process` endpoint
2. Validate input, generate batch_id immediately
3. Return `202 Accepted` with batch_id
4. Queue individual jobs to QStash
5. Increment progress counters in Redis as jobs complete
6. Create `GET /api/batch/status?id=batch_id` polling endpoint
7. Frontend polls every 2 seconds via SWR

---

## Pattern 3: SWR/Zod/Zustand Matrix

**File**: `memory/arch_swr_zod_zustand_matrix_20260521-1541-CCT.md`

### Core Idea

Three-layer state architecture: validate data (Zod) → fetch periodically (SWR) → manage UI state globally (Zustand).

### The Stack

```
┌──────────────────────┐
│   UI Components      │
│  (Progress Meter)    │
└──────────────────────┘
           ↑ (React Binding)
┌──────────────────────┐
│  Zustand Store       │
│  (Global UI State)   │
└──────────────────────┘
           ↑ (State Injection)
┌──────────────────────┐
│  SWR Hook            │
│  (Poll server)       │
└──────────────────────┘
           ↑ (Validation)
┌──────────────────────┐
│  Zod Schema          │
│  (Type Guard)        │
└──────────────────────┘
```

### Layer 1: Zod (Validation)

```typescript
// lib/schemas.ts
export const BatchStatusSchema = z.object({
  batch_id: z.string().uuid(),
  total: z.number().positive(),
  completed: z.number().nonnegative(),
  failed: z.number().nonnegative(),
});

export type BatchStatus = z.infer<typeof BatchStatusSchema>;
```

**Job**: Reject invalid server data at the entry point.

### Layer 2: SWR (Data Fetching)

```typescript
// hooks/useBatchStatus.ts
export function useBatchStatus(batchId?: string) {
  const { data } = useSWR(
    batchId ? `/api/batch/status?id=${batchId}` : null,
    async (url) => {
      const res = await fetch(url);
      const json = await res.json();
      return BatchStatusSchema.parse(json); // Validate here
    },
    { refreshInterval: 2000 } // Poll every 2 seconds
  );
  return { status: data };
}
```

**Job**: Periodically fetch and validate data, cache results.

### Layer 3: Zustand (Global State)

```typescript
// store/batchStore.ts
export const useBatchStore = create<BatchStore>((set) => ({
  activeBatchId: null,
  isProgressMeterVisible: false,
  setActiveBatch: (id) => set({ 
    activeBatchId: id, 
    isProgressMeterVisible: true 
  }),
  clearActiveBatch: () => set({ 
    activeBatchId: null, 
    isProgressMeterVisible: false 
  }),
}));
```

**Job**: Hold UI-level state (which batch is active, is meter visible).

### The Synergy

```typescript
// Component: TopBarProgressMeter.tsx
export function TopBarProgressMeter() {
  const { activeBatchId, isProgressMeterVisible } = useBatchStore();
  const { status } = useBatchStatus(activeBatchId);

  if (!isProgressMeterVisible || !status) return null;

  return (
    <ProgressBar 
      completed={status.completed}
      total={status.total}
      remaining={status.remaining}
    />
  );
}
```

### Why Three Layers?

- **Zod alone**: Validates but doesn't sync UI
- **SWR alone**: Fetches but doesn't share state globally
- **Zustand alone**: Holds state but can't fetch automatically

**Together**: Clean data → fresh from server → synchronized across entire app.

---

## When to Use Each Pattern

### Pattern 1: Multi-Tenancy & Zero Cost
**Use when**: Adding a new API endpoint to hex-yt-intel  
**Ask**: "Does this need a separate Vercel project?" → No, path-based routing in one project.

### Pattern 2: Async Pipeline & Progress Meters
**Use when**: Processing takes >5 seconds or affects multiple resources  
**Ask**: "Can the user wait synchronously?" → No, use 202 + background workers.

### Pattern 3: SWR/Zod/Zustand Matrix
**Use when**: Need real-time UI updates that survive route navigation  
**Ask**: "Should this update globally across the app?" → Yes, validate + poll + store.

---

## Directory Structure (When Implemented)

```
web/
├── app/api/
│   ├── batch/
│   │   ├── process/route.ts      (202 Accepted, enqueue to QStash)
│   │   └── status/route.ts       (Poll Redis for progress)
│   └── pdf/
│       └── route.ts              (PDF generation via QStash worker)
│
├── hooks/
│   ├── useBatchStatus.ts         (SWR + Zod validation)
│   └── ...
│
├── store/
│   ├── batchStore.ts             (Zustand: active batch, UI state)
│   └── ...
│
├── lib/
│   ├── schemas.ts                (Zod validation rules)
│   └── ...
│
└── components/
    ├── TopBarProgressMeter.tsx   (Reads Zustand, uses useBatchStatus)
    └── ...
```

---

## References

- **Memory**: `/home/kellyb_dev/.claude/projects/-home-kellyb-dev-projects-hex-yt-intel/memory/`
- **Session Snapshot**: `docs/history/SESSION_SNAPSHOT_20260521-1541-CCT.md`
- **CLAUDE.md**: Project root, Section: THE FROZEN STACK PROTOCOL

---

## SWR, Zod, and Zustand Implementation Blueprint

The client-state architecture handles background synchronization, interface stability, and type-safe schema verification across the entire application lifecycle.

### How They Wire Together

- **Zod (Perimeter Guard)**: Validates the shape of incoming data directly at the `fetcher` boundary of SWR. If the server response schema mutates or returns corrupted keys, Zod catches it before it corrupts client-side states.
- **SWR (State Synchronizer)**: Handles local component-level memory caching, tab-focus revalidation, and automatic polling interval management (e.g., every 2 seconds during active processing).
- **Zustand (Global UI Coordinator)**: Manages global, layout-independent UI states (e.g., driving the absolute tracking visibility of the top-bar progress meter across navigation boundaries).

See `memory/arch_swr_zod_zustand_matrix_20260521-1541-CCT.md` for complete implementation code samples.

---

## The Asynchronous Multi-File/List Pipeline

To build a continuous batch processing experience that handles broad YouTube lists or channel crawls without interface lockups or background execution timeouts, leverage path-based micro-routing within a single Vercel project container.

### Processing Flow

```
[UI Dashboard View] 
      │ 
      ▼ (Selects 50 Videos)
[POST /api/batch/process] ────► [Generates Batch ID & Seeds Redis State]
      │ 
      ▼ (Returns Immediate HTTP 202 Accepted)
[Frontend Unlocks UI] ◄──────── [SWR initiates /api/batch/status Polling]
      │
      ▼ (Asynchronous Offloading)
[QStash Task Queues] ─────────► [Background Execution: Workers process LLM & PDF]
                                       │
                                       ▼ (Increments Telemetry Counter)
                                [Upstash Redis Stores State Key]
```

### Decoupled Execution Workflow

1. **Immediate Resolution Boundary (HTTP 202)**: The user multi-selects channel uploads or custom video buckets on the frontend dashboard and hits "Process Batch". The frontend instantly receives an `HTTP 202 Accepted` payload containing a unique reference identifier (`batch_id`). The UI unlocks immediately.

2. **Telemetry-Safe State Store**: The actual analytical logic is dispatched across a distributed task execution system using QStash. It processes the analysis and isolates the serverless generation loops independently.

3. **Transient Processing Progress Tracker**: The status metric increments real-time execution states (`completed`, `failed`) inside high-concurrency Upstash Redis memory blocks. SWR pulls down this validation object directly at set time steps, feeding the top-bar indicator smoothly while the user navigates across independent pages.

See `memory/arch_async_pipeline_progress_20260521-1541-CCT.md` for complete implementation checklist.

---

## Sprint Handover Validation

The hardening phase executed by the terminal agent (CCT) has established a definitive, type-safe development baseline for the application architecture.

### Build Status Summary

```
hex-yt-intel Build Status: PRODUCTION-READY
┌──────────────────────────────┬────────┬──────────────────────────────────────────┐
│ Module                       │ Status │ Remediation Profile                      │
├──────────────────────────────┼────────┼──────────────────────────────────────────┤
│ Quota Circuit Breakers       │  ✅    │ Null coalescing defaults safely to 'free'│
│ Sentry Log Optimization      │  ✅    │ Direct clean object metadata context     │
│ Vercel Gateway Perimeter     │  ✅    │ Multi-UA client spoof rotation active    │
│ Monorepo Micro-Routing Layer │  ✅    │ Isolated nodejs /api/pdf context online  │
└──────────────────────────────┴────────┴──────────────────────────────────────────┘
```

The system layout is clear. The underlying data-fetching routes, runtime configuration checks, error registry structures, and cross-package workspace roots are completely aligned. The project state has fully synchronized. Phase 1 structural stabilization is officially closed.

---

## Status

✅ **Documented** — Ready for Phase 2 implementation  
✅ **Sprint Hardening Validated** — All modules production-ready  
⏳ **Not Yet Implemented** — Waiting for batch operations requirements

When Phase 2 begins (batch PDF generation, multi-video processing), refer back to these patterns for architectural guidance.
