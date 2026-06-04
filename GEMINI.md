# hex-yt-intel: Master Workspace Configuration (Gemini Directive)

---

## 1. LOCALIZED SYSTEM ADDRESSING & IDENTITY

### GCW (Gemini Web)
- **Role**: Cross-Tool Pipeline Orchestrator
- **Responsibilities**: 
  - Cross-tool pipeline orchestration
  - Synthesis profiles and informative infographics
  - Strategic decision documentation
  - Third-party API integrations

### GC (Gemini CLI)
- **Role**: Git Integration Lead
- **Owns**: `GEMINI.md` (this file)
- **Responsibilities**:
  - Structural file refactors
  - PR merges and git integration
  - Enforcing folder/file volume constraints

---

## 2. THE FROZEN DESIGN SYSTEM & CODE QUALITY GATES (GCT Aligned — 2026-05-23)

**Package Management**: `pnpm` only (exact version: 11.1.3)  
**CSS Framework**: Tailwind CSS + shadcn/ui exclusively  
**Runtime**: Node.js 24.16.0 LTS (pinned for CI/deployment)

### Frozen Infrastructure Coordinates (CC Authority)
- **Node.js**: 24.16.0 (strict pin)
- **pnpm**: 11.1.3 (tested workspace isolation)
- **Next.js**: 16.2.6 (locked)
- **TypeScript**: 5.6.2 (locked)
- **Zustand + Zod**: ALWAYS ALIGNED (5.0.13 + 4.4.3) — state & validation perimeter
- **Supabase Auth**: Only auth pattern (`getSupabaseClientWithAuth()` server-side only)

### Permanently Banned Dependencies
- ❌ Material-UI (`@mui/material`)
- ❌ Emotion styling (`@emotion/react`, `@emotion/styled`)
- ❌ Any runtime CSS-in-JS injection engine
- ❌ `next-auth` (removed 2026-05-23 — Supabase only)

**Rationale**: This absolute ban is strictly enforced to maintain the **89% production bundle compression ratio** achieved by our native Tailwind components and guarantees pure Edge Runtime compatibility. Next-Auth removed in favor of native Supabase `getSupabaseClientWithAuth()` pattern.

### Root File Volume Restriction
There is a strict maximum of **4 Markdown elements** allowed in the repository root directory:
1. `CLAUDE.md`
2. `GEMINI.md`
3. `README.md`
4. `AGENTS.md`

---

## 3. THE COMPLETE ARTIFACT PLACEMENT TAXONOMY

To prevent multi-agent folder pollution and ensure consistent discovery patterns, **all Gemini family tools (GC/GCW) are explicitly instructed to ONLY write artifacts behind their designated `/docs/` sub-directories**.

| Artifact Class | Storage Location | File Naming Pattern | Master Engineering Rule |
|---|---|---|---|
| **Master Configs** | `/.claude/`, `/` (Root) | `CLAUDE.md`, `GEMINI.md`, `README.md`, `AGENTS.md` | **MAXIMUM 4 markdown files in root directory.** All other docs must be nested in `/docs/`. |
| **Technical Specs** | `/docs/specs/` | `IMPLEMENTATION_PLAN.md`, `PRD.md`, `design.md`, `SECURITY.md` | Must include full version headers: Filename, Location, Version, Build, Timestamp, Purpose. |
| **Historical Logs** | `/docs/history/` | `HANDOVER_REPORT_*.md`, `SESSION_EXIT_*.md`, diagnostic reports | Consolidate overlapping trial timelines into singular chronological ledgers. |
| **Infrastructure Scripts** | `/docs/ops/` | `DEPLOYMENT.md`, `REDIS_SETUP.md`, `VERCEL_ENV_SETUP.md`, runbooks | Document all manual steps, environment variable requirements, and secret rotation. |
| **Testing Suites** | `/docs/testing/` | `OAUTH_TESTING_CHECKLIST.md`, Playwright specs, E2E fixtures | Include pre-conditions, test steps, expected outcomes, and failure recovery procedures. |
| **Reference Material** | `/docs/reference/` | guides, checklists, API documentation, architectural explanations | Static markdown that supports knowledge lookup. No version churn required. |
| **Source Code** | `/web/`, `/worker/`, `/packages/` | TypeScript, Next.js, Cloudflare config | Strict rule: **Code and docs are separate.** Documentation lives in `/docs/`, not in code comments. |

---

## 4. THE EDGE INFRASTRUCTURE & BACKEND LAWS

### Law #1: Pre-Query Cache Hit Circuit
Before EVERY analysis request, the system must query the Supabase `analyses` table matching the `video_id` and `user_id`. If found, it returns the cached markdown instantly. 
**Goal**: Saving duplicate video tokens across multi-agent sessions and delivering $0 cost queries.

### Law #2: Stratified Dual-Timeouts
The OpenRouter model fallback sequence utilizes a stratified dual-timeout architecture:
- **Connection Handshake**: 3-second hard timeout (detects network faults early)
- **Token Streaming Window**: 25-second maximum streaming read (an adaptive horizon engineered to fit just inside the Vercel execution limit).

### Law #3: Streaming Response Execution
All analytical route handlers MUST implement dynamic response streaming to extend the connection lifetime beyond Vercel's standard 10-second Serverless limit:

```typescript
// Keep connection alive with chunked response streaming
// This extends execution window to ~25 seconds by maintaining the HTTP connection
const response = new NextResponse();
response.headers.set('Content-Type', 'application/json');
// Chunk data back to client as it generates
```

**Goal**: By chunking markdown generation back to the client as it produces tokens, we extend the effective timeout window to match our 25-second adaptive task horizon, without sacrificing compatibility with next-auth and other Node.js libraries.

---

## 5. THE 10x VERIFICATION PREFLIGHT MANDATE

### Institutional Rule: Pre-Execution Confirmation Checks
Before writing any file mutations, running automated pipeline pushes, or executing concurrent agent tasks, the agent MUST execute a local preflight check to confirm if the fix has already been implemented by a sibling agent. **Never assume an error state exists without running local confirmation commands.**

**This prevents**:
- Duplicate fix attempts across multi-agent sessions (wasted CPU/tokens)
- Race conditions from concurrent file writes (git merge conflicts)
- Silent overwrite of sibling agent improvements
- Redundant commit history pollution (multiple fixes for same issue)

### Preflight Verification Checklist

Before EVERY code mutation or pipeline operation:

1. **For Source Code Changes**:
   - `git status` — Confirm working tree state (nothing uncommitted from other agents)
   - `git diff HEAD <file>` — Check if target file already has the fix
   - `grep -r "pattern" web/` — Verify the problem still exists before fixing it

2. **For Dependency/Build Issues**:
   - `cd web && pnpm list <package>` — Confirm current package state
   - `cat pnpm-lock.yaml | grep <package>` — Verify lock file dependencies
   - `pnpm build --dry-run` — Check if build issue persists before applying fix

3. **For Configuration Files**:
   - `find . -maxdepth 1 -name "*.md" | wc -l` — Verify root folder structure (max 4 files)
   - `ls -la .vercelignore` — Check if ignore rules already exist
   - `grep -n "pattern" CLAUDE.md` — Confirm if documentation is already current

4. **For API/Route Changes**:
   - `grep -A5 "return" web/middleware.ts` — Verify early return statements are present
   - `grep -r "export const runtime" web/app/api/` — Check Edge Runtime configuration

### Implementation Pattern
```typescript
// MANDATORY PREFLIGHT PSEUDOCODE:
const shouldProceed = async () => {
  const fileState = await exec('git diff HEAD <file>');
  if (fileState.includes(expectedFix)) {
    console.log('✅ Fix already applied by sibling agent');
    return false; // SKIP THIS FIX
  }
  
  const buildTest = await exec('pnpm build');
  if (buildTest.error && buildTest.error.includes(expectedError)) {
    console.log('⚠️ Error confirmed, proceeding with fix');
    return true; // APPLY THE FIX
  }
  
  return false; // ERROR DOES NOT EXIST
};
```

### Documentation
All preflight checks executed MUST be logged:
- **If fix already applied**: "Sibling agent fix detected at [commit hash], skipping redundant application"
- **If error confirmed**: "Error confirmed via [command], proceeding with [fix name]"
- **If error not found**: "Error not reproduced locally, aborting [fix name]"

**Benefit**: 10x reduction in duplicate fixes, dramatically cleaner git history, zero silent overwrites of concurrent work.

---

## 7. PHASE 1 COMPLETION & PHASE 2 READINESS (2026-06-01)

**Current Status**: ✅ Phase 1 COMPLETE | 🚀 Phase 2 (Hybrid Edge Symphony) IN PROGRESS

### Phase 2 Strategic Intent: The Hybrid Symphony
The system is transitioning to a triple-redundant hybrid model (ADR 005) to solve serverless execution limits and secure background persistence.

**Responsibilities for Phase 2**:
1. **Strategic Synthesis**: Document Hybrid architecture decisions (Vercel Bouncer + Cloudflare Streamer).
2. **Multi-Tool Orchestration**: Secure S2S `/persist` flow via HMAC.
3. **Handover Documentation**: Update 10x THOS with cryptographic isolation lessons.
4. **Infographics**: Visualize the bouncer-to-edge lifecycle.

**Reference**: `/docs/specs/ADR_005_HYBRID_EDGE_ARCHITECTURE.md`

### Phase 1→2 Transition Gate

**Do not proceed with Phase 2 until**:
- ✅ Upstash Vector Index verified (URL + TOKEN set)
- ✅ Search schema approved (analysis_id, title, excerpt, score, created_at)
- ✅ User feedback loop implemented (re-analyze button working)
- ✅ All Phase 1 systems verified (Known Good State checklist)

**See**: `/docs/ops/KNOWN_GOOD_STATE_CHECKLIST.md` (25-item verification)

---

## 8. MASTER CHANGELOG LEDGER

- **2026-06-04**: Fix (hardening): Implement API resilience (Edge runtime, streaming, dual-timeout), refactor UI to Tailwind, and migrate docs to markdown.
- **2026-06-04**: Fix (review): Processed structural UX epic recommendations; resolved PDFKit type issues and secured analysis route via getSupabaseClientWithAuth().
- **2026-06-04**: Feat (ux): Complete 5-part structural epic (layout trapping, history restoration, dimension drawers, tier-gated PDFs, stance relations engine) and merge to main.