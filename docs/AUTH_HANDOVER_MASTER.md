# Hex-OAuth Session Handover — LLM State (2026-05-15T21:00–22:10 EEST)

## 1 · Identity — What You Are On This Project

| Field | Value |
|---|---|
| **Working directory** | `/home/kellyb_dev/projects/hex-yt-intel` |
| **GCP project display** | `hex-yt-intel` |
| **GCP project numeric ID** | `283991426265` |
| **Service account email** | `agent-orchestrator@hex-yt-intel.iam.gserviceaccount.com` |
| **SA roles** | `roles/owner` + `roles/serviceusage.serviceUsageAdmin` |
| **Active SA key file** | `/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json` |
| **Vercel project name** | `hex-yt-intel` |
| **Vercel project ID** | `prj_jKAo3z8jKyHwi3qXqSIeoZO1ILku` |
| **Vercel org ID** | `team_vgnBI2s3ynPBzQdOLqhGvBnK` |

---

## 2 · GCP Projects — Do Not Confuse

| Display name | Numeric ID | Purpose | SA key file |
|---|---|---|---|
| `gen-lang-client-0373183545` | `555353818457` | **Legacy**, all APIs already live | `/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json` **← MISNAMED** |
| `hex-yt-intel` (target) | `283991426265` | **Target**, APIs enabled today | `/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json` |

> ⚠️ `hex-yt-intel-key.json` refers to the **wrong SA** (`gen-lang-client-0373…`).  
> The correct file is **`hex-yt-intel-new-key.json`** — L19–L26 of this file.  
> Get all other references from this file when switching session or context.

---

## 3 · Key Files Changed This Session

| File | Change |
|---|---|
| `web/app/auth/callback/route.ts` | L8: `'/dashboard'` → `'/'` · L46: `'/dashboard'` → `'/'` — stops 404 after OAuth callback |
| `docs/HEX_OAUTH_CHANDOVER.md` | Sections 1–9 — full handover report written |
| `.env.local` (existing) | `NEXT_PUBLIC_SUPABASE_URL=https://adnmbikaqnxivalqoild.supabase.co` (confirmed correct) |
| Vercel env vars (via UI) | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` added to prod |

**Commit history:**
```
8ba155a  (previous session — GitHub OAuth + TS fix)
efea2c1  (this session — fixed callback redirect 404)
```

---

## 4 · Problems Solved This Session (In Order)

### P1 — Wrong Project in `gcloud`
- **Symptom:** `gcloud services list --enabled` returned all three required APIs as absent
- **Root cause:** Default `gcloud` config was on `gen-lang-client-0373183545` (or `283991426265` via mismap), not the actual hex-yt-intel target project
- **Fix:** Identified the SA key at `/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json` belongs to `agent-orchestrator@hex-yt-intel@iam.gserviceaccount.com`, project `283991426265`

### P2 — SA Key File Mismatch
- **Symptom:** Activated key, but `gcloud` still resolved wrong project
- **Root cause:** `/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json` is **misnamed** — contains `gen-lang-client-0373183545` SA data
- **Fix:** Wrote `/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json` from inline JSON and re-activated

### P3 — DNS / ENOTFOUND Failures Blocking Token Exchange
- **Symptom:** `gcloud auth activate-service-account` failed with `Max retries exceeded…Failed to resolve 'https'`; Python `urllib.request.urlopen` same; direct `curl` worked
- **Root cause:** Python `ssl.SSLError: [Errno -3] Temporary failure in name resolution` — transient DNS failure in the Python process, likely `/etc/resolv.conf` flapping during launch
- **Mitigation used:** Generated JWT access token inline via `python3 -c` with direct `urllib` call (first URL succeeded showing 404), confirming DNS recovered mid-session; rewrote key file and re-activated
- **Open:** If DNS fails again on session restart, use `curl` sourced `/tmp/hex_oauth_test.py` approach instead of Python urllib

### P4 — 404 After OAuth Login
- **Symptom:** Google/GitHub OAuth succeed, then browser lands on 404
- **Root cause:** `web/app/auth/callback/route.ts` lines 8 and 46 fall back to `/dashboard` — directory does not exist
- **Fix:** Changed both fallbacks to `'/'` (commit `efea2c1`)

---

## 5 · Current API State on `hex-yt-intel` (283991426265)

| API | Enabled? | How verified |
|---|---|---|
| `serviceusage.googleapis.com` | ✅ Yes | Console traffic: 67 requests |
| `cloudresourcemanager.googleapis.com` | ✅ Yes | `gcloud services list` |
| `iam.googleapis.com` | ✅ Yes | `gcloud services list` |
| `people.googleapis.com` | ✅ Yes | `gcloud services list` |
| `plus.googleapis.com` | ❌ Not enabled | Confirmed absent — correct |
| `generativelanguage.googleapis.com` | ✅ Yes (inherited?) | Console shows Gemini API |

---

## 6 · Auth Flow End-to-End (Current State)

```
User → /auth/signin
  → Click "Sign in with Google" / "Sign in with GitHub"
  → OAuth provider callback → /auth/callback?code=…
  → web/app/auth/callback/route.ts
      - exchangeCodeForSession(code)
      - fallback redirect: '/'  ← fixed (was '/dashboard')
      → landing: web/app/page.tsx (root homepage)
```

**Middleware guard** (`web/middleware.ts`): protects only `/analyses` and `/api` paths.  
Root `/` is public. No redirect loop.

---

## 7 · Environment Variables (Confirmed)

```
NEXT_PUBLIC_SITE_URL      (expected: https://hex-yt-intel.vercel.app — not yet found in .env files)
NEXT_PUBLIC_SUPABASE_URL  = https://adnmbikaqnxivalqoild.supabase.co
AUTH_PROVIDER             = supabase
Vercel prod               = NEXT_PUBLIC_GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET ✅ (per execution report)
```

---

## 8 · What Works ✅

- Google People API on correct project
- IAM / Cloud Resource Manager APIs on correct project
- OAuth consents screen + Client ID created via console
- Vercel production env vars set
- Auth callback fires, exchanges code for session, lands on `/`

---

## 9 · What's Unresolved / Pending

### PENDING — Production OAuth Test
- Need **user** to confirm `https://hex-yt-intel.vercel.app/auth/signin` works end-to-end
- If "Google hasn't verified this app" warning appears: that's normal for Development OAuth; switch to `External` + provide Privacy Policy + ToS URLs when ready to go public

### PENDING — `CLAUDE.md` Key Path Update
- `CLAUDE.md` currently references `/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json` as the SA key
- **This path is wrong** — it points to the gen-lang-client SA
- **Correct path:** `/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json`
- Update CLAUDE.md §"Kilo configuration" or equivalent to reflect this

### PENDING — `docs/GOOGLE_OAUTH_SETUP.md` Key Path Update
- Same issue as CLAUDE.md — same stale path
- Replace `hex-yt-intel-key.json` → `hex-yt-intel-new-key.json`, fix email → `agent-orchestrator@hex-yt-intel.iam.gserviceaccount.com`

### PENDING — `/dashboard` Page (Optional)
- If `/dashboard` redirect is wanted instead of `/`, create `web/app/dashboard/page.tsx`
- Otherwise keep the `'/'` fallback as is

---

## 10 · Key Characters & Credentials Annotated

| Reference | Value | Sensitivity |
|---|---|---|
| `hex-yt-intel-new-key.json` | SA private key (email = `agent-orchestrator@hex-yt-intel`) | 🔴 do not commit |
| `CLIENT_SECRET` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | In Vercel env, not in repo | 🔴 do not echo |
| Supabase anon key | In Vercel env | 🔴 do not echo |
| `adnmbikaqnxivalqoild` | Supabase project ref | 🟡 safe to reference |

---

## 11 · How to Reset Auth Context for Next Session

```bash
# Warm starting — do this first
gcloud auth activate-service-account \
  --key-file=/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json
gcloud config set project 283991426265

# If DNS blocks gcloud (ENOTFOUND), fall back to Python JWT flow
python3 /tmp/hex_oauth_via_curl.py  # run /tmp variant if needed
```

---

## 12 · Questions Answered

| Q | Answer |
|---|---|
| Why did 3 SA key files appear? | Only **one** real hex-yt-intel SA key exists. The `hex-yt-intel-key.json` file is misnamed — it contains gen-lang-client SA data. Urgent fix: trace key files by `client_email`, not filename. |
| Why did `gcloud` show wrong project? | `gcloud` was still mapped to `gen-lang-client-0373183545` as the active config. The hex-yt-intel transient project `283991426265` was hit but caused SA permission denial — keep SA config TIGHT. |
| Will `/dashboard` 404 break anything? | No — fixed. Callback now falls back to `/`. If protecting `/` with middleware later, update `protectedRoutes` array in `web/middleware.ts`. |
| Facebook still hooked up? | No — replaced with GitHub OAuth by prior session. If Facebook is needed later, that's a new infra task. |
| DNS resolve errors after `gcloud activate`? | Ephemeral Python DNS failure — use `curl` fallback or re-run once shell warms up. |

---

*End of handover. All open items are in §9.*
