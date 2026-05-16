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

## 2. THE FROZEN DESIGN SYSTEM & CODE QUALITY GATES

**Package Management**: `pnpm` only  
**CSS Framework**: Tailwind CSS + shadcn/ui exclusively

### Permanently Banned Dependencies
- ❌ Material-UI (`@mui/material`)
- ❌ Emotion styling (`@emotion/react`, `@emotion/styled`)
- ❌ Any runtime CSS-in-JS injection engine

**Rationale**: This absolute ban is strictly enforced to maintain the **89% production bundle compression ratio** achieved by our native Tailwind components and guarantees pure Edge Runtime compatibility.

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