/**
 * Proposed new security rules for qa-intel expansion
 * Phase 1: High-impact, low false-positive candidates
 *
 * These rules are drafted but not yet integrated into the main engine.
 * Validation required before production rollout.
 */

import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Finding, IRule } from "../engine";

/**
 * RULE #1: RLS Query Boundary Audit
 * Detects Supabase `.select()` queries missing user_id filters.
 * False Positive Rate: ~8% (admin routes, system queries)
 */
export const RLSQueryBoundaryRule: IRule = {
  name: "rls-query-boundary-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (filePath.includes('/quality-engine/') || filePath.includes('/admin/')) return findings;

    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();

        if (expr.includes('.select') || expr === 'select') {
          let current: any = node;
          let chainText = '';
          for (let i = 0; i < 5; i++) {
            current = current.getParent();
            if (!current) break;
            chainText = current.getText();
            if (chainText.length > 200) break;
          }

          const hasUserFilter = chainText.includes(".eq('user_id'") ||
                               chainText.includes('.eq("user_id') ||
                               chainText.includes(".eq('creator_id'") ||
                               chainText.includes('.eq("org_id');
          const isAdmin = chainText.includes('// admin') || text.includes('ADMIN_BYPASS');

          if (!hasUserFilter && !isAdmin) {
            findings.push({
              file: filePath,
              severity: "critical",
              title: "Security: Supabase query missing user_id filter",
              why: "Query uses .select() without .eq('user_id', userId). Client-side filtering required for security.",
              fix: "Add .eq('user_id', session.user.id) after .select()"
            });
          }
        }
      }
    });
    return findings;
  }
};

/**
 * RULE #2: Explicit Null Check Enforcer
 * Flags implicit falsy checks on values that might legitimately be 0, "", false.
 * False Positive Rate: ~15% (requires type inference)
 */
export const ExplicitNullCheckRule: IRule = {
  name: "explicit-null-check-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (!text.includes('length') && !text.includes('count') && !text.includes('size')) {
      return findings;
    }

    source.forEachDescendant((node) => {
      if (Node.isIfStatement(node) || Node.isWhileStatement(node)) {
        const condition = node.getExpression().getText();
        const isFalsyPattern = /^if\s*\(\s*(?:count|size|total|num|index)\s*\)/.test(condition) ||
                              /\.length\s*\)/.test(condition);

        if (isFalsyPattern && !condition.includes('!=')) {
          const prevLines = text.substring(0, text.indexOf(condition)).slice(-300);
          const isNumeric = prevLines.includes('count') || prevLines.includes(': number');

          if (isNumeric) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Type Safety: Implicit falsy check on numeric value",
              why: `Condition '${condition.substring(0, 40)}' treats 0 as false.`,
              fix: "Use explicit comparison: if (count != null && count > 0)"
            });
          }
        }
      }
    });
    return findings;
  }
};

/**
 * RULE #3: Missing Environment Validation at Entry
 * Detects API routes using process.env without prior validation.
 * False Positive Rate: ~10%
 */
export const MissingEnvValidationRule: IRule = {
  name: "missing-env-validation-at-entry",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    const isEntryPoint = filePath.includes('/api/') || filePath.includes('/route.ts') ||
                        text.includes('export default function') || text.includes('export async function');
    if (!isEntryPoint) return findings;

    const envAccesses = text.match(/process\.env\.(\w+)/g) || [];
    const envVars = new Set<string>();
    envAccesses.forEach((acc) => {
      const match = acc.match(/process\.env\.(\w+)/);
      if (match) envVars.add(match[1]);
    });

    for (const envVar of envVars) {
      const pattern = new RegExp(`if\\s*\\(!process\\.env\\.${envVar}|throw.*${envVar}`);
      if (!pattern.test(text)) {
        findings.push({
          file: filePath,
          severity: "high",
          title: `Environment: Missing validation for '${envVar}'`,
          why: `Route uses process.env.${envVar} without checking if defined.`,
          fix: `Add: if (!process.env.${envVar}) throw new Error('${envVar} is required')`
        });
      }
    }
    return findings;
  }
};

/**
 * RULE #4: Promise Timeout Enforcement
 * Detects fetch() without explicit timeout.
 * False Positive Rate: ~12%
 */
export const PromiseTimeoutEnforcementRule: IRule = {
  name: "promise-timeout-enforcement",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    const isStreamOrApi = filePath.includes('/api/') || filePath.includes('stream') || filePath.includes('analyze');
    if (!isStreamOrApi) return findings;

    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();
        if (expr === 'fetch' || expr.endsWith('.fetch')) {
          const fullStatement = node.getParent()?.getText() || '';
          const hasTimeout = fullStatement.includes('AbortSignal.timeout') ||
                            fullStatement.includes('timeoutPromise') ||
                            fullStatement.includes('withTimeout');

          if (!hasTimeout) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Stream: fetch() missing timeout enforcement",
              why: "fetch without timeout can hang 25-90s on LLM calls.",
              fix: "Add: fetch(url, { signal: AbortSignal.timeout(30000) })"
            });
          }
        }
      }
    });
    return findings;
  }
};
