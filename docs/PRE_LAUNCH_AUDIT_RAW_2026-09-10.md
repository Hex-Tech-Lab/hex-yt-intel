# Pre-Launch Checklist — Raw Status Audit (2026-09-10)

**Prepared by**: OC (GLM-5.3-flash, low effort), dispatched per `docs/agent-prompts/2026-09-10-oc-prelaunch-checklist-status-audit.md`
**Method**: read-only fact-finding. Every section below = one checklist item: the exact command run and its raw output (trimmed only for length, not paraphrased). No verdicts, no recommendations, no checklist edits. Commands run from repo root, 2026-09-10 ~21:05–21:20 EEST.
**`gh` auth**: confirmed live before use (`gh auth status` → "Logged in to github.com account TechHypeXP").

---

## 1. §1.1/1.2 — PR #239 (taxonomy fix)

```
$ gh pr view 239 --json state,mergedAt,mergeCommit
{"mergeCommit":{"oid":"84ed269daf94267a68fc4a7580ffba21094fbe8b"},"mergedAt":"2026-08-19T15:56:09Z","state":"MERGED"}
```

Supplemental (is the merge commit on main?):

```
$ git branch --contains 84ed269daf94267a68fc4a7580ffba21094fbe8b | grep -w main
  main
```

---

## 2. §2 — Paddle payments

Commits touching the billing files (same command as dispatched, with dates added because the dispatched `--oneline` form carries no dates):

```
$ git log --all --pretty="%h %ad %s" --date=short -- web/lib/paddle.ts web/lib/billing-factory.ts | head -20
6c4dcbec 2026-08-26 fix(tests): update kg node weights in tests to match normalized 0.1-1.0 range
2b5d497d 2026-08-26 feat(billing): complete paddle merchant of record integration (phases 1-3)
85eb4eea 2026-08-26 feat(billing): implement checkout session creation and entitlement evaluation use case
3a0eb8d6 2026-06-24 fix(codacy-sourcery): resolve 5 flagged defects across config files
7cd834be 2026-06-24 fix(codacy-sourcery): resolve 5 flagged defects across config files
f70de5c2 2026-06-24 fix(review): resolve Sentry contexts and secure toast promise handlers
ed2c6f41 2026-06-24 fix(review): resolve Sentry contexts and secure toast promise handlers
654483cb 2026-06-10 feat(ui): Exact replication of Design System (1) pricing and billing interfaces
255c14ca 2026-06-10 feat(ui): Exact replication of Design System (1) pricing and billing interfaces
```

Env var **names** present in `.env.local` (names only — values not read except the non-credential `PADDLE_ENVIRONMENT`):

```
$ grep -oE "^PADDLE_[A-Z_]+" .env.local | sort -u
PADDLE_ACCOUNT_LABEL
PADDLE_API_KEY
PADDLE_API_KEY_LIVE
PADDLE_ENVIRONMENT
PADDLE_PRO_PRICE_ID

$ grep "^PADDLE_ENVIRONMENT" .env.local
PADDLE_ENVIRONMENT=sandbox
```

`web/lib/paddle.ts` lines 10–16 (verbatim):

```
const PADDLE_API_KEY = process.env.PADDLE_API_KEY || '';
const PADDLE_ENVIRONMENT = (process.env.PADDLE_ENVIRONMENT as Environment) || Environment.sandbox;

export const paddle = new Paddle(PADDLE_API_KEY, {
  environment: PADDLE_ENVIRONMENT,
  logLevel: LogLevel.error,
});
```

Live-key wiring check:

```
$ rg -l "PADDLE_API_KEY_LIVE" web/
(no output; exit 1 — zero matches)
```

Observed facts: `paddle.ts` reads only `PADDLE_API_KEY` + `PADDLE_ENVIRONMENT` (sandbox default). `PADDLE_API_KEY_LIVE` exists as an env-var name in `.env.local` but is not referenced anywhere under `web/`. `PADDLE_ENVIRONMENT` is set to `sandbox`. 3 commits since 2026-08-19 touch these files, all on 2026-08-26 (billing integration "phases 1-3" + checkout/entitlements use case + a test fix).

---

## 3. §2c — Simple/Pro mode split

```
$ rg -n --max-columns 160 "useConsoleViewStore|ViewModeToggle" web --glob '*.ts' --glob '*.tsx'
web/components/containers/DashboardContainer.tsx:73:import type { ConsoleViewMode } from "@/lib/stores/useConsoleViewStore";
web/components/templates/console/TopBar.tsx:9:import { ViewModeToggle } from "./ViewModeToggle";
web/components/templates/console/TopBar.tsx:75:        <ViewModeToggle />
web/components/templates/console/__tests__/view-mode-toggle.test.tsx:4:import { ViewModeToggle } from "../ViewModeToggle";
web/components/templates/console/ViewModeToggle.tsx:10:export function ViewModeToggle() {
web/lib/stores/useConsoleViewStore.ts:11:export const useConsoleViewStore = create<ConsoleViewState>()(
web/lib/hooks/useEffectiveViewMode.ts:10:  const { viewMode, setViewMode } = useConsoleViewStore();
(plus 14 more matched lines inside the two test files)
$ rg -l "useConsoleViewStore|ViewModeToggle" web --glob '*.ts' --glob '*.tsx' | wc -l
7
```

Wiring check:

```
$ rg -l "useEffectiveViewMode" web/components web/app
web/components/containers/DashboardContainer.tsx
web/components/templates/console/ViewModeToggle.tsx
web/components/templates/console/__tests__/view-mode-toggle.test.tsx
```

Corresponding ledger entries exist: [AGY-1] 2026-08-26 (PRs #271/#272/#273/#274, "Dashboard conditionally renders synthesis overview vs visualization panel based on simple/pro mode", "ViewModeToggle responsive on TopBar").

---

## 4. §3.1/3.2 — waitlist page

```
$ ls -la web/app/waitlist/
-rw-r--r--  1 kellyb_dev kellyb_dev 17254 Aug 26 13:50 page.tsx
$ wc -l web/app/waitlist/page.tsx
289 web/app/waitlist/page.tsx
$ rg -n --max-columns 120 "onSubmit|handleSubmit|FormData|fetch\(|action=" web/app/waitlist/page.tsx
24:      const res = await fetch('/api/waitlist', {
49:  function handleSubmit(submitEvent: FormEvent<HTMLFormElement>) {
58:    <form className="waitlist" onSubmit={handleSubmit}>
```

File exists, 289 lines, has a `<form onSubmit={handleSubmit}>` posting to `/api/waitlist`.

---

## 5. §5 — GDPR footnote

Pages present:

```
$ ls web/app/ | grep -iE "terms|privacy|legal|gdpr"
legal
privacy-policy
terms-and-conditions
```

Both legal pages render markdown from `docs/legal/` at runtime (`fs.readFileSync(path.join(process.cwd(), '..', 'docs', 'legal', '<name>.md'))`), with fallback text "This document is currently being compiled by our legal team." if the file is missing.

`docs/legal/` contents (all post-dating the checklist):

```
LICENSE-ADDENDUM.md   Aug 21 20:00
NOTICE.md             Aug 20 21:42
privacy-policy.md     Aug 21 12:19
refund-policy.md      Aug 20 21:42
sub-processors.md     Aug 21 12:19
terms-of-service.md   Aug 21 20:03
```

`privacy-policy.md` matches for GDPR / retention / infra:

```
$ rg -in "GDPR|retention|72" docs/legal/privacy-policy.md
5:  vIntel values your privacy and is committed to protecting your personal data in compliance with global
   standards, including the General Data Protection Regulation (GDPR) and the California Privacy Rights
   Act (CPRA).
19:## 3. Data Retention & Automated Expiry
22:  - The source text and intermediate processing data are subjected to **Automated Data Expiry** and are
      permanently deleted from our temporary processing caches within 24 to 72 hours.
44:### European Economic Area (GDPR)
45:Under the GDPR, you have the following rights:
```

Also present in `privacy-policy.md` §7 (quoted from file): CCPA/CPRA section, GDPR rights list, "To exercise any of these rights, please contact our Data Protection Officer at privacy@getvintel.com." §8 Security mentions "HMAC validation for internal edge communication, encrypted database columns, and secure OAuth flows".

`terms-of-service.md` matches for the same keywords:

```
$ rg -in "GDPR|Supabase|Cloudflare|OpenRouter|Upstash|retention|72h|paddle" docs/legal/terms-of-service.md
(no matches)
```

T&C content (first 30 lines shown): DMCA Safe Harbor / registered DMCA Agent, mandatory indemnification, User-Agent framing — no GDPR/retention/infra text found in it.

Sub-processor ledger (`docs/legal/sub-processors.md`, "Last Updated: 2026-08-21") lists: Vercel, Supabase, Upstash, Cloudflare, Anthropic, OpenRouter, Paddle, Sentry.

---

## 6. §6.3 — bug triage issues #241/#242/#243

```
$ gh issue view 241 --json number,state,closedAt,title
{"closedAt":"2026-08-20T00:40:53Z","number":241,"state":"CLOSED","title":"worker/src/services/LLMCascade.ts hardcodes Haiku 4.5 provider order, bypasses Settings Registry SSOT (missing Azure)"}
$ gh issue view 242 --json number,state,closedAt,title
{"closedAt":"2026-08-20T13:32:00Z","number":242,"state":"CLOSED","title":"analyses.duration_seconds is a dead/NULL column across all real rows"}
$ gh issue view 243 --json number,state,closedAt,title
{"closedAt":"2026-08-20T15:26:55Z","number":243,"state":"CLOSED","title":"Knowledge Graph node-sizing gap: LLM-authored weight field has no prompt guidance"}
```

All three CLOSED on 2026-08-20.

---

## 7. §6b — load/duration stress tests

Search 1 — ledger + docs for evidence a 5-hour video or 50-concurrent test actually ran:

```
$ rg -n "5[- ]hour|five[- ]hour|50 concurrent|concurrent user|concurrent analys" .memory/AGENT_LEDGER.md docs/ -i
.memory/AGENT_LEDGER.md:278:- **Estimated effort**: 1-1.5 hours          <- "1.5 hours" substring noise
docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md:200:[the checklist's own §6b text]
docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md:201:[the checklist's own §6b text]
docs/ops/DEPENDENCY_UPDATE_AUDIT_2026-05-21.md:314:| **Total** | **~5.5 hours** | — | ...
docs/audits/RULE_AUDIT.md:484:**Effort**: ~5 hours per rule ...
docs/archive/CHUNK_11_CI_CD_COMPLETION_2026_05_14_0213.md:5:**Duration**: 1.5 hours ...
docs/archive/PRD_2026_05_14_1833.md:136 / :319 [matches, 2026-05-14 PRD]
docs/archive/CHUNK_*  / docs/PR-2-EXECUTION-CHECKLIST.md:576 / docs/PRD.md:136,:334  [effort-hour noise]
docs/investigation/RCA_INVESTIGATION_RESULTS_2026_07_10.md:88:  "Gemini 3.1 Flash fallback (~200k context) adequate for 1-5 hour videos"  [design note, 07-10]
docs/research/2026-08-18-parity-batch-results.json:1023 [research data]
```

Search 2 — filenames for stress/load/concurrency artifacts newer than 2026-08-19:

```
$ find docs web/public -newermt "2026-08-19" -type f \( -iname "*stress*" -o -iname "*load*test*" -o -iname "*concurren*" -o ... \)
(empty)
```

Search 3 — ledger "concurrent|50 users|k6|artillery|locust" matches (7 hits, all verified unrelated to a load test: 2026-07-01 retry-backoff jitter fix "5 concurrent streams", protocol notes about concurrent agent work):

```
$ sed -n '406p;435p;1144p;1157p;1182p;1186p;1187p' .memory/AGENT_LEDGER.md | cut -c1-300
406: "Post if you see conflicts with OCT2's concurrent work."
435: [2026-07-01] retry backoff thundering herd..."causing 5 concurrent streams to retry at identical milliseconds"
1144/1157/1182/1186/1187: [2026-08-06/08-09 agent-concurrency protocol/worktree notes]
```

Observed: no evidence found of a ~5-hour video test or a 50-concurrent-user test having run since 2026-08-19.

---

## 8. §7 — TestSprite / pairwise

Directory state with dates:

```
$ ls -la testsprite_tests/
TC001..TC015 *.py                    Aug 21 00:23   (15 files)
standard_prd.json                    Aug 21 00:23
testsprite_frontend_test_plan.json   Aug 21 00:23
tmp/                                 Aug 20 15:06
$ ls -la testsprite_tests/tmp/
code_summary.yaml    Aug 19 22:12
config.json          Sep  7 21:29    (mode 600)
mcp.log              Aug 20 15:06    (8,280,565 bytes)
prd_files/           Aug 19 22:11
raw_report.md        Aug 20 14:05
test_results.json    Aug 20 14:05
```

The on-disk report is NEWER than the run the checklist describes (checklist §7.1 cites 2026-08-19 22:36; report metadata says 2026-08-20):

```
$ head -12 testsprite_tests/tmp/raw_report.md
# TestSprite AI Testing Report(MCP)
## 1️ Document Metadata
- **Project Name:** hex-yt-intel
- **Date:** 2026-08-20
```

Status tally of that 08-20 report:

```
$ rg -o "Status:\*\* [A-Za-z❌✅ ]+" testsprite_tests/tmp/raw_report.md | sort | uniq -c
      5 Status:** BLOCKED
      3 Status:** ✅ Passed
      7 Status:** ❌ Failed
$ rg -n "of tests passed" testsprite_tests/tmp/raw_report.md
220:- **20.00** of tests passed
```

(3/15 passed = 20%. The 08-19 run the checklist describes tallied 2 passed / 2 failed / 11 blocked.)

Sample raw failures from the 08-20 report (verbatim):

- TC001 — TEST FAILURE: "The analysis pipeline did not complete — the app shows a critical stream failure..." Observations: page shows "Synthesis failed — see the log below"; log contains `"Critical stream failure: [Bundle 4] edge server stream 4 failed (400): {\"error\":\"Invalid appUrl callback destination\"}"`; Word Cloud "No data available for this analysis".
- Same "Invalid appUrl callback destination" error appears for `[Bundle 2] Worker stream 2 failed (400)` in TC002's section (report line 112).
- TC015 — TEST FAILURE: search for "video production tips" returned "Results 0 found"; "Only placeholder/skeleton result cards are visible".

Timeline observation (fact, not interpretation): `raw_report.md` + `test_results.json` were last written Aug 20 14:05, but the 15 TC scripts + test plan were regenerated Aug 21 00:23 — after the last results write. No results file newer than Aug 20 14:05 exists on disk. `tmp/config.json` was modified Sep 7 21:29; its field names only (values not dumped — it holds a `loginPassword`): `additionalInstruction, envs, envsFile, executionArgs, localEndpoint, loginPassword, loginUser, projectName, projectPath, scope, serverMode, serverPort, status, testIds, type`.

TANGENT (fact only): `git ls-files testsprite_tests/` shows 17 git-tracked files, and 11 of the tracked `TC*.py` scripts contain a plaintext test-account credential (email + password) inline — files: TC001, TC002, TC003, TC004, TC005, TC006, TC008, TC009, TC011, TC012, TC015. The credential value is deliberately not reproduced here.

---

## 9. New — founders page + founder checkout mechanism

```
$ ls -la web/app/founders/
-rw-r--r--  1 kellyb_dev kellyb_dev 4056 Aug 26 13:50 page.tsx
```

`web/app/founders/page.tsx` (64 lines, read in full). Key verbatim excerpts:

- Lines 14–18: `// DRAFT / PREP PAGE — same status as web/app/pricing/page.tsx: real structure built now with CANDIDATE numbers so it can be updated fast once the LLM Council's founder-tier numbers lock. Source: docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md §6/§6a/§6f/§6q, cross-checked against docs/private/council/2026-08-17_pricing_wave1_council-transcript.md. Do NOT wire real checkout/billing here until numbers are final.`
- Line 44: mounts `<FoundersTableClient />`.

`web/components/billing/founders-table-client.tsx`:

- Line 105: CTA button `label="Join the founder waitlist"` with `onClick={() => { window.location.href = '/waitlist'; }}`
- Lines 113–118 footnote: `* Candidate numbers, not final — illustrative starting points still under review, not a live offer yet. This is a single one-time payment, not a recurring subscription or renewal. ... Exact discount-lock durations, exact bounded quota sizes, and checkout are not yet built. First cohort target is roughly 200 founding members; oversubscription is welcomed, not capped.`

Checkout infrastructure that DOES exist (generic, not founder-wired):

```
$ ls web/app/api/billing/
checkout
entitlements
webhook
```

`web/app/api/billing/checkout/route.ts` head comment (verbatim): "Real (plan, interval, provider) -> price ID resolution, now Settings-Registry-backed (2026-08-18, web/lib/config/pricing.ts)... Only Pro/monthly has a real, live-or-sandbox price ID resolved from an env var today (STRIPE_PRICE_ID_PRO / PADDLE_PRO_PRICE_ID); Light/Pro-yearly/Max resolve real Paddle SANDBOX price IDs seeded by migration 20260818174553_billing_price_ids_registry.sql." Its `resolveCheckoutPriceId` plan union includes `'founder' | 'founder_tier_a'`.

`web/lib/config/pricing.ts` (lines 123–133, verbatim):

```
  founder: { once: { ...emptyProviderMap(), paddle: 'pri_founder_123' } },
  founder_tier_a: {
    // Placeholder internal key -- real marketing display name pending a
    // separate naming task (see task dispatch note). Price $49 one-time per
    // master pricing doc §6q (illustrative-but-decided per explicit
    // instruction).
    once: { ...emptyProviderMap(), paddle: 'pri_01m0bjt2sv9qkr4jyq1kpfjgmt' },
  },
  founder_tier_b: {
    // Placeholder internal key. Price $99 one-time per master pricing doc §6q.
    once: { ...emptyProviderMap(), paddle: 'pri_01m0bjt33qc1njber48kx9ewtx' },
  },
```

---

## 10. New — marketing/teaser assets dated after 2026-08-19

```
$ find web/public -newermt "2026-08-19" -type f
(empty — zero files in web/public newer than 2026-08-19)
```

Name-pattern search over `docs/` + `web/public/` for teaser/marketing/social/copy/script/tweet/launch/promo/campaign files newer than 2026-08-19 → only matched: agent dispatch prompts, `docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md` itself, and UCIS parity research files — none are marketing assets.

Content search:

```
$ rg -il "teaser|social copy|waitlist push|launch tweet|X/Twitter post" docs/
docs/research/2026-08-16-competitor-pricing-research-batch2.md   [competitor research mention]
docs/research/2026-08-18-parity-batch-results.json               [research data]
docs/research/2026-08-18-round10-results/round_b110_r1_guardrail.json
docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md                          [checklist's own text]
docs/agent-prompts/2026-09-10-oc-prelaunch-checklist-status-audit.md  [this task's dispatch prompt]
```

Closest dated candidates observed (post-08-19, but product-UI screenshots, not marketing copy):

```
docs/for_sharing/2026-09-10-founder-page-accent-review/  (Sep 10 21:03)
    dashboard-toolbar-zoom.png, dashboard.jpg, founders-page.jpg, founders-price-zoom.png
docs/for_sharing/highlights-*.png  (Aug 21 01:26–03:51 — highlights-scrubber dev screenshots)
```

Observed: no teaser image, no video script, no social-copy draft found anywhere in `docs/` or `web/public/` dated after 2026-08-19.
