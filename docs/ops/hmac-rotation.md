# STREAM_HMAC_SECRET Rotation (Manual)

`STREAM_HMAC_SECRET` signs stream tokens. The web app (Vercel) and the Cloudflare Worker must hold the same value, or streaming analysis breaks.

The former `deploy-hmac-secret` GitHub workflow was removed. It never set the Worker secret, could not select an environment, and had silently no-op'd before. Rotation is manual.

Never commit the value, paste it into chat, or put it in a script. Generate it with `openssl rand -hex 32` and keep it in a password manager.

## Environments

| Env | Vercel targets | Worker `--env` | Worker name |
|-----|----------------|----------------|-------------|
| production | `production`, `preview` | `production` | `yt-intel` |
| uat | `preview` | `uat` | `youtube-intelligence-worker-uat` |

## Steps (per environment)

1. Generate the new secret and hold it in a shell variable only:
   `NEW_SECRET=$(openssl rand -hex 32)`
2. Set the Cloudflare Worker secret. Run this yourself:
   `pnpm --filter youtube-intelligence-worker exec wrangler secret put STREAM_HMAC_SECRET --env <production|uat>`
   Paste the value at the prompt.
3. Set the Vercel env var for each target in the table above. Use the dashboard (Project > Settings > Environment Variables) or the CLI:
   `printf '%s' "$NEW_SECRET" | vercel env add STREAM_HMAC_SECRET <production|preview>`
   If the variable already exists for that target, remove the old record first with `vercel env rm STREAM_HMAC_SECRET <target>`. Vercel keeps one record per target.
4. Redeploy the Vercel project so the new value is read. Redeploy the Worker only if its code changed: `wrangler deploy --env <env>`.
5. Verify. Run one streaming analysis in the affected environment and confirm it completes without token errors.
6. Unset the local variable: `unset NEW_SECRET`.

Do step 2 and step 3 close together. Between them, streams fail with a signature mismatch.

## Rollback

Rotate back to the previous value using the same steps. If the previous value is lost, generate a new one and repeat for both systems. Do not leave the two sides mismatched.

## Known history

The previous value was committed in plaintext to `scripts/deploy-hmac-secret.sh`, and the repo is public. Treat that value as compromised. Rotate it, and do not reuse it. Scrubbing git history is a separate follow-up.

See also: `docs/incidents/SECRET_DEPLOYMENT_INSTRUCTIONS.md`, `docs/UAT_ENV_MAP.md`.
