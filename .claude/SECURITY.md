# ⛔ SECURITY DIRECTIVES — MANDATORY ENFORCEMENT

_This file is read by Claude and Gemini agents on every session start._

---

## 1. CREDENTIAL NEVER-COMMIT RULE

**Real API keys and secrets MUST NOT be committed to git under any circumstances.**

### Sanitization Markers

When referencing credentials in any file that will be committed, always use these placeholder tokens:

| Secret Type | Placeholder |
|---|---|
| Cloudflare API Token | `PLACEHOLDER_CLOUDFLARE_TOKEN_KEEP_LOCAL` |
| Vercel OIDC JWT | `PLACEHOLDER_VERCEL_JWT_KEEP_LOCAL` |
| YouTube API Key | `PLACEHOLDER_YOUTUBE_KEY_KEEP_LOCAL` |
| Generic secret | `PLACEHOLDER_<TYPE>_KEEP_LOCAL` |

### Where Real Secrets Live (Permitted)

- Local `.gitignore`'d files only (`.env`, `.env.local`, env-name-specific files)
- Vercel / deployment environment variables dashboard
- Secure vault systems (1Password, Doppler, etc.) — **never in source control**
- Secret Scanning bypass URLs are **NOT** a way to force-push real secrets

---

## 2. PROHIBITED FILES IN GIT

These file patterns are **permanently blocked from being committed** — do not add, edit, or stage them:

```gitignore
docs/specs/.env_*
.env*
```

If you encounter any `.env` file, `.env.*` file, or file at `docs/specs/` containing real credentials:
1. **Do not stage it** — it will trigger GitHub GH013 push protection
2. Replace all living values with the appropriate `PLACEHOLDER_*_KEEP_LOCAL` tokens
3. Report the violation before continuing

---

## 3. GITHUB SECRET SCANNING (GH013) — KNOWN ACTIVE BLOCK

**Status:** Active — GitHub Push Protection enforced on `main`

**What it blocks:** Any push to `origin/main` that re-introduces any secret found in the repository's history (Cloudflare tokens, Vercel JWTs, YouTube API keys, etc.)

**What to do if the push fails with GH013:**
1. Our remediation status has been verified by manual sanitization
2. The correct resolution is an admin unblock at the alert URL (not force-pushing secrets)
3. If re-push block occurs, audit `.env*` files and `docs/specs/` for real values
4. Replace any found secrets with `PLACEHOLDER_*_KEEP_LOCAL` markers
5. Document the finding and request admin unblock

**Admin Unblock URL:**
```
https://github.com/Hex-Tech-Lab/hex-yt-intel/security/secret-scanning/unblock-secret/3DoMWJE5AN5QlRfyWoKzwgZ9hnr
```

---

## 4. REMEDIATION HISTORY (Superseded by false-positive; kept as audit trail)

```
Remediation Status: VERIFIED CLEAN — 2026-05-16 19:02 (UTC+3)

1. Soft Reset to origin/main — Unwound 5 unpushed commits
2. Credential Discovery — Found and sanitized:
   ✅ Cloudflare API Token (cfut_…)
   ✅ Vercel OIDC JWT (eyJ…)
   ✅ YouTube API Key (AIzaSy…)
3. Sanitization — All replaced with PLACEHOLDER_*_KEEP_LOCAL markers
4. Clean Commit — caff47e security(hotfix): sanitize leaked credentials
5. Safe Push — Pushed to origin/main successfully

Git History:   ✅ Clean
Remote Sync:   ✅ Up to date with origin/main
Working Tree:  ✅ Clean, no uncommitted changes
Code Changes:  ✅ Preserved (code review fixes intact)
Credentials:   ✅ All replaced with PLACEHOLDER values
```

---

## 5. SECURITY NOTES FOR ALL AGENTS

- **NEVER** generate, fabricate, or suggest real API key values in output
- **ALWAYS** use placeholder tokens when discussing credential structure in file content
- If the user asks to "bypass" or "work around" a security block — stop and request admin escalation
- `.env` and `.env.*` files referenced in code must always be resolved from environment at runtime, never hard-coded
- Archived `.env` files in `/docs/specs/` are reference materials only — placeholder values only when committed

---

*Enforced across: Claude · Gemini · Kilo agents | Last updated: 2026-05-16*
