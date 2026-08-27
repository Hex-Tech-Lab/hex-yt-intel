# Agent Dispatch Prompt — enforce-ssot-takeaway-linkage

**Target Agent**: AGY-1 (Claude Code / Pro)
**Effort Level**: medium

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

---

## 1. Context & Objective

We have stabilized the transport and persistence plumbing on `main` (`de36e565`). Now we must enforce semantic Single Source of Truth (SSOT) linkage by ensuring that every highlight segment and chat prompt record explicitly carries a `parent_takeaway_idx` pointing to its macro Dim.0 takeaway pillar.

---

## 2. Implementation Directives

### 1. Schema & Validator Update (`web/lib/validators/highlights.ts`)
- Update `HighlightSegmentSchema` to accept an optional `parent_takeaway_idx` (or `takeaway_idx`):
```typescript
export const HighlightSegmentSchema = z.preprocess(
  (val) => {
    // ... existing preprocessing ...
    const raw = val as Record<string, unknown>;
    return {
      ...raw,
      parent_takeaway_idx: typeof raw.parent_takeaway_idx === 'number' ? raw.parent_takeaway_idx : (typeof raw.takeaway_idx === 'number' ? raw.takeaway_idx : undefined),
    };
  },
  z.object({
    id: z.string().optional(),
    start: z.number().min(0),
    end: z.number().min(0),
    title: z.string().min(1),
    summary: z.string().optional(),
    parent_takeaway_idx: z.number().int().min(0).optional(),
  }).passthrough()
);
```

### 2. Worker Extraction Context (worker/src/services/ or extraction prompt)
Ensure the eager highlight extraction QStash job passes the generated Dim.0 takeaway titles/indices into the highlight extractor prompt context so the LLM explicitly links micro-moments to macro pillars.

### 3. Registry Context Caps (ROE Compliance)
In the settings/registry config, enforce ROE context injection limits:
- Max Takeaways: 10
- Max Highlight Temporal Anchors: 18
- Max KG Nodes: 24

### 3. Verification Gates
```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
```
