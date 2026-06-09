# Conductor Plan: hex-yt-intel (v1.4.1)

This document tracks the engineering milestones ("tracks"), task state, and automated verification rules for the **hex-yt-intel** platform.

---

## Track 1: Workspace & Taxonomy Stabilization
* **Goal**: Establish a clean workspace, enforce root volume limits, and secure private skills.
* **Status**: ✅ COMPLETE

### Tasks
- [x] **Node.js & Package Manager Verification**: Confirm Node.js version is >= 24 and package manager is `pnpm`.
- [x] **Root Markdown Cleanup**: Relocate all non-compliant markdown files (`DESIGN.md`, `ROADMAP.md`, `BLACKBOX.md`, etc.) to their designated `/docs/` subdirectories to meet the root limit of 4 files.
- [x] **Private Skill Protection**: Untrack and exclude `.gemini/skills/` and `docs/skills/` from Git tracking via `.gitignore`.
- [x] **Build Validation**: Verify that the Next.js frontend and Cloudflare Worker build successfully (`pnpm build`).

### Verification
- `find . -maxdepth 1 -name "*.md" | wc -l` (Must return exactly 4)
- `git status` (Verify no untracked `.gemini/skills/` or `docs/skills/` directories are present)
- `pnpm build` (Must succeed with zero compile-time errors)

---

## Track 2: Hybrid Edge Symphony (ADR 005) Verification
* **Goal**: Validate the security, signature verification, and streaming response contracts of the Hybrid Edge Symphony.
* **Status**: ⏳ PENDING

### Tasks
- [ ] **StreamToken HMAC Verification**: Validate Vercel's creation of the `StreamToken` and the Cloudflare Worker's validation of the HMAC signature.
- [ ] **Model Cascade Fallback Testing**: Verify that the worker falls back correctly down the model cascade if upstream API failures or timeouts occur.
- [ ] **S2S /persist Endpoint Signature Security**: Verify that `/api/analyses/persist` rejects updates that do not possess a valid `ContentSignature` signature.
- [ ] **SSE Chunk Streaming E2E Verification**: Verify chunked response streaming functionality end-to-end.

### Verification
- `pnpm run test` (Execute test suite checks for signatures and token verification)
- `pnpm run dev` (Verify local integration streaming endpoints)

---

## Track 3: MVP 2.0 Launch Readiness
* **Goal**: Verify that all core features are ready for the MVP 2.0 milestone.
* **Status**: ⏳ PENDING

### Tasks
- [ ] **Structured JSON Streaming**: Verify the direct JSON streaming output from the model cascade (replacing regex parser dependencies).
- [ ] **PDF Export Security & Bounds**: Ensure proper generation and constraints on exportable PDF analyses.
- [ ] **Landing, Pricing, & Dashboard Layouts**: Perform a design alignment review of frontend UI elements.
