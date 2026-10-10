import type { Finding } from "../domain/Finding";
import type { Rule, RuleContext } from "../domain/Rule";

/**
 * Lessons from hex-expan-press PR #97 and PR #98 (2026-10-09/10).
 * Source: hex-expan-press docs/reviews/ (exploit reasoning kept out of the public tree),
 * CodeRabbit + Cubic P1 on the launch-gate trigger, AGY hostile review of the
 * client-IP helper. Ledger entry: docs/qa-intel/RULESET_LESSONS_LEDGER.md (2026-10-10).
 *
 * Registered for the scanner in rules/index.ts. The scanner loads every exported
 * rule object from that index (verify-quality-engine.ts). rules-config.ts holds
 * placeholder entries and does not drive execution.
 */

function normalizePosixPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isTestFile(f: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(f) || f.includes("__tests__/");
}

/**
 * (L1) MVCC snapshot parity. A plpgsql function that takes an advisory lock
 * AFTER reading its own snapshot must also refuse non-READ-COMMITTED isolation.
 * Under REPEATABLE READ the snapshot predates the lock wait, so a concurrent
 * refusal is invisible to the gate (PR #97, CodeRabbit + Cubic P1).
 * Fires on a migration that uses pg_advisory_xact_lock but never mentions
 * transaction_isolation.
 */
export const AdvisoryLockIsolationGuardRule: Rule = {
  name: "advisory-lock-isolation-guard",
  scope: "file",
  languages: ["sql"],
  check: (ctx: RuleContext): Finding[] => {
    const text: string = ctx.ast?.getFullText?.() ?? String(ctx.ast ?? "");
    if (!text.includes("pg_advisory_xact_lock")) return [];
    if (text.includes("transaction_isolation")) return [];
    return [
      {
        file: normalizePosixPath(ctx.filePath),
        severity: "high",
        title: "Security: advisory-lock gate lacks an isolation-level guard",
        why: "The function takes pg_advisory_xact_lock but does not check transaction_isolation. Under REPEATABLE READ or SERIALIZABLE the snapshot is taken before the lock wait, so the gate can verify stale consents.",
        fix: "At the top of the gated branch, raise when current_setting('transaction_isolation') <> 'read committed', and add a PGlite test that a REPEATABLE READ transaction is refused.",
      },
    ];
  },
};

/**
 * (L2) Client-IP sanitization. Reading x-forwarded-for, x-real-ip or
 * x-vercel-forwarded-for directly, outside the shared helper, lets each
 * call site apply its own parsing. Earlier, the consent action and the webhook
 * disagreed, and an empty value reached an inet cast. Route all reads through
 * clientIp(headers). Test files and the helper itself are exempt.
 */
export const IpHeaderSinkRule: Rule = {
  name: "ip-header-direct-read",
  scope: "file",
  check: (ctx: RuleContext): Finding[] => {
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath) || /client-ip\.ts$/.test(filePath)) return [];
    const text: string = ctx.ast?.getFullText?.() ?? String(ctx.ast ?? "");
    const re = /headers\.get\(\s*["'](x-forwarded-for|x-real-ip|x-vercel-forwarded-for)["']\s*\)/;
    const m = re.exec(text);
    if (!m) return [];
    return [
      {
        file: filePath,
        severity: "medium",
        title: "Security: client IP read from a header directly",
        why: `Direct read of ${m[1]} lets each site parse IPs differently. Empty or port-suffixed values then reach audit sinks, and x-forwarded-for is client-supplied outside a proxy.`,
        fix: "Use clientIp(headers) from web/src/lib/client-ip.ts. It validates each candidate and never returns an empty string.",
      },
    ];
  },
};

/**
 * (L3) Launch-path isolation. Application code must not set REPEATABLE READ or
 * SERIALIZABLE for a request that goes on to the launch gate. The gate refuses
 * that isolation, so a request that sets it fails at runtime. Flags the string
 * literal in non-test source.
 */
export const LaunchPathIsolationLiteralRule: Rule = {
  name: "launch-path-isolation-literal",
  scope: "file",
  check: (ctx: RuleContext): Finding[] => {
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath)) return [];
    const text: string = ctx.ast?.getFullText?.() ?? String(ctx.ast ?? "");
    if (!/isolation level (repeatable read|serializable)/i.test(text)) return [];
    return [
      {
        file: filePath,
        severity: "medium",
        title: "Security: non-default isolation level in application code",
        why: "The launch gate refuses REPEATABLE READ and SERIALIZABLE. A request that sets either will fail at the trigger, and a retry loop would mask the cause.",
        fix: "Use the default READ COMMITTED for launch-path transactions. Keep stricter isolation in test code only.",
      },
    ];
  },
};

// Rule #0 audit-file exclusion (docs/reviews/ with exploit content) is a
// markdown check. The TS/SQL engine does not scan .md by default, so it is
// not in this file. Track it in RULESET_LESSONS_LEDGER.md as an open gap.

export const SECURITY_LESSONS_20261010_RULES: Rule[] = [
  AdvisoryLockIsolationGuardRule,
  IpHeaderSinkRule,
  LaunchPathIsolationLiteralRule,
];
