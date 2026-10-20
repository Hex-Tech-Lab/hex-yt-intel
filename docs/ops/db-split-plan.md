# Plan: separate UAT database

Research only. No code, no database, Vercel, Cloudflare, or GitHub settings were changed.

## Why

- Production and UAT share one Supabase project: `adnmbikaqnxivalqoild`.
- UAT writes real rows into the production database, so test data can mix with real user data.
- Migrations are applied to the shared project, so a migration reaches production before it has been proven on UAT.
- `worker/wrangler.toml` `[env.uat]` points `SUPABASE_POOLER_URL` at the same project host (`aws-0-eu-west-3.pooler.supabase.com`, user `postgres.adnmbikaqnxivalqoild`).
- The CI job in `.github/workflows/ci-cd.yml` (around lines 403-412) runs `supabase db push --dry-run` and then `supabase db push` against the linked project, with no UAT or production split.

## Options

**(a) Supabase branching.**
- Cost: billed per branch on top of the main project; check current pricing before committing.
- Effort: low to medium. Branches are created from the main project's migrations.
- Migration flow: migrations apply to a preview branch first, then to production on merge.
- Auth/OAuth: each branch gets its own URL, so Google OAuth redirect URIs need a wildcard or per-branch entries.
- Caveat: branch data is not a copy of production, so it needs its own seed strategy.

**(b) Second Supabase project for UAT.**
- Cost: one additional project (paid tier if the free quota is exceeded).
- Effort: medium. New project, new keys, new pooler URL, and a separate migration target.
- Migration flow: CI pushes to UAT first, then to production behind a manual gate.
- Auth/OAuth: UAT needs its own Google OAuth client or added redirect URIs for `uat.getvintel.com`.
- Strongest isolation: a UAT write cannot reach production rows.

**(c) Shared database with a separate schema.**
- Cost: none beyond the existing project.
- Effort: medium to high. Every query, RLS policy, RPC, and cron job must be schema-qualified or search_path-aware.
- Migration flow: same migration history, but applied twice (once per schema).
- Auth/OAuth: no change, but `auth.users` is shared, so UAT test users are real production users.
- Weakest isolation. Schema-level separation does not stop a misconfigured UAT worker from writing to production tables.

## What must change per option

- **Vercel env vars:** set `NEXT_PUBLIC_SUPABASE_URL`, anon key, and service key separately for the Preview and Production environments (Preview is what UAT uses). Option (a) also needs branch-aware env handling.
- **Worker `[env.uat]`:** replace `SUPABASE_POOLER_URL` (and the database user) with the UAT target. Re-set any Supabase-related secrets with `wrangler secret put ... --env uat`.
- **CI migration job:** `supabase db push` must target UAT on every PR or uat-branch merge, and target production only on main with the existing dry-run gate. Currently only one target exists, so this is the main code change.
- **Google OAuth redirect URIs:** add the UAT Supabase callback URL to the OAuth client. Option (c) needs no change.
- **Seed data:** UAT needs a seed script that creates test users and sample analyses. The repo has an existing seeding doc (`docs/ops/DATABASE_SEEDING_E2E_2026_05_17_1339.md`) to build on.

## Migration discipline

- ADR 018 (per the owner's brief; the ADR text is in the private companion repo, which is not present in this worktree, so it was not re-read): the migration file version must equal the version recorded in the migration history.
- When comparing environments, diff the full version sets (for example `supabase migration list` against both targets), not just the latest version. This repo has 191 migration files; the latest are `20261012150000_cascade_chat_writing_registry_key.sql` and `20261012170000_chat_stream_timeout_settings.sql`.
- A migration must reach UAT and pass there before it is pushed to production.

## Recommendation

Choose option (b): a second Supabase project for UAT.

It is the only option that fully isolates UAT writes from production data, and its cost is one project. Option (c) keeps shared users and shared tables, which is the risk we are trying to remove. Option (a) depends on branch pricing and on branch-aware OAuth handling, which adds more moving parts.

Rollout, one step at a time, each with a rollback:

1. Create the UAT Supabase project and record its ref in the owner's private notes. *Rollback:* delete the project (no production impact).
2. Apply the full migration history to the UAT project and compare version sets with production. *Rollback:* drop and recreate the UAT project.
3. Add the UAT callback URL to the Google OAuth client and test a UAT sign-in. *Rollback:* remove the redirect URI.
4. Switch the Vercel Preview environment variables to the UAT project and redeploy one preview. *Rollback:* restore the previous Preview variables and redeploy.
5. Switch `[env.uat]` in `worker/wrangler.toml` and its secrets to the UAT project, then deploy the UAT worker. *Rollback:* redeploy the worker with the previous pooler URL.
6. Change the CI migration job so PRs and the uat branch push to UAT, while main pushes to production after the dry-run gate. *Rollback:* revert the workflow file to the single `db push`.
7. Seed UAT with the test data script and confirm the UAT health checks pass. *Rollback:* truncate the UAT tables (production is unaffected).

## Open questions for the owner

- Confirm the Supabase plan and the cost of a second project versus branching.
- Which environment will the uat branch deploy to, and will UAT keep a separate Google OAuth client?
- Does UAT need production-like data, or is synthetic data acceptable? This decides the seed strategy.
- Should production migrations stay manually gated after the split?
- Where is ADR 013 and ADR 018 text kept? The private companion repo (`docs/private/`) is missing from this worktree, so those ADRs could not be checked directly.
