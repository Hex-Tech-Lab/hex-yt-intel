# Agent Dispatch Prompt — Text/Copy Rebrand to vIntel

## 0. Ledger protocol — [ALWAYS INCLUDE]

Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full. Read
`.memory/AGENT_LEDGER.md` before touching any file; post `[IN_PROGRESS]` with
intent + target files as your first action; re-check the ledger after every
subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
actually happened as your last action.

## 1. Context

`hex-yt-intel` is being rebranded for MOR (merchant-of-record) payment
provider KYC review. The user is filling out KYC applications and the
reviewers will check the live website against the application — old
branding visible on the live site is a real compliance blocker, not
cosmetic.

**Old branding** (to replace): "Hex-YT Intel" / "Hex YT Intel" / "hex-yt-intel"
/ "yt-intel" / "yt intel" as a PRODUCT NAME (not as a GitHub repo/org name —
see scope exclusions below), and any user-facing mention of the domains
`yt-intel.getmytestdrive.com` / `v-intel.getmytestdrive.com` as the
product's home.

**New branding**: "vIntel" (user's explicit preferred casing) as the product
name, `getvintel.com` / `www.getvintel.com` as the domain. These domains are
ALREADY correctly in the CORS allowlist (`worker/src/middleware/cors.ts`,
`PRODUCTION_ORIGINS`) and are the live production domains as of tonight's
PR #257 — you are not changing infra, only text/copy that still names the
old brand.

This project's CLAUDE.md documents the parallel-cutover history: getvintel.com
is the canonical domain, getmytestdrive.com domains are legacy/parallel until
a hard cutoff. Text/copy should read as if vIntel is the product; do not
remove the getmytestdrive.com domains from technical config (CORS, DNS docs)
-- those still need to keep working during the cutover period, only
user-facing NAMING changes.

## 2. Task

Sweep the repository for the old product-name/domain text and replace with
the new branding, in TEXT/COPY CONTEXTS ONLY. Concretely:

1. **UI-visible strings**: page titles, meta descriptions, `<title>` tags,
   headings, footer text, email templates, toast/notification copy, any
   place a real user reads "Hex-YT Intel" / "Hex YT Intel" / "yt intel" as
   the product name.
2. **Legal documents** — the highest-priority scope, since this is exactly
   what KYC reviewers check: `docs/legal/privacy-policy.md`,
   `docs/legal/terms-of-service.md`, `docs/legal/refund-policy.md`, and
   their live renders `web/app/privacy-policy/page.tsx`,
   `web/app/terms-and-conditions/page.tsx`, `web/app/refund-policy/page.tsx`.
   Read each one in full before editing -- these are legal content, not
   arbitrary strings; a find-replace that breaks grammar or a defined-term
   reference is worse than not touching it. If a sentence structurally
   depends on the old name in a way a simple substitution breaks, flag it in
   your report rather than mangling the sentence.
3. **README.md / docs prose** that describes the product by name for a human
   reader (not machine-readable identifiers).
4. **Metadata/SEO**: `web/app/layout.tsx`'s `metadata` export, any
   `og:title`/`og:description`/Twitter card text, `manifest.json` if one
   exists.

## 3. Explicit scope exclusions — [FILL IN, CRITICAL]

Do NOT touch these even though they contain the old name -- they are
identifiers, not copy, and changing them is a real infra/deploy action
explicitly deferred by the user to a separate later pass:

- `web/package.json` name field, `worker/package.json` name field, any
  `package.json` name field.
- The Cloudflare Worker's configured service name (`worker/wrangler.toml`'s
  `name` field, currently deployed at `yt-intel.hex-tech-lab.workers.dev`).
- The GitHub repository/org name (`Hex-Tech-Lab/hex-yt-intel`) -- do not
  touch `git remote`, CI workflow repo references, or GitHub URLs.
- Environment variable NAMES (e.g. `NEXT_PUBLIC_APP_URL` itself is fine to
  keep as a variable name; only its VALUE if it's a literal old-domain
  string in a comment/doc, not in actual runtime config).
- Database identifiers, table/column names, migration file names.
- `worker/src/middleware/cors.ts`'s `PRODUCTION_ORIGINS` array and any other
  functional CORS/redirect allowlist -- these need the getmytestdrive.com
  domains to KEEP WORKING during the parallel-cutover period. Do not remove
  entries, only touch comments/copy if genuinely miswritten.
- Anything inside `node_modules/`, `.next/`, build output, or `.claude/`.
- Session history docs under `docs/history/` -- these are dated records of
  what happened at the time, rewriting them to a "new" name would falsify
  history. Leave them as-is.

## 4. Goal / definition of done

- Every live, user-facing page (dashboard, pricing, legal pages, auth pages,
  marketing/landing pages if any) shows "vIntel" as the product name, not
  the old name, when actually rendered in a browser.
- All 3 legal documents (source `.md` AND their live page renders) reference
  the new name and domain consistently, and remain grammatically/legally
  coherent (not just string-replaced into nonsense).
- No infra/identifier changes made (verify via `git diff --stat` that
  `package.json`, `wrangler.toml`, CORS config, CI workflows are untouched).
- A real browser check (Playwright) confirms at least: the dashboard page
  title/header, and all 3 legal pages, show the new branding when rendered
  locally.

## 5. Task-specific skills/tools/MCPs

- `web-design-guidelines` if any UI copy changes touch layout, not just text
  content.
- No database/migration tools needed -- this is a pure text/copy task.
- Live-render verification: run `pnpm dev` (check for a port conflict first
  -- `lsof -ti:3000` -- kill stale processes if needed) and use Playwright
  MCP tools to actually load the dashboard and each legal page, confirming
  the new name renders.

## 6. Fixtures

**[ALWAYS INCLUDE]**: Before touching any code, run `code-review-graph`'s
`build_or_update_graph_tool`, then `get_review_context_tool` scoped to
the files this task touches, before reading whole files.

**Branch**: start fresh from `main` (all 3 tonight's PRs are merged as of
now). Create your own branch, e.g. `docs/rebrand-vintel`.

**Starting survey** (already done by the dispatcher, use as your starting
point, re-verify counts yourself before trusting them):
```
grep -rli "hex.yt.intel\|hex yt intel" --include="*.tsx" --include="*.ts" --include="*.md" --include="*.json" web worker docs
grep -rl "getmytestdrive" --include="*.tsx" --include="*.ts" --include="*.md" --include="*.json" --include="*.sql" --include="*.toml" web worker docs supabase
grep -rl "yt-intel" --include="*.tsx" --include="*.ts" --include="*.json" web worker
```
~222 / 22 / 23 hits respectively at time of dispatch -- most are NOT in
scope per section 3's exclusions (identifiers, CORS config, history docs).
Filter carefully; do not blind-sed the whole match set.

## 7. The three tenets — [ALWAYS INCLUDE]

1. **Contract definition + enforcement.** Before editing, state which files
   are in scope (user-facing copy) vs out of scope (identifiers/infra) per
   section 3 -- then check your actual diff against that list before
   reporting done.
2. **E2E cycle complete.** Reading a string change in a file is NOT
   sufficient proof -- render the actual page in a browser (Playwright) and
   confirm the new name is what a real visitor sees.
3. **Tangent hunt.** While sweeping, note any other old-brand references you
   find that don't fit cleanly into "copy" or "infra" (ask in your report
   rather than guessing) -- e.g. email `from` addresses, support contact
   references, anything with legal/compliance weight you're not fully
   confident about changing unilaterally.

**If you find a legal-document sentence that can't be cleanly updated
without a human legal judgment call, STOP editing that specific sentence,
leave it as-is, and flag it explicitly in your report -- do not guess at
legal phrasing.**

## 8. Report format — [ALWAYS INCLUDE]

RCA (what old-brand references existed and where) → Contract (scope
included/excluded) → Fix → E2E proof (Playwright screenshots or explicit
confirmation of what rendered) → Tangents found → Deviations flagged (esp.
any legal-doc sentence left untouched) → Gates (tsc/build clean) → Files
changed → branch name for CC to review.

## 9. Gates — [ALWAYS INCLUDE]

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web run build
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
```

Do NOT open a PR or merge -- push the branch and report back to CC (the
dispatching session) for 10x verification before anything lands.
