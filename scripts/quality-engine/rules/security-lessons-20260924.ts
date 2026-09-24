import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Finding } from "../domain/Finding";
import type { Rule, RuleContext } from "../domain/Rule";

function normalizePosixPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isTestFile(f: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(f) || f.includes("__tests__/");
}

/**
 * Q1 ruleset wave (2026-09-24) — billing/security cluster R1, R2, R5, R10.
 * Source: docs/qa-intel/RULESET_LESSONS_LEDGER.md entry 2026-09-24 (5 external
 * PR reviews #320-#322, #324, #325 found defects qa-intel passed clean on).
 * Each rule below has a positive-fire test on the real historical snippet and
 * a negative-control test on the fixed/safe shape; see
 * scripts/quality-engine/rules/__tests__/security-lessons-20260924.test.ts.
 */

const PAID_TIER_LITERAL = /['"](pro|founder|light|max)['"]/;

/**
 * (R1) Hardcoded entitlement grant in a payment webhook.
 * Historical bug: web/app/api/billing/webhook/route.ts granted `tier: 'pro'`
 * for any subscription event, unconditionally (also PR #325's tangent:
 * web/lib/stripe/webhook-handlers.ts hardcoding `tier: status === 'success' ? 'pro' : 'free'`).
 * Tier must come from the verified price-ID mapping, never a literal written
 * inside a webhook route.
 *
 * Scope: any file whose path contains "webhook" (route or handler module).
 * Pattern: an object property named `tier` whose initializer text contains a
 * paid-tier literal. Downgrade writes (`tier: 'free'` on cancel) are NOT
 * flagged — a literal free-downgrade is the correct fixed shape.
 */
export const HardcodedTierGrantRule: Rule = {
  name: "hardcoded-tier-grant-in-webhook",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(ctx.filePath);

    if (isTestFile(filePath)) return findings;
    if (filePath.includes("/quality-engine/")) return findings;
    if (!filePath.toLowerCase().includes("webhook")) return findings;

    source.forEachDescendant((node) => {
      if (!Node.isPropertyAssignment(node)) return;
      if (node.getNameNode().getText().replace(/['"]/g, "") !== "tier") return;
      const init = node.getInitializer();
      if (!init) return;
      const initText = init.getText();
      if (!PAID_TIER_LITERAL.test(initText)) return;
      findings.push({
        file: filePath,
        severity: "high",
        title: "Security: hardcoded paid-tier grant in a webhook handler",
        why: `Webhook file assigns a paid tier literal (${initText}) to a 'tier' property. Entitlement must be derived from the verified price-ID mapping, not a literal written in the event handler — an unconditional literal grant elevates any caller of this webhook (2026-09-24: billing/webhook route granted 'pro' for any subscription; stripe/webhook-handlers hardcoded 'pro' on success).`,
        fix: "Resolve the tier via resolveUserTierForPriceId()/the shared price→tier mapping and fail closed (null ⇒ tier unchanged); never write a paid tier literal in webhook code.",
      });
    });

    return findings;
  },
};

/**
 * (R2) Tier fallback from untrusted payload.
 * Historical bug: when the verified price-ID mapping returned null, the
 * webhook/adapter re-derived the tier from Paddle `custom_data` plan strings:
 *   return mapPlanStringToUserTier(event.data.custom_data?.planTier)
 *     ?? mapPlanStringToUserTier(event.data.items?.[0]?.price?.custom_data?.plan_tier);
 * A forged/unmapped price carrying planTier "max" would grant Max. Removed
 * in d7a57c82 — an unrecognised price must fail closed.
 *
 * Fires when a tier mapping call receives a `custom_data` expression, or a
 * ??/|| fallback chain derives a tier from custom_data.
 */
export const UntrustedTierFallbackRule: Rule = {
  name: "untrusted-custom-data-tier-fallback",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath)) return findings;
    if (filePath.includes("/quality-engine/")) return findings;

    const reported = new Set<string>();

    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const callee = node.getExpression();
        const calleeName = Node.isIdentifier(callee) ? callee.getText() : callee.getText().split(".").pop() ?? "";
        if (!/tier/i.test(calleeName)) return;
        const hasCustomDataArg = node.getArguments().some((a) => a.getText().includes("custom_data"));
        if (!hasCustomDataArg) return;
        const key = `call:${node.getStart()}`;
        if (reported.has(key)) return;
        reported.add(key);
        findings.push({
          file: filePath,
          severity: "high",
          title: "Security: tier derived from untrusted custom_data payload",
          why: `${calleeName}(${node.getArguments().map((a) => a.getText()).join(", ")}) derives an entitlement tier from the webhook payload's custom_data. custom_data is attacker-controllable; a forged plan string on an unmapped price must never re-derive a tier (2026-09-24: forged custom_data planTier "max" could grant Max when the verified mapping returned null).`,
          fix: "Fail closed: return the verified price-ID mapping result only (null ⇒ tier unchanged); remove the custom_data fallback entirely.",
        });
        return;
      }
      if (Node.isBinaryExpression(node)) {
        const op = node.getOperatorToken().getText();
        if (op !== "??" && op !== "||") return;
        const text = node.getText();
        if (!text.includes("custom_data")) return;
        if (!/tier/i.test(text)) return;
        const key = `bin:${node.getStart()}`;
        if (reported.has(key)) return;
        reported.add(key);
        findings.push({
          file: filePath,
          severity: "high",
          title: "Security: tier fallback chain reads untrusted custom_data",
          why: `A ${op} fallback chain in tier-derivation reads custom_data from the request payload. When the verified mapping returns null, falling back to custom_data plan strings lets a forged payload select the granted tier (2026-09-24).`,
          fix: "Fail closed: no fallback — null from the verified mapping must leave the tier unchanged.",
        });
      }
    });

    return findings;
  },
};

/**
 * (R5) Service-role credential falling back to the anon key.
 * Historical bug: scripts/backfill-stance-relations.ts (PR #322, 8c159c92):
 *   const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 * Under RLS the anon key silently returns 0 rows — the job "succeeds" doing
 * nothing instead of failing loudly on the missing service-role key.
 */
const SERVICE_ROLE_ANON_FALLBACK = /SERVICE_ROLE[_A-Z]*(KEY)?\s*(\|\||\?\?)[^;\n]*ANON_KEY/i;

export const ServiceRoleAnonFallbackRule: Rule = {
  name: "service-role-key-fallback-to-anon",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath)) return findings;
    if (filePath.includes("/quality-engine/")) return findings;

    if (!SERVICE_ROLE_ANON_FALLBACK.test(source.getText())) return findings;

    findings.push({
      file: filePath,
      severity: "high",
      title: "Security: service-role key silently falls back to anon key",
      why: "SUPABASE_SERVICE_ROLE_KEY is coerced to NEXT_PUBLIC_SUPABASE_ANON_KEY via a fallback operator. Under RLS the anon key returns 0 rows, so the operation silently does nothing while reporting success (2026-09-24: PR #322 backfill).",
      fix: "Fail fast: if the service-role key is required, throw/exit when it is missing — never fall back to the anon key.",
    });
    return findings;
  },
};

/**
 * (R10) Runtime tier trust — treating any non-'free' string as paid, or
 * casting a raw DB value to UserTier without an allowlist normalizer.
 * Historical bug (PR #325 P1 #3): `tier !== 'free'` used as "is paid" and
 * `profile?.tier as UserTier` (web/app/api/usage/summary/route.ts:48) trust
 * whatever string sits in users.tier — legacy/unknown values would get paid
 * treatment. The fixed shape is normalizeUserTier(value) (allowlist, unknown
 * → free) — not yet in the codebase at rule time; its absence is exactly
 * what these findings flag.
 */
export const RuntimeTierTrustRule: Rule = {
  name: "runtime-tier-trust-without-normalizer",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath)) return findings;
    if (filePath.includes("/quality-engine/")) return findings;

    // A raw tier operand must be a bare identifier or property/optional-chain
    // access (e.g. `tier`, `profile?.tier`). A call expression operand (e.g.
    // `normalizeUserTier(profile.tier) !== 'free'`) is already normalized and
    // is the rule's own recommended fix — exempting it keeps the fix shape
    // false-positive-free.
    const isRawTierOperand = (n: Node): boolean => {
      if (Node.isIdentifier(n)) return /\btier\b/i.test(n.getText());
      if (Node.isPropertyAccessExpression(n)) return /\btier\b/i.test(n.getName());
      return false;
    };

    source.forEachDescendant((node) => {
      // (a) `tier !== 'free'` (either operand order) treated as "is paid".
      if (Node.isBinaryExpression(node)) {
        const op = node.getOperatorToken().getText();
        if (op !== "!==" && op !== "!=") return;
        const leftNode = node.getLeft();
        const rightNode = node.getRight();
        const left = leftNode.getText();
        const right = rightNode.getText();
        const tierIsLeft = isRawTierOperand(leftNode);
        const tierIsRight = isRawTierOperand(rightNode);
        if (!tierIsLeft && !tierIsRight) return;
        const literalSide = tierIsLeft ? right : left;
        if (!/^['"]free['"]$/.test(literalSide.trim())) return;
        findings.push({
          file: filePath,
          severity: "high",
          title: "Security: non-'free' treated as a paid tier at runtime",
          why: `${node.getText()} treats any string other than 'free' as a paid tier. users.tier may hold legacy/unknown values (Light/Max vocabulary step, PR #325); only an allowlist normalizer can decide paid vs free.`,
          fix: "Use normalizeUserTier(value) (allowlist: free|pro|founder|light|max, unknown ⇒ free) and compare against the normalized value — never infer paid from !== 'free'.",
        });
        return;
      }
      // (b) `X.tier as UserTier` cast on a raw value without normalization.
      // A call-expression operand (`normalizeUserTier(x) as UserTier`) is
      // exempt — the value already went through the allowlist normalizer.
      if (Node.isAsExpression(node)) {
        const typeText = node.getTypeNode()?.getText();
        if (typeText !== "UserTier") return;
        const exprNode = node.getExpression();
        if (Node.isCallExpression(exprNode)) return;
        const exprText = exprNode.getText();
        if (!(Node.isIdentifier(exprNode) ? /\btier\b/i.test(exprText) : Node.isPropertyAccessExpression(exprNode) && /\btier\b/i.test(exprNode.getName()))) return;
        findings.push({
          file: filePath,
          severity: "high",
          title: "Security: raw tier value cast to UserTier without normalization",
          why: `${exprText} as UserTier trusts whatever string the database holds. A legacy/unknown/garbage value becomes a typed paid tier with zero validation (2026-09-24: web/app/api/usage/summary/route.ts).`,
          fix: "Pass the raw value through normalizeUserTier() (allowlist, unknown ⇒ free) instead of casting; make the normalizer the only place UserTier is produced from persisted data.",
        });
      }
    });

    return findings;
  },
};
