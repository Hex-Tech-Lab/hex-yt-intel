# hex-yt-intel: Master Infrastructure & Architectural Spec (v1.4.1)

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

## 2. THE ADR LEDGER (Architectural Decision Records)

| ADR | Date | Title | Status |
|---|---|---|---|
| 001 | 2026-05-12 | Supabase-only Auth Migration | ✅ |
| 002 | 2026-05-14 | Atomic Quota Enforcement (Upstash Redis Lua) | ✅ |
| 003 | 2026-05-16 | LLM Model Cascade (nemotron-3-nano lead + free fallbacks → Haiku 4.5) | ✅ |
| 004 | 2026-05-21 | Request-Scoped Supabase Client | ✅ |
| 005 | 2026-06-01 | Hybrid Edge Architecture (Vercel/CF) | ✅ |

---

## 3. INFRASTRUCTURE COORDINATES

- **Vercel App**: `https://hex-yt-intel.vercel.app` (prod domain: `https://yt-intel.getmytestdrive.com`)
- **CF Worker**: `https://yt-intel.hex-tech-lab.workers.dev`
- **DB Ref**: `adnmbikaqnxivalqoild` (Supabase — matches `NEXT_PUBLIC_SUPABASE_URL`)
- **Redis**: Upstash (Rate limiting / KV Cache)

---

## 4. THE FROZEN STACK PROTOCOL (GCT Aligned — 2026-05-23)

**Package Management**: `pnpm` only  
**CSS Framework**: Tailwind CSS + shadcn/ui exclusively

### Runtime & Build Infrastructure
- **Node.js**: 24.16.0 LTS
- **pnpm**: 11.1.3
- **Next.js**: 16.2.6
- **TypeScript**: 5.6.2
