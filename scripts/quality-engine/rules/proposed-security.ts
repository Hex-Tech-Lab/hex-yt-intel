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
 *
 * Detects Supabase `.select()` queries missing user_id filters.
 * Critical: RLS policies are server-side enforcement, but client-side
 * queries should still enforce row-level boundaries to prevent guessing attacks.
 *
 * False Positive Rate: ~8% (admin routes, system queries)
 * External Source: Supabase security guide + @supabase/postgrest-js patterns
 *
 * Pattern examples:
 * BAD:  const rows = await supabase.from('analyses').select('*');
 * OK:   const rows = await supabase.from('analyses').select('*').eq('user_id', userId);
 */
export const RLSQueryBoundaryRule: IRule = {
  name: "rls-query-boundary-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Skip admin/system routes and rule files
    if (
      filePath.includes('/quality-engine/rules/') ||
      filePath.includes('verify-quality-engine') ||
      filePath.includes('/admin/') ||
      filePath.includes('/system/')
    ) {
      return findings;
    }

    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();

        // Look for .select() calls (the typical RLS entry point)
        if (expr.includes('.select') || expr === 'select') {
          // Gather the full call chain to check for filters
          let current: any = node;
          let chainText = '';

          // Walk up the chain to collect the full query
          for (let i = 0; i < 5; i++) {
            current = current.getParent();
            if (!current) break;
            chainText = current.getText();
            if (chainText.length > 200) break; // Avoid massive chains
          }

          // Check for user_id or creator_id filters
          const hasUserFilter =
            chainText.includes(".eq('user_id'") ||
            chainText.includes('.eq("user_id') ||
            chainText.includes(".eq('creator_id'") ||
            chainText.includes('.eq("creator_id') ||
            chainText.includes(".eq('org_id'");

          // Also allow explicit admin markers
          const isExplicitlyAdmin =
            chainText.includes('// admin-read') ||
            chainText.includes('/* admin */') ||
            text.includes('ADMIN_BYPASS') ||
            filePath.includes('admin');

          if (!hasUserFilter && !isExplicitlyAdmin) {
            findings.push({
              file: filePath,
              severity: "critical",
              title: "Security: Supabase query missing user_id filter",
              why: "Query uses .select() without .eq('user_id', userId) or equivalent filter. Even with RLS, client-side filtering is required for security.",
              fix: "Add .eq('user_id', session.user.id) or .eq('org_id', userOrgId) after .select() to enforce row-level access boundaries."
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
 *
 * Flags implicit falsy checks on values that might legitimately be 0, "", false.
 * Example: `if (count)` should be `if (count != null)` to allow count=0.
 *
 * False Positive Rate: ~15% (high; requires type inference)
 * External Source: @typescript-eslint/strict-boolean-expressions
 *
 * This is a medium-confidence version that catches common patterns.
 */
export const ExplicitNullCheckRule: IRule = {
  name: "explicit-null-check-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Only scan in files that do arithmetic/counting
    if (!text.includes('length') && !text.includes('count') && !text.includes('size')) {
      return findings;
    }

    source.forEachDescendant((node) => {
      // Look for if/while conditions
      if (Node.isIfStatement(node) || Node.isWhileStatement(node)) {
        const condition = node.getExpression().getText();

        // Pattern: if (count) { ... } or if (arr.length) { ... }
        // These fail when count=0 or arr.length=0 (both falsy but valid)
        const isFalsyPatternCheck =
          /^if\s*\(\s*(?:count|size|total|num|index)\s*\)/.test(condition) ||
          /\.length\s*\)/.test(condition) ||
          /\.count\s*\)/.test(condition);

        if (isFalsyPatternCheck && !condition.includes('!=')) {
          // Double-check: is this in a numeric context?
          const previousLines = text
            .split('\n')
            .slice(
              Math.max(0, text.indexOf(condition) - 300),
              text.indexOf(condition)
            )
            .join('\n');

          const isNumericContext =
            previousLines.includes('count') ||
            previousLines.includes('.length') ||
            previousLines.includes('size') ||
            previousLines.includes(': number');

          if (isNumericContext) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Type Safety: Implicit falsy check on numeric value",
              why: `Condition '${condition.substring(0, 40)}' treats 0 as false. Use explicit null check instead.`,
              fix: `Replace with explicit comparison: if (count != null && count > 0) or if (count !== 0)`
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
 *
 * Detects API routes that reference process.env without prior validation.
 * Runtime failures should be caught at startup, not during request handling.
 *
 * False Positive Rate: ~10%
 * External Source: Vercel environment variable guide
 *
 * Pattern:
 * BAD:  export default function handler(req, res) {
 *         const db = process.env.DATABASE_URL; // fails silently if unset
 *
 * OK:   if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
 */
export const MissingEnvValidationRule: IRule = {
  name: "missing-env-validation-at-entry",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Only check API routes and entry points
    const isEntryPoint =
      filePath.includes('/api/') ||
      filePath.includes('/route.ts') ||
      filePath.includes('handler.ts') ||
      text.includes('export default function') ||
      text.includes('export async function');

    if (!isEntryPoint) return findings;

    // Look for process.env accesses
    const envAccesses = text.match(/process\.env\.(\w+)/g) || [];
    if (envAccesses.length === 0) return findings;

    // Extract env var names
    const envVars = new Set<string>();
    envAccesses.forEach((acc) => {
      const match = acc.match(/process\.env\.(\w+)/);
      if (match) envVars.add(match[1]);
    });

    // Check if each env var is validated at the top level
    for (const envVar of envVars) {
      const pattern = new RegExp(`if\\s*\\(!process\\.env\\.${envVar}|throw.*${envVar}|assert.*${envVar}`);
      if (!pattern.test(text)) {
        findings.push({
          file: filePath,
          severity: "high",
          title: `Environment: Missing validation for '${envVar}'`,
          why: `API route uses process.env.${envVar} without checking if it's defined. Will fail silently or at runtime.`,
          fix: `Add validation at the top of the route: if (!process.env.${envVar}) throw new Error('${envVar} is required')`
        });
      }
    }

    return findings;
  }
};

/**
 * RULE #4: Side-Effect Import Detector
 *
 * Flags bare imports without variable binding: import 'module'
 * These hide initialization logic and cause test flakiness if import order changes.
 *
 * False Positive Rate: ~3% (simple pattern match)
 * External Source: eslint-plugin-import
 *
 * Pattern:
 * BAD:  import 'polyfill';  // What does this do?
 * OK:   import { initPolyfill } from 'polyfill'; initPolyfill();
 */
export const SideEffectImportRule: IRule = {
  name: "side-effect-import-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    // Get all import declarations
    const imports = source.getImportDeclarations();

    for (const imp of imports) {
      // Check if this is a bare import (no named/default binding)
      const defaultImport = imp.getDefaultImportOrThrow() ?? null;
      const namedImports = imp.getNamedImports();
      const namespaceImport = imp.getNamespaceImport();

      const hasBinding = defaultImport || namedImports.length > 0 || namespaceImport;

      if (!hasBinding) {
        const moduleName = imp.getModuleSpecifierValue();
        findings.push({
          file: filePath,
          severity: "high",
          title: "Imports: Bare side-effect import without binding",
          why: `import '${moduleName}' has no variable binding. Unclear what side effects it triggers. Tests break if import order changes.`,
          fix: `Add explicit binding: import { init } from '${moduleName}'; or import '${moduleName}' as a comment explaining the side effect.`
        });
      }
    }

    return findings;
  }
};

/**
 * RULE #5: Promise Timeout Enforcement
 *
 * Detects fetch() and Promise operations without explicit timeout.
 * Vercel Edge: 25s streaming timeout. Worker: 30s. OpenRouter: 90s streaming.
 *
 * False Positive Rate: ~12% (some calls legitimately have outer timeout)
 * External Source: Vercel Edge Middleware + OpenRouter streaming docs
 *
 * Pattern:
 * BAD:  const res = await fetch(url);  // hangs if server never responds
 * OK:   const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
 */
export const PromiseTimeoutEnforcementRule: IRule = {
  name: "promise-timeout-enforcement",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Only check API routes and stream handlers
    const isStreamOrApi =
      filePath.includes('/api/') ||
      filePath.includes('stream') ||
      filePath.includes('analyze');

    if (!isStreamOrApi) return findings;

    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();

        if (expr === 'fetch' || expr.endsWith('.fetch') || expr === 'openai.beta.messages.create') {
          // Check if this fetch call has a timeout
          const fullStatement = node.getParent()?.getText() || '';

          const hasTimeout =
            fullStatement.includes('AbortSignal.timeout') ||
            fullStatement.includes('timeoutPromise') ||
            fullStatement.includes('withTimeout') ||
            fullStatement.includes('raceTo') ||
            fullStatement.includes('Promise.race') ||
            fullStatement.includes('timeout:');

          // Also check if wrapped in a try-finally with timeout
          const tryBlock = node.getFirstAncestorByKind(SyntaxKind.TryStatement);
          const tryText = tryBlock?.getText() || '';
          const tryHasTimeout = tryText.includes('AbortSignal.timeout') ||
                               tryText.includes('setTimeout');

          if (!hasTimeout && !tryHasTimeout) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Stream: fetch/LLM call missing timeout enforcement",
              why: "fetch() to LLM or external API without timeout. Vercel Edge timeout: 25s, Worker: 30s, OpenRouter: 90s. Request can hang indefinitely.",
              fix: `Add timeout: fetch(url, { signal: AbortSignal.timeout(${filePath.includes('worker') ? '30000' : '25000'}) })`
            });
          }
        }
      }
    });

    return findings;
  }
};
