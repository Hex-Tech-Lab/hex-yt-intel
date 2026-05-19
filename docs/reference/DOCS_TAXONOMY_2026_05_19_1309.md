---
name: DOCS_TAXONOMY
description: Complete documentation folder taxonomy and artifact placement rules
version: v1.0.0
created: 2026-05-19
updated: 2026-05-19
---

# Documentation Taxonomy & Artifact Placement Rules

This document defines where every type of documentation belongs in the hex-yt-intel repository. **All files MUST conform to this structure.**

---

## Folder Structure Overview

```
docs/
├── audit/              → Code reviews, simplification reports, quality audits
├── archive/            → Historical versions, old specs, deprecated docs
├── history/            → Session handovers, context snapshots, incident reports
├── ops/                → Operations procedures, deployment checklists, setup guides
├── reference/          → Static guides, API docs, architecture explanations
├── scripts/            → Runnable scripts, automation tools
├── security/           → Security policies, remediation reports
├── specs/              → Technical specifications, implementation plans
└── testing/            → Test suites, test fixtures, testing guides
```

---

## Artifact Classification & Placement Rules

### 1. Code Review & Audit Reports → `/docs/audit/`

**Purpose**: Diagnostic assessments of code quality, security, or performance.

**File Naming**: `{report_type}_{date}_{time}.md` or `{report_type}_YYYYMMDD.md`

**Examples**:
- `code_review_report_2026_05_16_2008.md`
- `code_simplification_report_2026_05_16_2008.md`
- `security_audit_2026_05_19.md`

**Metadata Required**:
```yaml
---
Filename: code_review_report_2026_05_16_2008.md
Location: /docs/audit/
Version: v1.5.0
Build: 59519b9
Timestamp: Saturday, 16 May 2026 at 18:00:00 EEST
Purpose: High-severity code review findings for Chunk 13 implementation
---
```

**Consolidation Rule**: Keep only the LATEST timestamp per report type. Archive older versions in `/docs/archive/`.

---

### 2. Technical Specifications → `/docs/specs/`

**Purpose**: Detailed engineering specifications, blueprints, and design documents.

**Canonical Files** (one version each):
- `IMPLEMENTATION_PLAN.md` — Phased implementation roadmap
- `PRD.md` — Product requirements document
- `SECURITY.md` — Security architecture and policies
- `design.md` — UI/UX and system design
- `ERROR_TAXONOMY_MANIFEST.md` — Error classification scheme
- `AUTONOMY_SPEC.md` — Autonomous agent specifications

**Metadata Required** (full version headers):
```yaml
---
Filename: IMPLEMENTATION_PLAN.md
Location: /docs/specs/
Version: v2.1.0
Build: a1f4e8c
Timestamp: 2026-05-19 14:30:00 UTC+2
Purpose: Implementation strategy for Chunk 14 (Observability Framework)
---
```

**Version Rule**: ONLY ONE active version per canonical spec. Update in-place, keep git history.

---

### 3. Historical Session Logs → `/docs/history/`

**Purpose**: Temporal records of sessions, handovers, snapshots, and incidents.

**File Naming**: `{type}_{date}.md`

**Examples**:
- `HANDOVER_REPORT_2026_05_16.md`
- `SESSION_EXIT_2026_05_15.md`
- `CONTEXT_SNAPSHOT_2026_05_17.md`
- `INCIDENT_REPORT_token_leak_2026_05_16.md`

**Consolidation Rule**: Use `CONSOLIDATED_` prefix when merging overlapping trial timelines.

---

### 4. Operations & Procedures → `/docs/ops/`

**Purpose**: Runbooks, setup guides, deployment procedures, manual operational steps.

**Examples**:
- `DEPLOYMENT.md` — Production deployment procedure
- `REDIS_SETUP.md` — Redis configuration and seeding
- `VERCEL_ENV_SETUP.md` — Environment variable configuration
- `DEPLOYMENT_CHECKLIST.md` — Pre-deployment verification
- `SUPABASE_SETUP.md` — Database initialization

**Scope**: Document ALL manual steps, environment variables, secret rotation procedures.

---

### 5. Reference Material → `/docs/reference/`

**Purpose**: Static guides, architectural explanations, API documentation, integration instructions.

**Characteristics**:
- **No version churn** — Updated in-place as knowledge evolves
- **Evergreen content** — Not tied to specific sessions or builds
- **Knowledge lookup** — Users consult these for how-tos and explanations

**Examples**:
- `QUICKSTART.md` — Getting started guide
- `API_DOCUMENTATION.md` — REST API reference
- `AUTH_IMPLEMENTATION_SUMMARY.md` — Auth system overview
- `PROJECT_SUMMARY.md` — High-level project description
- `AGENT_WORKFLOW_INSTRUCTIONS.md` — Multi-agent orchestration guide
- `DOCS_TAXONOMY.md` — This file

---

### 6. Test Suites & Fixtures → `/docs/testing/`

**Purpose**: Test specifications, test fixtures, test data, testing guides.

**Examples**:
- `OAUTH_TESTING_CHECKLIST.md` — OAuth flow test steps
- `chunk-21-performance-review-matrix.md` — Performance testing specifications
- Playwright spec files
- E2E test fixtures

---

### 7. Security Documents → `/docs/security/`

**Purpose**: Security policies, remediation reports, incident response records.

**Examples**:
- `remediation_2026_05_16.md` — Security incident fixes
- `SECURITY_INCIDENT_RESPONSE_PLAN.md` — Incident response procedures

---

### 8. Archive → `/docs/archive/`

**Purpose**: Historical versions, obsolete specs, deprecated documentation.

**Rules**:
- Old versioned files: `*_v1.0_FINAL.md`, `*_v2.0_FINAL.md`
- Previous implementations that were superseded
- Consolidated session logs that have been archived

**Never Delete**: Keep for reference and continuity, but don't update.

---

## Root Directory Rules (MANDATORY)

**Maximum 4 markdown files in repository root:**

1. `CLAUDE.md` — Primary development agent instructions
2. `GEMINI.md` — Cross-tool orchestration agent instructions
3. `README.md` — Project overview
4. `AGENTS.md` — Multi-agent system documentation

**All other documentation MUST be in `/docs/` subdirectories.**

Run to verify:
```bash
find . -maxdepth 1 -name "*.md" | wc -l
```

Should return **exactly 4**.

---

## File Naming Conventions

### For Timestamped Reports

Use ISO 8601 with time precision for reports that accumulate multiple versions:

```
{report_type}_{YYYY}_{MM}_{DD}_{HHMM}.md
```

Examples:
- `code_review_report_2026_05_16_2008.md`
- `code_simplification_report_2026_05_16_2008.md`
- `handover_2026_05_16.md`

### For Canonical Specs

Use descriptive names WITHOUT version numbers (version lives in frontmatter):

```
{spec_name}.md
```

Examples:
- `IMPLEMENTATION_PLAN.md` (not `IMPLEMENTATION_PLAN_v2.0.md`)
- `SECURITY.md` (not `SECURITY_v1.5.md`)

---

## Metadata Requirements by Folder

| Folder | Filename | Version | Build | Timestamp | Purpose |
|--------|----------|---------|-------|-----------|---------|
| `/specs/` | ✅ | ✅ Frontmatter | ✅ | ✅ ISO 8601 | ✅ Engineering intent |
| `/audit/` | ✅ | ✅ Frontmatter | ✅ | ✅ ISO 8601 | ✅ Assessment scope |
| `/history/` | ✅ | ❌ N/A | ✅ | ✅ ISO 8601 | ✅ Session context |
| `/ops/` | ✅ | ❌ N/A | ❌ | ✅ Update date | ✅ Procedure purpose |
| `/reference/` | ✅ | ❌ N/A | ❌ | ✅ Update date | ❌ (implied by filename) |
| `/testing/` | ✅ | ✅ Optional | ❌ | ✅ Optional | ✅ Test scope |

---

## Consolidation Rules

### When Multiple Versions Exist

1. **Code Review Reports**: Keep the LATEST timestamp, archive older copies
2. **Technical Specs**: Update in-place (only one version), old versions in `/archive/`
3. **Session Logs**: Consolidate overlapping timelines with `CONSOLIDATED_` prefix

Example consolidation:
```
BEFORE:
  docs/code_review_report.md                          (May 16, 18:00)
  docs/code_review_report_2026_05_16_2008.md          (May 16, 20:08) ← LATEST
  docs/reference/code_review_report.md                (duplicate)
  docs/archive/code_review_report.md                  (duplicate)

AFTER:
  docs/audit/code_review_report_2026_05_16_2008.md    (kept)
  docs/archive/code_review_report_2026_05_16_legacy.md (old version archived)
```

---

## Git Commit Message Format for Reorganization

When moving files, use:

```
docs(taxonomy): consolidate {type} reports to /docs/{folder}/

- Move code_review_report_*.md to /docs/audit/
- Consolidate {count} duplicates, keep latest timestamp
- Archive old versioned files
- Clean root /docs/ directory
```

---

## Verification Checklist

Run these commands to ensure compliance:

```bash
# 1. Verify root has exactly 4 files
find . -maxdepth 1 -name "*.md" | wc -l
# Expected: 4

# 2. Verify no orphaned .md files in /docs/ root
find docs -maxdepth 1 -name "*.md" | wc -l
# Expected: 0

# 3. Check for duplicate filenames across folders
find docs -name "*.md" -type f | sort | uniq -d
# Expected: (no output)

# 4. Verify all spec files in /specs/
ls docs/specs/
# Should contain: IMPLEMENTATION_PLAN.md, PRD.md, SECURITY.md, design.md, etc.

# 5. Verify audit reports in /audit/
ls docs/audit/
# Should contain timestamped code_review_*.md files
```

---

## Last Updated

- **Date**: 2026-05-19
- **By**: Housekeeping Refactor v1.0
- **Status**: ✅ Active taxonomy in use

---

**Remember**: Documentation organization is a living system. Update this file as new artifact types emerge, and audit the structure quarterly.
