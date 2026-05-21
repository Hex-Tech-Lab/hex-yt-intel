# Architecture Patterns: hex-yt-intel

**Last Updated**: 2026-05-21  
**Documented In**: Session Snapshot + Memory files  
**Status**: Ready for Phase 2 implementation

Three architectural patterns are documented and ready for implementation when building batch operations, PDF generation, and real-time progress tracking features.

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

## Status

✅ **Documented** — Ready for Phase 2 implementation  
⏳ **Not Yet Implemented** — Waiting for batch operations requirements

When Phase 2 begins (batch PDF generation, multi-video processing), refer back to these patterns for architectural guidance.
