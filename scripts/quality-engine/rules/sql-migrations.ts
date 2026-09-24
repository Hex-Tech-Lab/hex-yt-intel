/**
 * SQL migration rules (Wave Q4, 2026-09-24).
 *
 * Gap (RULESET_LESSONS_LEDGER 2026-09-24, R4 + R13): qa-intel only globs
 * TS/TSX, so `supabase/migrations/*.sql` was never scanned and two real
 * defect classes shipped:
 *   R4  - PR #322's SECURITY DEFINER RPC (merge_analysis_payload_key) was
 *         granted to `authenticated` and accepted ANY caller-controlled
 *         payload key -> any logged-in user could overwrite any top-level
 *         key of their own analyses via PostgREST (fixed by CC c230345c with
 *         a key allowlist).
 *   R13 - PR #328's first head (b2f1648d) shipped `DROP FUNCTION ...( ...
 *         timestamptz DEFAULT NULL)` inside the argument list -- a Postgres
 *         syntax error that broke the Supabase preview branch (fixed
 *         ccb6f85a: arg TYPES only, no DEFAULT).
 *
 * Implementation limitation (documented, accepted): rules are TEXT/regex
 * based, not SQL-AST based -- the quality engine's loader is ts-morph, which
 * parses .sql files as plain text with no SQL grammar. Patterns below are
 * tuned against the real migrations on disk and the two historical incidents;
 * they are deliberately conservative to keep the false-positive rate at zero
 * on the current repo (the severity-high precondition).
 *
 * Historical migrations (filename date BEFORE 2026-09-24, the wave date)
 * are reported at `low` severity as informational: they are already applied
 * to the database and must never block CI. Current/new migrations report at
 * their real severity.
 */

import type { SourceFile } from "ts-morph";
import type { Finding } from "../domain/Finding";
import type { Rule, RuleContext } from "../domain/Rule";

/** Wave date: rules scan migrations from this date onward at full severity. */
const RULE_WAVE_DATE = "20260924";

function isSqlMigrationFile(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/").replace(/^\//, "");
  return norm.startsWith("supabase/migrations/") && norm.endsWith(".sql");
}

/** Migration filename convention is `YYYYMMDDHHMMSS_name.sql`. Returns "" when unparsable. */
function migrationDate(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  return /^\d{8}/.test(base) ? base.slice(0, 8) : "";
}

/** Pre-wave migrations are historical: applied already, informational only. */
function severityFor(filePath: string, baseSeverity: Finding["severity"]): Finding["severity"] {
  const date = migrationDate(filePath);
  if (date && date < RULE_WAVE_DATE) return "low";
  return baseSeverity;
}

function historical(filePath: string): boolean {
  const date = migrationDate(filePath);
  return !!date && date < RULE_WAVE_DATE;
}

/**
 * Caller-controlled key/column/path-shaped TEXT parameter, e.g. `p_key text`.
 * Deliberately narrow (key|column|col|path|field|sort|order|table|schema) to
 * keep false positives at zero on the current repo; a generic uuid/int param
 * (p_analysis_id, p_user_id, ...) is NOT the injection surface.
 */
const CALLER_KEY_PARAM = /(\w*(?:key|column|col|path|field|sort|order|table|schema)\w*)\s+text\b/gi;

interface FunctionBlock {
  name: string;
  params: string;
  body: string;
}

/**
 * Extract `create [or replace] function <name>(<params>) ... $$;` regions.
 * A plpgsql function block runs from the header to the terminating `$$;`
 * (fallback: end of file). Text-based scoping is the accepted limitation of
 * this rule family.
 */
function extractFunctionBlocks(text: string): FunctionBlock[] {
  const blocks: FunctionBlock[] = [];
  const header = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = header.exec(text)) !== null) {
    const name = m[1];
    const params = m[2];
    const blockStart = m.index;
    const bodyEnd = text.indexOf("$$;", m.index + m[0].length);
    const body = bodyEnd === -1 ? text.slice(blockStart) : text.slice(blockStart, bodyEnd + 3);
    blocks.push({ name, params, body });
  }
  return blocks;
}

interface GrantPosture {
  revokedFrom: Set<string>;
  grantedTo: Set<string>;
}

function grantPostureFor(text: string, functionName: string): GrantPosture {
  const revokedFrom = new Set<string>();
  const grantedTo = new Set<string>();
  const esc = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const revoke = new RegExp(
    `revoke\\s+(?:all(?:\\s+privileges)?(?:\\s+on\\s+function)?|execute(?:\\s+on\\s+function)?)\\s+(?:on\\s+function\\s+)?(?:public\\.)?${esc}\\s*\\([^)]*\\)\\s+from([^.]*?);`,
    "gis"
  );
  const grant = new RegExp(
    `grant\\s+(?:all(?:\\s+privileges)?(?:\\s+on\\s+function)?|execute(?:\\s+on\\s+function)?)\\s+(?:on\\s+function\\s+)?(?:public\\.)?${esc}\\s*\\([^)]*\\)\\s+to([^.]*?);`,
    "gis"
  );
  let m: RegExpExecArray | null;
  while ((m = revoke.exec(text)) !== null) {
    for (const role of m[1].split(",")) revokedFrom.add(role.trim().toLowerCase());
  }
  while ((m = grant.exec(text)) !== null) {
    for (const role of m[1].split(",")) grantedTo.add(role.trim().toLowerCase());
  }
  return { revokedFrom, grantedTo };
}

const UNTRUSTED_ROLES = ["anon", "authenticated", "public"] as const;

/** Postgres grants EXECUTE to PUBLIC by default, so a function is only safe
 * if a REVOKE covers all three untrusted roles (the repo's established
 * posture, e.g. record_remediation_failure 20260911180903). A partial revoke
 * (e.g. `from anon, public` while granting `to authenticated`) leaves the
 * granted role exposed. */
function isExposed(posture: GrantPosture): boolean {
  const grantTargets = [...posture.grantedTo].filter((r) => (UNTRUSTED_ROLES as readonly string[]).includes(r));
  if (grantTargets.length > 0) return true;
  const covered = UNTRUSTED_ROLES.every((r) => posture.revokedFrom.has(r));
  return !covered;
}

/** An allowlist guard on the key parameter (the c230345c fix shape) closes
 * the injection surface: only enumerated keys can ever reach jsonb paths. */
function hasKeyAllowlistGuard(body: string, keyParam: string): boolean {
  const esc = keyParam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const guard = new RegExp(`${esc}[\\s\\S]{0,160}not\\s+in\\s*\\(`, "i");
  return guard.test(body) || /allowlist/i.test(body);
}

export const SqlSecurityDefinerCallerKeyRule: Rule = {
  name: "sql-security-definer-caller-key-param",
  scope: "file",
  languages: ["sql"],
  check: (ctx: RuleContext) => {
    const findings: Finding[] = [];
    const filePath = ctx.filePath.replace(/\\/g, "/");
    if (!isSqlMigrationFile(filePath)) return findings;

    const text = (ctx.ast as SourceFile).getText();

    for (const block of extractFunctionBlocks(text)) {
      if (!/\bsecurity\s+definer\b/i.test(block.body)) continue;
      CALLER_KEY_PARAM.lastIndex = 0;
      const paramMatch = CALLER_KEY_PARAM.exec(block.params);
      if (!paramMatch) continue;
      const keyParam = paramMatch[1];
      if (hasKeyAllowlistGuard(block.body, keyParam)) continue;
      const posture = grantPostureFor(text, block.name);
      if (!isExposed(posture)) continue;

      findings.push({
        file: filePath,
        severity: severityFor(filePath, "high"),
        title: "SQL: SECURITY DEFINER function exposes a caller-controlled key/column parameter to untrusted callers",
        why: `Function ${block.name} runs with elevated (SECURITY DEFINER) privileges, its EXECUTE grant reaches untrusted callers (${[...posture.grantedTo].join(", ") || "implicit PUBLIC default"}), and it accepts a caller-controlled key/column/path-shaped text parameter '${keyParam}'. A caller can steer which field/path the definer writes or reads, turning the RPC into an arbitrary-field overwrite (real incident: PR #322's merge_analysis_payload_key accepted any payload key; fixed only after external review).`,
        fix: `Either (a) drop the caller-controlled '${keyParam}' parameter entirely, (b) hard-allowlist the permitted values inside the function body (e.g. IF ${keyParam} NOT IN ('allowed_key') THEN RAISE EXCEPTION), and/or (c) REVOKE EXECUTE ... FROM anon, authenticated, public and grant only to service_role.`,
      });
    }
    return findings;
  },
};

/**
 * R13: `DROP FUNCTION name( <args> )` where the argument list contains a
 * DEFAULT clause. DROP FUNCTION takes argument TYPES only -- a DEFAULT
 * clause there is a Postgres syntax error that fails the migration (real
 * incident: PR #328 head b2f1648d, `p_date_from timestamp with time zone
 * DEFAULT NULL` broke the Supabase preview branch). Positive-fire fixture in
 * sql-migrations.test.ts uses the verbatim b2f1648d content.
 */
export const SqlDropFunctionDefaultArgRule: Rule = {
  name: "sql-drop-function-default-arg",
  scope: "file",
  languages: ["sql"],
  check: (ctx: RuleContext) => {
    const findings: Finding[] = [];
    const filePath = ctx.filePath.replace(/\\/g, "/");
    if (!isSqlMigrationFile(filePath)) return findings;

    const text = (ctx.ast as SourceFile).getText();
    const drop = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = drop.exec(text)) !== null) {
      const args = m[2];
      if (!/\bdefault\b/i.test(args)) continue;
      const defaultArg = args
        .split(",")
        .find((a) => /\bdefault\b/i.test(a))!
        .trim()
        .replace(/\s+/g, " ");
      findings.push({
        file: filePath,
        severity: severityFor(filePath, "high"),
        title: "SQL: DROP FUNCTION argument list contains a DEFAULT clause (Postgres syntax error)",
        why: `DROP FUNCTION takes argument TYPES only, but the argument list for ${m[1]} contains '${defaultArg}'. A DEFAULT clause in a DROP FUNCTION signature is a Postgres syntax error -- the migration fails and breaks the branch/preview (real incident: PR #328 first head b2f1648d, 2026-09-24).`,
        fix: `Remove the DEFAULT clause(s) from the DROP FUNCTION argument list -- keep only the argument types (e.g. 'timestamp with time zone', not 'timestamp with time zone DEFAULT NULL').`,
      });
    }
    return findings;
  },
};
