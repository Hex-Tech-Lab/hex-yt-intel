# Hex-OAuth Handover — LLM Annotated State

## Who this is for
Claude Code (CC) picking up where Claude left off on **2026-05-15T21:11 EEST**.

---

## 1 · Project Map

| Display name                | Numeric ID      | What it holds                                                 |
|-----------------------------|-----------------|---------------------------------------------------------------|
| `gen-lang-client-0373…`     | `555353818457`  | Legacy GENERLANG project. APIs already live. SA = `agent-orchestrator@gen-lang-client-0373183545.iam.gserviceaccount.com`. Key file = `/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json` **← MISNAMED, actually belongs here.** |
| `hex-yt-intel`              | `283991426265`  | **Target** project. New SA just created = `agent-orchestrator@hex-yt-intel.iam.gserviceaccount.com`. Key written to `/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json`. Zero APIs live yet. New SA has Owner + Service Usage Admin roles (per user: "service account created with owner and service usage admin roles"). Console screenshot showed 22 APIs listed but all with zero traffic — Utilities only, no People/CloudResourceManager/IAM. |

Vercel project name = `hex-yt-intel` (same display name as GCP project, different project IDs).

---

## 2 · Credential Files on Disk

```
/home/kellyb_dev/.config/gcloud/hex-yt-intel-key.json       ← WRONG SA (gen-lang-client-0373…)
/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json    ← CORRECT SA (agent-orchestrator@hex-yt-intel)
           ^-- named as the user named the file when creating it
               user said: "hex-yt-intel-408a3bdb7ede.json" is the full filename
```

Both files also exist in gcloud legacy config under their respective emails.

Grabbed at the terminal by directly invoking curl against the oauth2 token endpoint. The `requests` library could not reach the internet at session start — the same path; likely a nameserver in `/etc/resolv.conf` flaking — but subsequent output above shows early requests succeeded after the session warmed up.

The `requests` library successfully hit `oauth2.googleapis.com` within the first execution attempt: partial output showed 404 from the URL provided. 

**Important:** These network blocks were specific to this shell launch; gcloud and curl later resolved fine.
```

---

## 5 · What Needs Proceeding Still — Step-Next Summary

**When you start, do exactly in order:**

```bash
# A — Set identity (new SA key)
gcloud auth activate-service-account \
  --key-file=/home/kellyb_dev/.config/gcloud/hex-yt-intel-new-key.json
gcloud config set project 283991426265

# B — Verify You Can See the Project
gcloud projects describe 283991426265   # should succeed, not 403

# C — Verify Missing APIs
gcloud services list --enabled \
  --filter="name:(people.googleapis.com OR iam.googleapis.com OR cloudresourcemanager.googleapis.com)" \
  --project=283991426265
# Expected: all ZERO rows initially

# D — Enable Them
gcloud services enable people.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com \
  --project=283991426265

# E — Wait 60s, then re-verify (all three must appear)
sleep 60
gcloud services list --enabled \
  --filter="name:(people.googleapis.com OR iam.googleapis.com OR cloudresourcemanager.googleapis.com)" \
  --project=283991426265 \
  --format="table(name)"

# F — Fail-fast Google+ check (must NOT appear)
gcloud services list --enabled \
  --filter="name:plus.googleapis.com" \
  --project=283991426265 \
  --format="table(name)"
```

Once B–F pass, hand the user exactly these three console URLs filled in:

---

## 6 · Phase 2 Manual Values — Pre-Filled for User

**Consent Screen** — `https://console.cloud.google.com/apis/credentials/consent?project=283991426265`

| Field | Value |
|---|---|
| User Type | `Internal` (skips Privacy Policy/TOS gate) |
| App name | `hex-yt-intel` |
| User support email | `kellybakri@gmail.com` |
| Dev contact | `kellybakri@gmail.com` |
| Scopes to add | `userinfo.profile`, `userinfo.email`, `openid` |

**OAuth Client ID** — `https://console.cloud.google.com/apis/credentials?project=283991426265`

> ⚠️ If "Internal" blocks the OAuth Client button, Google forces a privacy policy URL. Switch User Type to `External` and provide placeholder URLs, or use the Google Cloud gcloud alpha to create without consent screen review

| Field | Value |
|---|---|
| Type | Web application |
| Name | `hex-yt-intel-oauth` |
| Authorized JS origins | `http://localhost:3000` · `https://hex-yt-intel.vercel.app` · `https://adnmbikaqnxivalqoild.supabase.co` |
| Authorized redirect URIs | `http://localhost:3000/auth/callback` · `https://hex-yt-intel.vercel.app/auth/callback` · `https://adnmbikaqnxivalqoild.supabase.co/auth/v1/callback` |

Save Client ID + Client Secret immediately — shown once.

---

## 7 · Post-Credential Steps (unchanged from checklist)

| Step | Action |
|---|---|
| Supabase → Google provider | Paste Client ID + Secret at `https://app.supabase.com/project/adnmbikaqnxivalqoild/auth/providers` |
| Supabase → Site URL | Confirm = `https://hex-yt-intel.vercel.app` at `.../settings/auth` |
| Vercel env vars | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` → all environments |
| Verify live | `https://hex-yt-intel.vercel.app/auth/signin` → Google sign-in test |

---

## 8 · Do Not Touch

- `gen-lang-client` SA / key files — leave as-is
- `CLAUDE.md` mentions `hex-yt-intel-key.json` as the key path — **this is factually wrong** and must be updated after Phase 2 succeeds so the next agent picks `hex-yt-intel-new-key.json` for project `283991426265`
- `docs/GOOGLE_OAUTH_SETUP.md` same issue re: `hex-yt-intel-key.json` path

---

*End of handover. Start at Section 5.*
