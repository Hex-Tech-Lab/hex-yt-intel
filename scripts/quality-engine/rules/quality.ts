import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Finding, IRule } from "../engine";

export const AsyncWithoutAwaitRule: IRule = {
  name: "async-without-await-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    source.forEachDescendant((node) => {
      if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
        // Check if function is async
        const isAsync = node.getModifiers().some(m => m.getKind() === SyntaxKind.AsyncKeyword);
        if (isAsync) {
          // Check if body contains any await
          const body = Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node)
            ? node.getBody()
            : (node as any).getBody?.();

          if (body) {
            const bodyText = body.getText();
            const hasAwait = bodyText.includes('await ');

            if (!hasAwait) {
              // Get function name for better reporting
              const funcName = (node as any).getName?.() || 'anonymous';
              findings.push({
                file: filePath,
                severity: "medium",
                title: `Code Quality: Redundant 'async' keyword (no await found)`,
                why: `Function '${funcName}' is marked async but contains no await expressions. This may indicate copy-paste or incomplete refactoring.`,
                fix: "Remove the 'async' keyword or add 'await' expression. If function returns a Promise, return it directly without 'async'."
              });
            }
          }
        }
      }
    });

    return findings;
  }
};

export const DeadCodeRule: IRule = {
  name: "dead-code-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    try {
      source.forEachDescendant((node) => {
        try {
          // Detect unreachable if statements (always false conditions)
          if (Node.isIfStatement(node)) {
            try {
              const condition = node.getCondition?.();
              if (condition) {
                const condText = condition.getText().trim();
                // Check for obviously false conditions like !optionsSent when it's always true
                if (condText === 'false' || condText === '!true') {
                  findings.push({
                    file: filePath,
                    severity: "medium",
                    title: "Code Quality: Unreachable code block",
                    why: "If condition is always false, the entire block is unreachable dead code.",
                    fix: "Remove the unreachable if statement and its body."
                  });
                }
              }
            } catch {
              // Skip nodes without condition
            }
          }
        } catch {
          // Skip any node processing errors
        }
      });
    } catch {
      // Silently skip if any errors occur
    }

    return findings;
  }
};

export const VariableNamingRule: IRule = {
  name: "variable-naming-clarity",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    source.forEachDescendant((node) => {
      if (Node.isVariableDeclaration(node) || Node.isParameterDeclaration(node)) {
        const nameNode = node.getNameNode?.() || (node as any).getName?.();
        if (nameNode) {
          const name = typeof nameNode === 'string' ? nameNode : nameNode.getText?.() ?? '';

          // Flag single-letter variable names (except in loops or very short scopes)
          if (name.length === 1 && name !== 'i' && name !== 'j' && name !== 'x' && name !== 'y') {
            // Exempt a single-letter PARAMETER that is the sole parameter of
            // an arrow function passed directly as a callback argument to a
            // call expression -- e.g. `useFooStore((s) => s.bar)`,
            // `.map((x) => ...)`, `.then((r) => ...)`. This is a near-
            // universal functional idiom (Zustand/Redux selectors, array
            // methods, promise chains) across this codebase and the wider
            // ecosystem, not an unclear-naming case: the parameter's whole
            // referent is the single argument the call site already names.
            // (2026-09-10 fix: false-positived on `(s) => s.error` in this
            // exact codebase's own pervasive Zustand selector convention.)
            if (Node.isParameterDeclaration(node)) {
              const arrowFn = node.getParent();
              const callExpr = arrowFn?.getParent();
              if (
                Node.isArrowFunction(arrowFn) &&
                arrowFn.getParameters().length === 1 &&
                // A rest parameter (`(...q) => q.length`) also satisfies
                // `getParameters().length === 1`, but it represents a
                // variable-length collection, not the single callback value
                // this exemption is meant for -- it must still be flagged.
                // (2026-09-11 fix, external review on PR #307 finding #1.)
                !node.isRestParameter() &&
                Node.isCallExpression(callExpr) &&
                // Defensive guard: ensure the arrow is an ARGUMENT of the
                // call, not its callee. In practice the TS AST always wraps
                // an arrow-as-callee in a ParenthesizedExpression (so
                // `Node.isCallExpression(callExpr)` already excludes IIFEs
                // like `((q) => q.trim())()`), but this check is harmless
                // belt-and-suspenders against any AST shape where the arrow
                // somehow lands as the call's callee rather than an arg.
                // (2026-09-10, external review on PR #307 finding #2.)
                callExpr.getArguments().includes(arrowFn)
              ) {
                return;
              }
            }
            // Check if this is in a loop context
            let inLoop = false;
            let current = node.getParent();
            while (current) {
              if (Node.isForStatement(current) || Node.isForInStatement(current) || Node.isForOfStatement(current) || Node.isWhileStatement(current)) {
                inLoop = true;
                break;
              }
              current = current.getParent?.();
            }

            if (!inLoop) {
              findings.push({
                file: filePath,
                severity: "low",
                title: `Code Quality: Unclear variable name '${name}'`,
                why: `Single-letter variable '${name}' outside of loop context is unclear. Makes code harder to understand.`,
                fix: `Rename to a descriptive name that explains the variable's purpose (e.g., '${name}' → 'question', 'error', etc.).`
              });
            }
          }
        }
      }
    });

    return findings;
  }
};

export const TimeoutCleanupRule: IRule = {
  name: "timeout-cleanup-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    // qa-intel's own rule tests embed deliberately-bad example code as
    // TEMPLATE-LITERAL TEXT to feed to the rule under test (e.g.
    // wave9-new-rules.test.ts's `const code = \`const timerId = setTimeout(...)\`\`)
    // -- a plain source.getText() scan can't distinguish that from real
    // executable code in the test file itself (review finding, 2026-09-07).
    if (filePath.includes('/quality-engine/') && (filePath.includes('.test.') || filePath.includes('__tests__/'))) {
      return findings;
    }
    const text = source.getText();

    // Look for setTimeout/setInterval without corresponding cleanup
    if (text.includes('setTimeout') || text.includes('setInterval')) {
      const timerPattern = /const\s+(\w+)\s*=\s*(?:setTimeout|setInterval)\s*\(/g;
      const matches = text.matchAll(timerPattern);

      for (const match of matches) {
        const handleName = match[1];
        // Check if this handle is cleared anywhere
        const isClearedRegex = new RegExp(`clearTimeout\\(${handleName}\\)|clearInterval\\(${handleName}\\)`);
        if (!isClearedRegex.test(text)) {
          findings.push({
            file: filePath,
            severity: "medium",
            title: `Resource Leak: Timer handle '${handleName}' not cleared`,
            why: `Variable '${handleName}' holds a timeout/interval ID but is never cleared. This can cause memory leaks or unintended side effects.`,
            fix: `Add cleanup in finally block or useEffect cleanup: clearTimeout(${handleName}); or clearInterval(${handleName});`
          });
        }
      }
    }

    return findings;
  }
};

export const ImportOrderingRule: IRule = {
  name: "import-ordering-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    // Get all import declarations
    const imports = source.getImportDeclarations();
    if (imports.length < 2) return findings;

    const categories = {
      framework: [] as string[],       // react, next, etc.
      thirdparty: [] as string[],      // external packages
      internal: [] as string[],        // local imports starting with ./
      types: [] as string[]            // type-only imports
    };

    for (const imp of imports) {
      const specifier = imp.getModuleSpecifierValue();
      const isTypeOnly = imp.isTypeOnly();

      if (isTypeOnly) {
        categories.types.push(specifier);
      } else if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/')) {
        categories.internal.push(specifier);
      } else if (specifier === 'react' || specifier.startsWith('react') || specifier.startsWith('next') || specifier === 'zustand' || specifier.startsWith('@sentry')) {
        categories.framework.push(specifier);
      } else {
        categories.thirdparty.push(specifier);
      }
    }

    // Check ordering: should be framework → thirdparty → internal → types
    const order = ['framework', 'thirdparty', 'internal', 'types'] as const;
    let lastCategory = -1;

    for (const imp of imports) {
      const specifier = imp.getModuleSpecifierValue();
      const isTypeOnly = imp.isTypeOnly();

      let category: typeof order[number] = 'thirdparty';
      if (isTypeOnly) category = 'types';
      else if (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/')) category = 'internal';
      else if (specifier === 'react' || specifier.startsWith('react') || specifier.startsWith('next') || specifier === 'zustand' || specifier.startsWith('@sentry')) category = 'framework';

      const currentCategoryIndex = order.indexOf(category);
      if (currentCategoryIndex < lastCategory) {
        findings.push({
          file: filePath,
          severity: "low",
          title: "Code Quality: Import ordering violated",
          why: `Import '${specifier}' (${category}) comes after ${order[lastCategory]}. Should follow order: framework → thirdparty → internal → types.`,
          fix: "Reorganize imports to follow the correct order groups."
        });
        break; // Report once per file
      }
      lastCategory = currentCategoryIndex;
    }

    return findings;
  }
};

export const ErrorObservabilityRule: IRule = {
  name: "error-observability-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    source.forEachDescendant((node) => {
      // Look for catch blocks without logging/Sentry
      if (Node.isCatchClause(node)) {
        try {
          const block = node.getBlock();
          if (block) {
            const bodyText = block.getText();

            // Check if catch block contains any logging or Sentry
            const hasObservability = bodyText.includes('console.') || bodyText.includes('Sentry.') || bodyText.includes('logger.');

            if (!hasObservability && !bodyText.trim().startsWith('//')) {
              findings.push({
                file: filePath,
                severity: "medium",
                title: "Observability: Catch block without error logging",
                why: "Error is caught but not logged, making debugging difficult.",
                fix: "Add error logging: console.error('[context]', error); or Sentry.captureException(error);"
              });
            }
          }
        } catch {
          // Skip if API not available on this node
        }
      }

      // Look for try-catch-ignore patterns
      if (Node.isTryStatement(node)) {
        try {
          const catchClause = node.getCatchClause();
          if (catchClause) {
            const block = catchClause.getBlock();
            if (block) {
              const catchBody = block.getText();
              // Empty catch or just throw
              if (catchBody.trim() === '{}' || catchBody.trim() === '{ }') {
                findings.push({
                  file: filePath,
                  severity: "high",
                  title: "Observability: Empty catch block (silent failure)",
                  why: "Error is swallowed silently with no logging. Production issues will be invisible.",
                  fix: "Log the error or re-throw: catch (e) { console.error('[context]', e); throw e; }"
                });
              }
            }
          }
        } catch {
          // Skip if API not available on this node
        }
      }
    });

    return findings;
  }
};

/**
 * Register all quality-related rules with the QA-Intel engine.
 * Includes rules for async/await clarity, dead code detection, naming, timeouts,
 * import ordering, and error observability.
 * @param engine - The QA-Intel engine instance
 */
export function registerQualityRules(engine: unknown) {
  const e = engine as any;
  e.addRule(AsyncWithoutAwaitRule);
  e.addRule(DeadCodeRule);
  e.addRule(VariableNamingRule);
  e.addRule(TimeoutCleanupRule);
  e.addRule(ImportOrderingRule);
  e.addRule(ErrorObservabilityRule);
}
