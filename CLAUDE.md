# hex-yt-intel: Master Infrastructure & Architectural Spec (v1.4.2)

---

## 1. CORE ARCHITECTURAL LAWS

### Law #1: Pre-Query Cache Hit Circuit
Before EVERY analysis request, the system must query the Supabase `analyses` table matching the `video_id` and `user_id`. If found, it returns the cached markdown instantly.

### Law #2: Stratified Dual-Timeouts
The OpenRouter model fallback sequence utilizes a stratified dual-timeout architecture:
- **Connection Handshake**: 3-second hard timeout.
- **Token Streaming Window**: 25-second (Vercel) / 90-second (Worker) maximum read.

### Law #3: Streaming Response Execution
All analytical route handlers MUST implement dynamic response streaming to extend the connection lifetime.

### Law #4: Hybrid Edge Symphony (ADR 005)
The platform utilizes a multi-cloud hybrid flow:
- **Vercel**: Auth/Quota Bouncer (~8s).
- **Cloudflare**: High-latency LLM Streaming (~58s).
- **S2S /persist**: Tamper-proof server-to-server data persistence using HMAC signatures.

---

## 2. SHARED COMMUNICATION PROTOCOL (.memory/AGENT_LEDGER.md)

To enable high concurrency without toe-stepping, all agents MUST use the shared ledger:
1. **Read**: View `.memory/AGENT_LEDGER.md` before starting any task or file mutation to avoid active files.
2. **Write**: Append an `[IN_PROGRESS]` line specifying your intent, target files, and timestamp.
3. **Update**: Change your line to `[DONE]` when the task is complete.
4. **Orchestrator "Sink" Pattern**: For complex workflows (e.g., PR Reviews), the lead agent logs `[SINK: Workflow Name]`. Sibling agents log sub-tasks but **cannot** finalize or merge the overall workflow. Only the Sink Orchestrator is responsible for testing, verifying, merging, and closing out the overarching task.

---

## 3. THE ADR LEDGER (Architectural Decision Records)

| ADR | Date | Title | Status |
|---|---|---|---|
| 001 | 2026-05-12 | Supabase-only Auth Migration | ✅ |
| 002 | 2026-05-14 | Atomic Quota Enforcement (Upstash Redis Lua) | ✅ |
| 003 | 2026-05-16 | LLM Model Cascade (nemotron-3-nano lead + free fallbacks → Haiku 4.5) | ✅ |
| 004 | 2026-05-21 | Request-Scoped Supabase Client | ✅ |
| 005 | 2026-06-01 | Hybrid Edge Architecture (Vercel/CF) | ✅ |
| 006 | 2026-06-06 | Structured JSON Streaming (see `docs/specs/ADR_006_STRUCTURED_JSON_STREAMING_2026-06-06.md`) | ✅ |
| 007 | 2026-07-05 | Stuck-Analysis Reaper (QStash-driven finalize sweep for orphaned `processing` rows; PR #110) | ✅ |
| 008 | 2026-07-07 | Chat Grounding Security Gate — no usable analysis ⇒ refuse, never answer from general knowledge (PR #125) | ✅ |
| 009 | 2026-07-07 | Chat Conversation↔Analysis Ownership Binding — owner-verified at creation + userId-scoped grounding read (PR #126) | ✅ |
| 010 | 2026-07-07 | Dimension-0 Executive Digest — single idempotent cheap-cascade completion, uncounted (PR #127) | ✅ |
| 011 | 2026-07-10 | LLM Model Routing Policy & Fallback Cascade Strategy (Wave 7 clarification; Haiku 4.5 primary, separate CHAT_CASCADE for digest) | ✅ |
| 012 | 2026-07-19 | Ephemeral Transcript Storage & 72h Compliance Retention Pipeline — new transcripts/transcript_markers tier + retention enforcement | ✅ |
| 013 | 2026-07-19 | CI-Automated Production Schema Migration via `supabase db push` — ci-cd.yml runs on migrations/ with no manual gate | ✅ |
| 014 | 2026-07-19 | Video-ID-Scoped Chat Grounding Fallback — chat_conversations.video_id column alongside ADR 009 analysis-scoped ownership binding | ✅ |
| 015 | 2026-07-19 | PR Confidence Calculator Fail-Closed Semantics — tool-query failures score 0 (not 100 false-confidence) as of 2026-07-19 re-audit fix | ✅ |
| 016 | 2026-07-19 | External Research-Harness API Key Boundary & Rotation Policy — SerpAPI/Exa/Decodo keys in scripts/research/; rotation tracked as ops task | ✅ |

Full rationale for 008–010 in `docs/history/HANDOVER_2026-07-07-CHAT-SECURITY-AND-DIM0.md` §2 and `.memory/ADRS.md`.

---

## 4. INFRASTRUCTURE COORDINATES

- **Vercel App**: `https://hex-yt-intel.vercel.app` (prod domain: `https://yt-intel.getmytestdrive.com`)
- **CF Worker**: `https://yt-intel.hex-tech-lab.workers.dev`
- **DB Ref**: `adnmbikaqnxivalqoild` (Supabase — matches `NEXT_PUBLIC_SUPABASE_URL`)
- **Redis**: Upstash (Rate limiting / KV Cache)

---

## 5. THE FROZEN STACK PROTOCOL (GCT Aligned — 2026-05-23)

**Package Management**: `pnpm` only  
**CSS Framework**: Tailwind CSS + shadcn/ui exclusively

### Runtime & Build Infrastructure
- **Node.js**: 24.16.0 LTS
- **pnpm**: 11.9.0 (source of truth: package.json packageManager field; synced to action.yml + CI workflows)
- **Next.js**: 16.2.6
- **TypeScript**: 5.6.2

---

## 6. PR CONFIDENCE CALCULATOR (WAVE 6 — 2026-07-09)

### Purpose
Multidimensional PR readiness scoring system that evaluates code quality across six independent tools. Designed as an **informational decision gate** (never blocking merge) to help team members assess PR maturity before review.

### Scoring Formula

| Tool | Category | Max Points | Criteria |
|---|---|---|---|
| **Cubic** | Code Architecture | 30 | Review score extracted from Cubic comments (normalized to 30) |
| **CodeRabbit** | Code Review | 20 | Passed checks from CodeRabbit review tool |
| **Snyk** | Security | 15 | Resolved security findings count |
| **CI/CD** | Automation | 10 | All GitHub Actions checks passed |
| **Vercel** | Deployment | 5 | Deployment status = READY or PRODUCTION |
| **CodeQL** | Static Analysis | 5 | Zero critical/high-severity alerts |

**Confidence = (Total Points ÷ 85) × 100%**

### Recommendations

| Confidence | Status | Action |
|---|---|---|
| **≥85%** | MERGE READY | Safe to merge; all quality gates met |
| **70–84%** | ACCEPTABLE (minor debt) | Mergeable; minor findings remain |
| **50–69%** | AT RISK (review findings) | Review findings present; address before merge |
| **<50%** | NOT READY (critical issues) | Critical issues identified; do not merge |

### Usage

#### CLI (Local Development)
```bash
npm run pr:confidence --pr=129
```

#### GitHub Actions (Automatic)
- Runs automatically in CI/CD pipeline on every PR
- Score is appended to the final status comment
- Does **not** block merge (informational only)

#### Manual Query
```bash
pnpm dlx tsx scripts/calculate-pr-confidence.ts --pr=129
```

### Output Format

**JSON (Machine-Readable)**
```json
{
  "pr": 129,
  "confidence": 92,
  "breakdown": {
    "cubic": 28,
    "coderabbit": 18,
    "snyk": 15,
    "ci_cd": 10,
    "vercel": 5,
    "codeql": 5
  },
  "recommendation": "MERGE READY",
  "details": {
    "cubic_comment": "Excellent architecture...",
    "coderabbit_comment": "18 checks passed",
    "snyk_comment": "All issues resolved",
    "ci_status": "all-passed",
    "vercel_status": "READY",
    "codeql_alerts": 0
  },
  "timestamp": "2026-07-09T12:00:00.000Z"
}
```

**Human-Readable Summary** (console output)
```
📊 Calculating PR Confidence for #129...

📈 Breakdown:
  Cubic:       28/30
  CodeRabbit:  18/20
  Snyk:        15/15
  CI/CD:       10/10
  Vercel:       5/5
  CodeQL:       5/5
  ─────────────────────
  Total:       81/85

🎯 Confidence: 95% (MERGE READY)
```

### Implementation Details

**File**: `/scripts/calculate-pr-confidence.ts` (373 LOC)

**Data Sources**:
- GitHub API (comments, check runs, deployments, code-scanning alerts)
- Review tool bot comments (Cubic, CodeRabbit, Snyk)
- GitHub Actions check results
- Vercel deployment status
- CodeQL analysis results

**Tool Detection**:
- Cubic: Regex pattern `cubic[:\s]+([0-9]+)` on PR comments
- CodeRabbit: Regex pattern `(\d+)\s+passed` + score normalization
- Snyk: Count of `resolved|fixed` keywords in comments
- CI/CD: All check runs in pull_request merge commit
- Vercel: PR comments from Vercel bot containing "READY" or "PRODUCTION" status
- CodeQL: Code-scanning alerts filtered by severity (critical/high)

**Error Handling**:
- Graceful fallback: Missing tools default to 0 points (doesn't crash calculator)
- GitHub API failures are logged but do not block output
- Invalid/malformed scores cap at tool's maximum points

### Integration with CI/CD

**Modified**: `.github/workflows/ci-cd.yml` → `final-status` job

1. Runs after all quality checks (type-check, lint, build, security)
2. Invokes `calculate-pr-confidence.ts --pr=${{ github.event.pull_request.number }}`
3. Appends confidence score + breakdown table to the final PR status comment
4. Labeled as "FYI — Confidence score is informational and does not block merging"

### Philosophy

**Why Informational, Not Blocking?**
- No single metric can capture true merge readiness
- Context matters: risky refactors may score lower but be necessary
- Team judgment always overrides automation
- Prevents "gaming" the score by chasing points

**Complementary Tools**:
- Code reviews (human judgment)
- Architectural ADRs (design decisions)
- Integration tests (real-world behavior)
- Manual security audits (domain expertise)

### Testing

Tested against PR #129 (baseline, known good state):
- **Expected**: Confidence ≥85% (MERGE READY)
- **Status**: ✅ Verified during Wave 6 implementation

See `docs/LESSONS_LEARNED.md` line 102 for the original formula rationale.
