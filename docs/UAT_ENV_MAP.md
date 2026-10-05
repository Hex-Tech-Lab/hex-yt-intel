# UAT Environment Configuration & Mapping Specification

**Target Environment:** `uat.getvintel.com`  
**Worker Target:** `youtube-intelligence-worker-uat.workers.dev` (or mapped custom domain)  
**Supabase Ref:** `adnmbikaqnxivalqoild` (Region: `eu-west-3`)  
**Specification Date:** 2026-10-05  

---

## 1. Vercel UAT Environment Variables (`@hex-yt-intel/web`)

The following environment variables must be configured in the Vercel project targeting the UAT deployment branch/domain (`uat.getvintel.com`):

| Variable Key | Type / Value Example | Scope | Rationale |
| :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_APP_URL` | `https://uat.getvintel.com` | Plain / Production/UAT | Public canonical origin for redirects and HMAC verification. |
| `NEXT_PUBLIC_WORKER_URL` | `https://youtube-intelligence-worker-uat.hex-tech-lab.workers.dev` | Plain | Directs analytical streaming & sensor requests to the Cloudflare UAT Worker. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://adnmbikaqnxivalqoild.supabase.co` | Plain | Supabase project API gateway. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<SUPABASE_ANON_KEY>` | Secret | Public client auth and read queries. |
| `SUPABASE_SERVICE_ROLE_KEY` | `<SUPABASE_SERVICE_ROLE_KEY>` | Secret | Server-side trusted mutations, quota reservations, and ghost row persistence. |
| `POSTGRES_URL` / `DATABASE_URL` | `postgresql://postgres.adnmbikaqnxivalqoild@aws-0-eu-west-3.pooler.supabase.com:5432/postgres` | Secret | Direct transaction pooler connection for serverless endpoints. |
| `STREAM_HMAC_SECRET` | `<SHARED_HMAC_SECRET>` | Secret | Synchronized secret token for S2S `/persist` and streaming handshake. |
| `OPENROUTER_API_KEY` | `<OPENROUTER_KEY>` | Secret | Upstream LLM cascade routing key. |

---

## 2. Dynamic Settings Registry Configuration (`setting_definitions` / `app_settings`)

For Phase C Epistemic Architecture, the following keys must be set in the Supabase Settings Registry:

### `cascade.diarization`
- **Tier:** `system`
- **Type:** `array` (validated via `cascadeRegistry` marker per ADR 040)
- **Default/Active Value:**
```json
[
  "assemblyai",
  "deepgram"
]
```
*(Or structured items with timeout overrides)*:
```json
[
  { "provider": "assemblyai", "timeoutMs": 10000 },
  { "provider": "deepgram", "timeoutMs": 8000 }
]
```

### `sensor.totalCascadeTimeoutMs`
- **Tier:** `system`
- **Type:** `number`
- **Value:** `18000` (18 seconds bounded timeout budget)

---

## 3. Cloudflare Worker UAT Configuration (`youtube-intelligence-worker-uat`)

In `worker/wrangler.toml`, the `[env.uat]` target maps:
- `name = "youtube-intelligence-worker-uat"`
- `APP_URL = "https://uat.getvintel.com"`
- `SUPABASE_POOLER_URL = "postgresql://postgres.adnmbikaqnxivalqoild@aws-0-eu-west-3.pooler.supabase.com:5432/postgres"`

### Required Worker Secrets
Deploy via `wrangler secret put <KEY> --env uat`:
1. `wrangler secret put DEEPGRAM_API_KEY --env uat`
2. `wrangler secret put ASSEMBLYAI_API_KEY --env uat`
3. `wrangler secret put MULTIMODAL_VISION_API_KEY --env uat` (OpenRouter or vision provider key)
4. `wrangler secret put OPENROUTER_API_KEY --env uat`
5. `wrangler secret put STREAM_HMAC_SECRET --env uat`
6. `wrangler secret put YOUTUBE_API_KEY --env uat`
7. `wrangler secret put CLOUDFLARE_SECRET_TOKEN --env uat`
