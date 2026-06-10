# hex-yt-intel (v1.4.1)
### YouTube Content Intelligence: The Hybrid Edge Symphony

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Phase](https://img.shields.io/badge/Phase-2%20Stabilization-orange.svg)](ROADMAP.md)
[![Architecture](https://img.shields.io/badge/Arch-Hybrid%20Edge-success.svg)](docs/specs/ADR_005_HYBRID_EDGE_ARCHITECTURE.md)

---

## ⚖️ LEGAL & COMPLIANCE

**This repository is licensed under [GNU AGPL-3.0](LICENSE).**

**Important**: This repository includes a mandatory [Custom Addendum](/docs/legal/LICENSE-ADDENDUM.md) that applies additional restrictions regarding commercial use, AI training, scraping, and SaaS derivatives. By using, cloning, or interacting with this repository, you agree to the full terms of both the AGPL-3.0 and the Addendum.

---

## 🚀 THE HYBRID EDGE REVOLUTION

`hex-yt-intel` has transcended standard serverless limitations. Version 1.4.1 implements the **Hybrid Edge Symphony**:

1.  **Vercel Bouncer**: High-security authentication and atomic quota enforcement (~8s).
2.  **Cloudflare Streaming**: Direct browser-to-edge SSE connection for high-latency LLM synthesis (~58s).
3.  **HMAC Persistence**: Cryptographically signed server-to-server database writes for guaranteed data integrity.

**Result**: Deep UCIS v5.1 analysis with zero timeouts, zero exposed database keys, and 100% reliability.

---

## 🏗️ PROJECT STRUCTURE

-   `/web`: Next.js 16.2.6 (React 19) Dashboard & Bouncer.
-   `/worker`: Cloudflare Worker (Hono) High-Performance Streaming Engine.
-   `/docs`: Specifications (PRD, ADRs), Historical Logs, and Operational Guides.
-   `/supabase`: Database Migrations & Edge Functions.

---

## 🛠️ QUICK START

### 1. Preflight
```bash
cd web
pnpm type-check && pnpm lint && pnpm build
```

### 2. Deployment
-   **Web**: Auto-deployed to Vercel on `main` push.
-   **Worker**: `cd worker && pnpm deploy`.

---

## 📖 DOCUMENTATION TAXONOMY

| Directory | Content |
|---|---|
| `/docs/specs/` | Technical Specs & ADRs (ADR 005 is current master). |
| `/docs/history/` | 10x THOS, Version Ledgers, and Handover Reports. |
| `/docs/ops/` | Deployment Checklists & Known Good State. |
| `CLAUDE.md` | Infrastructure Coordinates & Core Laws. |
| `GEMINI.md` | Multi-Agent Coordination Directives. |
| `AGENTS.md` | Agent Identites & Vertical Execution Flows. |

---

© 2026 Kelly Bakri. All Rights Reserved.
