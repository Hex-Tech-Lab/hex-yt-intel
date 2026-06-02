# Agent Responsibilities & Workflows (v1.4.1)

---

## 1. AGENT IDENTITIES

### GC (Gemini CLI)
- **Role**: Structural File Refactor & Git Integration Lead.
- **Ownership**: `GEMINI.md`, Root Maintenance.
- **Specialty**: 10x Verification, Deep Audit, Housekeeping Cycles.

### GCW (Gemini Web)
- **Role**: Strategic Decision Documentation & Pipeline Orchestrator.
- **Specialty**: ADR Synthesis, Infographics, External API coordination.

### CCT1 (Collaborative Coding Technician)
- **Role**: Vertical Execution Lead for Edge Stabilization.
- **Assignment**: Implementation of the Hybrid Edge Symphony (ADR 005).
- **Workflow**:
    1. **Bouncer Refactor**: Next.js route → fast token gate.
    2. **Secure Persistence**: HMAC-verified `/persist` endpoint.
    3. **Hook Synchronization**: Frontend streaming engine orchestration.

---

## 2. VERTICAL EXECUTION FLOW (ADR 005)

When assigned a vertical architecture task, agents must follow this sequence:

1.  **Preparation**: Validate HMAC secrets (`STREAM_HMAC_SECRET`) in environment.
2.  **Implementation**:
    -   Refactor `web/app/api/analyses/route.ts` to ~8s execution.
    -   Harden `web/app/api/analyses/persist/route.ts` with `verifyContentSig`.
    -   Sync `web/hooks/useSSEStream.ts` to establish direct Worker connection.
3.  **Validation**:
    -   `pnpm type-check` (Strict mode clean).
    -   `pnpm build` (Next.js + Worker).
    -   E2E Stream test (Verify markdown saves in DB after stream close).
4.  **Bumping**: Update monorepo versions to `1.4.1`.

---

## 3. HOUSEKEEPING PROTOCOL

Every 10 turns or 5 commits, a "Housekeeping Cycle" must be initiated by GC:
- [ ] Verify version parity across root/web/worker.
- [ ] Document all ADRs and version inflections in `/docs/history/`.
- [ ] Synchronize `PRD.md` with current feature reality.
- [ ] Clean working tree and verify `GEMINI.md` strategic intent.
