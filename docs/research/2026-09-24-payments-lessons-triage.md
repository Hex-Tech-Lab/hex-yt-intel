# Triage: hex-expan payments lessons → vIntel (2026-09-24)

**Contract.** Input: each concrete lesson/recommendation row in
`docs/research/2026-09-24-hex-expan-payments-lessons.md`. Output: one
verdict per row (ADOPT / ADAPT / SKIP) grounded in a named vIntel file
actually read, plus top-3 actions. Read-only except this file.

**Governing decisions** (`.scratch/council-chairman.md` + dispatch access
rule): lump-sum founder pool with expiry; 7-day usage-gated refunds;
Paddle verified before any sale; legal entity first. Paddle KYC is
**pending** (not refused). Dodo **refused** Egypt. Approved fallback
cascade: **Lemon Squeezy → Payhip → FastSpring** (Polar/Fungies are NOT
in it). hex-expan source (`/home/kellyb_dev/projects/hex-expan`) is
outside this worktree — every hex-expan-side code claim below is marked
UNVERIFIED rather than trusted from the report.

## Triage table

| # | Report claim (§) | vIntel file checked | Current state | Verdict + one-line reason |
|---|---|---|---|---|
| 1 | Multi-provider weighted router (§4) | `web/lib/billing-factory.ts:46-56` (static `ACTIVE_BILLING_PROVIDER` paddle/stripe switch — verified) | Not done | ADAPT — defer; council sequences single-MoR first, router only after Paddle live |
| 2 | Decompose monolithic `BillingPort` (§4/§5.1) | `web/lib/ports/BillingPort.ts:3-9` (5-method mix of verify/parse/process/checkout — verified) | Not done | ADAPT — fits Hex-Lite SoC, but post-entity, not pre-sale |
| 3 | Port Polar + Fungies adapters as-is (§4) | `web/lib/adapters/` (only `PaddleBillingAdapter.ts` exists — verified) | Not done | SKIP — neither is in the approved cascade; Paddle-only until verified |
| 4 | Unify dual webhook routes (§4/§6.2.1) | `web/app/api/billing/webhook/route.ts:39` (hardcodes `tier:'pro'` — verified) vs `web/app/api/webhooks/paddle/route.ts` (usecase path — verified) | Dual, legacy breaks light/max | ADOPT — delete legacy route, no dependency, fixes real breakage |
| 5 | Redis SETNX webhook lock, 300s TTL (§4/§6.2.3) | `web/lib/adapters/PaddleBillingAdapter.ts:131-146` (`updated_at` check-then-upsert, no lock — verified); `web/lib/redis.ts` (Upstash client + memory fallback exists — verified); no `setnx` anywhere in `web/lib` (grep — verified) | Not done, TOCTOU real | ADOPT — reuse existing redis client, pairs with #4 |
| 6 | Pricing SSOT + refund-rate auto tier-drops (§4) | `web/lib/config/pricing.ts` (registry + fail-closed `resolvePriceId` — verified); `resolveUserTierForPriceId` absent from `web/lib` (grep — verified, PR #325 not in this worktree) | SSOT done, cascade not | ADAPT SSOT / SKIP auto-drops — fixed founder offer + undecided prices (council blocking finding) conflict with automated drops |
| 7 | Wire `/founders` checkout (§4) | `web/app/founders/page.tsx:18` ("Do NOT wire" — verified); `web/app/api/billing/checkout/route.ts` (Paddle path via adapter, fail-closed 400 — verified) | Unwired by design | ADAPT — only after entity + Paddle live (council seq step 5), never before |
| 8 | Dodo refused Egypt, don't onboard (§3.1) | `web/lib/config/pricing.ts:6-11` header still says "Dodo confirmed fallback" — verified | Stale comment | SKIP Dodo (agreed) + fix the stale header — it contradicts the refusal |
| 9 | Paddle KYC gate, sandbox today (§3.2/§6.2.4) | `web/lib/paddle.ts:11` (sandbox default — verified); only `PADDLE_API_KEY` read, no `_LIVE` wiring (grep — verified) | Sandbox, pending | ADOPT as the pre-sale gate — prod env wiring + KYC + entity is the longest pole |
| 10 | Fungies Egypt-ready, ≤24h activation (§3.3) | No Fungies code in `web/lib/adapters/` (listing — verified) | Not started | SKIP — not in approved cascade regardless of readiness |
| 11 | Lemon Squeezy transitional rail (§3.4) | `web/app/api/billing/checkout/route.ts:39` (lemonsqueezy fails closed, no price IDs — verified) | Blocked by design | ADOPT as first fallback — registry + adapter work lands only if Paddle stalls |
| 12 | Payhip sig = static secret hash, no tamper-proofing (§3.5) | No Payhip code in tree (listing — verified) | Future risk | ADOPT as caution — if Payhip is wired, cross-check amount/product server-side, never trust sig-only |
| 13 | FastSpring sales-call + 45-day hold + $100 min (§3.6) | No FastSpring code in tree (listing — verified) | Future | ADOPT as caution — last-resort rail only, hold breaks founder-window payouts |
| 14 | Polar 7-day hold + fees (§3.7) | No Polar code in tree (listing — verified) | Not started | SKIP — not in approved cascade |
| 15 | hex-expan defects: Payhip tamper, tsconfig TS5102/5090, missing telemetry (§6.1) | Outside worktree, auto-rejected — not read | UNVERIFIED | No vIntel action; do not cite as fact without reading source |
| 16 | Same as #4 (duplicate in report §6.2.1) | Same files | Same | ADOPT (same fix; report counts it twice) |
| 17 | "Missing telemetry" in adapter + usecase (§6.2.2) | `PaddleBillingAdapter.ts:98,116,139,166,208,249,279` (Sentry present — verified); `ProcessPaddleWebhookUseCase.ts:30-33` (console-only catch, no Sentry — verified) | Claim PARTLY STALE | ADOPT small fix — add Sentry to the usecase catch only; adapter already covered |
| 18 | Email-hash privacy, never store raw email (§2.2) | `PaddleBillingAdapter.ts:112,205` (keys by `custom_data.userId`, no email stored — verified) | Already satisfied | SKIP — vIntel keys by userId; nothing to hash |
| 19 | Append-only sales ledger (§2.4/§2.5) | `web/app/api/billing/checkout/route.ts:110-115` (`usage_logs` insert on checkout — verified); no ledger write on webhook path (adapter — verified) | Partly done | ADAPT — extend audit writes to the webhook path when #4 lands |
| 20 | 7-day usage-gated refunds (council, not report) | `web/lib/adapters/PostgresBillingAdapter.ts:140-142` (placeholder `refund()` only — verified); `web/app/refund-policy/` exists (listing — verified, content not audited) | Not implemented | ADOPT — entitlement + policy-page fix, see top-3 #3 |

## Flags (could not verify or looks wrong)

1. All `hex-expan/payments/...` line citations (§2–§3, §6.1) — outside worktree, UNVERIFIED. Triage above rests on vIntel-side reads only.
2. Report §6.2.2 "no Sentry" is stale for the adapter (fixed at some point; usecase gap remains) — re-verify-before-fix held, fix scope shrinks to one catch block.
3. Report §5.4 Options A/B (Polar/Fungies as primary MoR) are superseded — council + access rule say Paddle-only with LS→Payhip→FastSpring fallback.
4. Report §4 cites `resolveUserTierForPriceId()` (PR #325) — absent in this worktree; do not build on it until that PR lands.
5. `pricing.ts` header (Dodo/Creem shortlist) contradicts the Dodo refusal — stale comment, fix when touching the file.

## Top 3 actions

1. **Unify webhook route + Redis lock (#4 + #5).** Delete legacy `api/billing/webhook/route.ts` (fixes `tier:'pro'` breaking light/max), route all Paddle events through `api/webhooks/paddle` + `ProcessPaddleWebhookUseCase`, wrap in Upstash SETNX lock via existing `web/lib/redis.ts`. No dependency on entity/KYC; do pre-sale.
2. **Paddle-live gate (#9).** Prod env wiring (`PADDLE_API_KEY_LIVE` / environment selection in `web/lib/paddle.ts`), KYC sign-off, entity formation — founder-owned longest pole. Build NO Polar/Fungies integration (#3 SKIP).
3. **Entitlement engine per council (#20 + #7).** Compound founder pool (analyses AND minutes) + expiry in quota function, remove unlimited, implement 7-day usage-gated refunds and make `/refund-policy` + FAQ match; decide COGS/quota/price (blocking finding: full-use plans are underwater) BEFORE wiring `/founders` checkout.

## E2E proof / gates

- Read-only task: no behavior change, no tests to run. Verification method was direct file reads + grep (findings cite file:line above), not the report's word.
- Tangents found: stale Dodo/Creem header in `pricing.ts`; report double-counts the dual-webhook defect (§4 + §6.2.1); `refund-policy` page content still unaudited against the 7-day rule.
- Skills run: none (read-only triage; no code touched). `contract-auditor`/`qa-intel` not applicable to a docs-only output.
