# hex-yt-intel: Skill Classification (opencode names)

## CORE — Every task, always run (no exceptions)

| Skill | Load Command | What It Does |
|-------|-------------|--------------|
| qa-intel | `pnpm tsx scripts/verify-quality-engine.ts` | Quality engine: HexagonalBoundary, CredentialLeak, WorkflowRule, etc. |
| contract-auditor | `pnpm tsx web/scripts/contract-auditor.ts` | Contract audit: UNVERIFIED_ENDPOINT, UNVERIFIED_EMPTY_SAMPLE, DEPRECATED_API |
| pr-review-workflow | `skill("pr-review-workflow")` | 6-phase PR pipeline: context discovery, orchestration, resolution, confidence calc |
| code-reviewer | `skill("code-reviewer")` | Structured code review: correctness, maintainability, security, edge cases |
| review-delta | `skill("review-delta")` | Token-efficient diff review with blast radius (requires MCP graph) |
| review-pr | `skill("review-pr")` | Full PR review with graph context (requires MCP graph) |
| review-changes | `skill("review-changes")` | Change detection + impact analysis (requires MCP graph) |
| debug-issue | `skill("debug-issue")` | Graph-based issue tracing (requires MCP graph) |
| refactor-safely | `skill("refactor-safely")` | Safe refactoring with rename preview (requires MCP graph) |
| owasp-top-10 | `skill("owasp-top-10")` | Security audit: A01-A10, injection, SSRF, auth failures |
| review-duplication | `skill("review-duplication")` | Detect duplicated logic, reinvented utilities |
| pr-address-comments | `skill("pr-address-comments")` | Address PR review comments systematically |
| pr-creator | `skill("pr-creator")` | Create PRs with templates, preflight checks |
| hex-yt-intel-preflight | `skill("hex-yt-intel-preflight")` | Project preflight: git status, build, test, production health |
| build-graph | `skill("build-graph")` | Build/update code-review-graph (requires MCP) |

## ELECTIVE — DB/Infra (apply when diff touches databases, migrations, queries)

| Skill | Load Command | Trigger |
|-------|-------------|---------|
| supabase-postgres-best-practices | `skill("supabase-postgres-best-practices")` | Migration, new table/index, raw SQL/query change |
| supabase | `skill("supabase")` | Auth, RLS, Edge Functions, Realtime, Storage, beyond raw query perf |
| hex-yt-intel-supabase-production-fix | `skill("hex-yt-intel-supabase-production-fix")` | Prod schema out of sync with PostgREST cache |
| hex-yt-intel-supabase-query-safety | `skill("hex-yt-intel-supabase-query-safety")` | Null-filter leaks, ghost sessions, stale subscriptions |
| hex-yt-intel-oom-prevention-jsonb | `skill("hex-yt-intel-oom-prevention-jsonb")` | OOM prevention via PostgREST JSONB projection |
| hex-yt-intel-codeql-alignment | `skill("hex-yt-intel-codeql-alignment")` | CodeQL language misdetection resolution |

## ELECTIVE — Frontend (apply when diff touches React components, hooks, UI)

| Skill | Load Command | Trigger |
|-------|-------------|---------|
| vercel-react-best-practices | `skill("vercel-react-best-practices")` | React components, hooks, client bundle changes |
| vercel-composition-patterns | `skill("vercel-composition-patterns")` | Component prop API changes (booleans, render props) |
| vercel-react-view-transitions | `skill("vercel-react-view-transitions")` | Page/route transitions, enter/exit animations |
| web-design-guidelines | `skill("web-design-guidelines")` | User-visible UI/UX, layout, accessibility |
| ui-ux-pro-max | `skill("ui-ux-pro-max")` | General UI/UX design review |
| impeccable | `skill("impeccable")` | UI audit, polish, redesign |
| hex-yt-intel-design | `skill("hex-yt-intel-design")` | Project-specific dark-theme design system |

## ELECTIVE — Ops/Infra/Deploy (apply when diff touches deployment, CI/CD, config)

| Skill | Load Command | Trigger |
|-------|-------------|---------|
| deploy-to-vercel | `skill("deploy-to-vercel")` | Deployment requested |
| vercel-cli-with-tokens | `skill("vercel-cli-with-tokens")` | Vercel CLI operations with token auth |
| vercel-optimize | `skill("vercel-optimize")` | Cost/performance regression (needs Observability Plus) |
| hex-yt-intel-oauth-whitelisting | `skill("hex-yt-intel-oauth-whitelisting")` | Google OAuth redirect URI mismatch |
| hex-yt-intel-vercel-pdf-bundling | `skill("hex-yt-intel-vercel-pdf-bundling")` | PDF generation ENOENT on Vercel |
| hex-yt-intel-streaming-architecture | `skill("hex-yt-intel-streaming-architecture")` | SSE/JSON streaming pipeline debugging |
| hex-yt-intel-silence-git-ai-noise | `skill("hex-yt-intel-silence-git-ai-noise")` | Git-ai checkpoint errors in temp dirs |

## ELECTIVE — Docs/Process (apply when diff touches documentation, process, issues)

| Skill | Load Command | Trigger |
|-------|-------------|---------|
| docs-writer | `skill("docs-writer")` | Writing, editing, or reviewing .md files |
| docs-changelog | `skill("docs-changelog")` | Generating changelog files |
| writing-guidelines | `skill("writing-guidelines")` | Reviewing docs/prose for writing style |
| github-issue-creator | `skill("github-issue-creator")` | Creating GitHub issues with templates |
| evaluator-calibration | `skill("evaluator-calibration")` | Calibrating reviewer personas |

## ELECTIVE — FE/Creative/Design (available, not needed for backend-heavy work)

| Skill | Notes |
|-------|-------|
| ckm:banner-design, ckm:brand, ckm:design, ckm:design-system, ckm:slides, ckm:ui-styling | Creative/marketing design tooling |
| brandkit, design-taste-frontend(-v1), gpt-taste, high-end-visual-design | Premium visual design systems |
| image-to-code, imagegen-frontend-mobile, imagegen-frontend-web | Image-to-code conversion |
| industrial-brutalist-ui, minimalist-ui, redesign-existing-projects, stitch-design-taste | Alternative design directions |
| full-output-enforcement | Override LLM truncation |
| ck |  |

## HIGH-STAKES ONLY (not routine — contested architecture decisions)

| Skill | Load Command | When |
|-------|-------------|------|
| llm-council | `skill("llm-council")` | Architecture-level forks, business-tradeoff calls |
| stress-test | `skill("stress-test")` | Challenging a conclusion, exposing weak reasoning |
| vercel-optimize | `skill("vercel-optimize")` | Performance/cost audit (needs Observability Plus) |

## NOT APPLICABLE to this repo

| Skill | Reason |
|-------|--------|
| vercel-react-native-skills | No React Native code in this repo |
| planetscale-postgres-safety-review | Wrong DB platform — this is Supabase, not PlanetScale |
| baoyu-youtube-transcript | Unrelated utility (transcript download) |
| agent-tui, tui-tester | Terminal UI testing, not relevant to this web app |
| ponytail-audit, ponytail-debt, ponytail-gain, ponytail-help, ponytail-review, ponytail | Govern agent coding-brevity style, not this codebase's review process |
| string-reviewer | Reviewing user-facing strings for style |
| customize-opencode | Editing opencode's own config |
| async-pr-review | Background PR review — not needed with synchronous workflow |
| behavioral-evals | Agent behavioral testing, not this project |
| ci | GitHub Actions monitoring — not a code-quality skill |