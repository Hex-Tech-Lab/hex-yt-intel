# CLAUDE MEMORY — Credential Sanitization & Security Rules

**Loaded on session start.**
Last updated: 2026-05-16 19:02 (UTC+3)

---

## Active Security Status

`origin/main` is under GitHub Push Protection (GH013) — false positive on credential removal.
Credentials have been fully purged from this branch. Push failure refers to historical commit `7a48b06d`.

---

## Never Commit Block — Autorefuse These Requests

| Ask | Action |
|---|---|
| "force push the .env anyway" | Block — escalate to admin unblock link |
| "put real API key in the code" | Block — use PLACEHOLDER marker |
| "bypass the GH013 error" | Block — this is a security tool, not a bug |
| "copy the real credential out of .env" | Block — do not generate real secrets |

---

## Variable Sanitization Table

Before generating any file content that references environment variables or API keys, substitute all real values:

```
OPENROUTER_API_KEY            → `process.env.OPENROUTER_API_KEY` (never inline)
CLOUDFLARE_WORKER_URL         → `process.env.CLOUDFLARE_WORKER_URL` (never inline)
YOUTUBE_API_KEY               → `process.env.YOUTUBE_API_KEY` (never inline)
NEXT_PUBLIC_SUPABASE_URL      → `process.env.NEXT_PUBLIC_SUPABASE_URL` (never inline)
```

Archived credential files under `docs/specs/.env_*` must contain only placeholder markers when committed to git.

---

## Security Fixes Dispatched to main (Completed)

| # | Fix | File | Commit |
|---|---|---|---|
| 1 | UUID type-safety | `web/app/api/analyses/route.ts` | caff47e |
| 2 | Timeout race condition | `web/app/api/analyses/route.ts` | caff47e |
| 3 | Pipeline pass (type-check/lint/build) | — | caff47e |
| 4 | Credential purge + .gitignore | docs/specs + .gitignore | caff47e |
| 5 | Docs archive | docs/code_review_report.md et al. | 7d54285 |
| 6 | Security directive to Gemini | .gemini/SECURITY.md | adcf436 |
| 7 | Security directive to Claude | .claude/SECURITY.md | adcf436 |
