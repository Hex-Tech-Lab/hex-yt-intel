# OC task: write docs/ops/db-split-plan.md (research only)
Follow these steps exactly, in order. Do not ask questions; if a step fails, write what failed into the document and continue.
1. Work only in ~/projects/hex-yt-intel-wt-i-dbsplit (branch docs/db-split-plan). Start every shell command with: cd ~/projects/hex-yt-intel-wt-i-dbsplit &&
2. Append to the end of .memory/AGENT_LEDGER.md: `- [2026-10-12] [OC] [IN_PROGRESS] docs/ops/db-split-plan.md: research plan for a separate UAT Supabase database (no code, no DB changes).`
3. Read only (do not edit): CLAUDE.md sections 1, 3 (ADR 013 and ADR 018 rows) and 4; worker/wrangler.toml [env.uat] block; run `ls supabase/migrations | wc -l` and `ls supabase/migrations | tail -5`.
4. Create docs/ops/db-split-plan.md with these sections, 3-8 short plain-English bullets each:
   - ## Why: production and UAT share Supabase project adnmbikaqnxivalqoild; risks (UAT writes real rows, migrations hit prod first).
   - ## Options: (a) Supabase branching, (b) second Supabase project for UAT, (c) shared DB with a separate schema. For each: cost, effort, migration flow, auth/OAuth redirect changes.
   - ## What must change per option: Vercel env vars (preview vs production), worker [env.uat] SUPABASE_POOLER_URL and secrets, CI migration job (ADR 013 `supabase db push` target), Google OAuth redirect URIs, seed data.
   - ## Migration discipline: ADR 018 (file version must equal recorded version; diff full version sets).
   - ## Recommendation: one option, step-by-step rollout with a rollback per step.
   - ## Open questions for the owner.
5. Never run anything that changes a database, Vercel, Cloudflare or GitHub settings.
6. Change your ledger line from [IN_PROGRESS] to [DONE].
7. Run: `git checkout -- scripts 2>/dev/null; git add docs/ops/db-split-plan.md .memory/AGENT_LEDGER.md docs/agent-prompts/2026-10-12-oc-db-split-plan.md && git commit -m "docs(ops): plan for a separate UAT database" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -u origin docs/db-split-plan`
8. Open a pull request with the GitHub CLI: base branch `uat`, title `docs(ops): plan for a separate UAT database`, body `Research plan only; no code or DB changes.` followed by a line `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
9. Stop and print the PR URL.
