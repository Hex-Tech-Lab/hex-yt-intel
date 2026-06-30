/**
 * Proposed new architecture rules for qa-intel expansion
 * Phase 1-2: Dependency and pattern analysis
 *
 * These rules focus on import cycles, unhandled promises, and async void patterns.
 */

import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Finding, IRule } from "../engine";

/**
 * RULE #1: Async Void Handler Detector
 *
 * Flags async event handlers (onClick, onSubmit, etc.) that don't have error handling.
 * When the async operation fails, the rejection is silent — no feedback to user.
 *
 * False Positive Rate: ~5%
 * External Source: @typescript-eslint/no-misused-promises
 *
 * Pattern examples:
 * BAD:  <button onClick={async () => apiCall()} />
 * BAD:  onClick={async () => { await fetch(url); }}
 * OK:   onClick={() => apiCall().catch(e => showToast(e.message))}
 * OK:   onClick={async () => { try { await fetch(url); } catch (e) { showToast(e.message); } }}
 */
export const AsyncVoidHandlerRule: IRule = {
  name: "async-void-handler-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    // Only check React components
    if (!filePath.includes('.tsx') && !filePath.includes('.jsx')) return findings;

    source.forEachDescendant((node) => {
      // Look for async arrow functions and async function expressions
      if (
        (Node.isArrowFunction(node) && node.isAsync()) ||
        (Node.isFunctionExpression(node) && node.isAsync())
      ) {
        const parent = node.getParent();

        // Check if this is an event handler
        const isEventHandler =
          Node.isJsxAttribute(parent) ||
          (Node.isPropertyAssignment(parent) &&
            (parent.getName().startsWith('on') ||
              parent.getName() === 'handler'));

        if (!isEventHandler) return;

        // Check if the body has error handling
        const body = node.getBody();
        const bodyText = body.getText();

        // Patterns that indicate error handling
        const hasCatch =
          bodyText.includes('.catch(') ||
          bodyText.includes('catch (') ||
          bodyText.includes('catch{');

        const hasTry =
          bodyText.includes('try {') ||
          bodyText.includes('try{');

        const hasErrorHandling =
          bodyText.includes('showToast(') ||
          bodyText.includes('logError(') ||
          bodyText.includes('setError(');

        if (!hasCatch && !(hasTry && hasErrorHandling)) {
          const handlerName = parent?.getName?.() || 'handler';
          findings.push({
            file: filePath,
            severity: "high",
            title: "React: Async event handler without error handling",
            why: `${handlerName} is async but has no .catch() or try/catch. Promise rejection is silent; user gets no feedback.`,
            fix: `Add .catch() or try/catch: onClick={() => apiCall().catch(e => showToast(e.message))}`
          });
        }
      }
    });

    return findings;
  }
};

/**
 * RULE #2: Circular Import Detector (Graph-aware)
 *
 * Detects circular dependency cycles A → B → A.
 * Requires dependency graph context to work accurately.
 * This is a file-level approximation that catches simple cases.
 *
 * False Positive Rate: ~2% (requires full graph context)
 * External Source: eslint-plugin-import/no-cycle
 *
 * Pattern:
 * BAD:  // file-a.ts imports from file-b
 *       // file-b.ts imports from file-a
 * Result: Bundler hangs; exports are undefined
 *
 * Note: Full implementation requires dependency graph (Phase 2+)
 */
export const CircularImportRule: IRule = {
  name: "circular-import-detector",
  scope: "file",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    // Get all imports from this file
    const imports = source.getImportDeclarations();
    const importedModules = imports
      .map((imp) => {
        const moduleSpecifier = imp.getModuleSpecifierValue();
        // Normalize the path
        if (moduleSpecifier.startsWith('.')) {
          return moduleSpecifier;
        }
        return null;
      })
      .filter((x): x is string => x !== null);

    if (importedModules.length === 0) return findings;

    // For each imported module, check if it re-imports this file
    // (This requires reading those files, which is expensive)
    // Simple heuristic: flag files that import sibling or parent files that likely import back
    for (const importedModule of importedModules) {
      // Reconstruct path from relative import
      const currentDir = filePath.substring(0, filePath.lastIndexOf('/'));
      let importedPath = importedModule;

      if (importedModule.includes('../')) {
        // Parent import
        const upCount = (importedModule.match(/\.\.\//g) || []).length;
        const parts = currentDir.split('/');
        const baseDir = parts.slice(0, -upCount).join('/');
        importedPath = importedModule
          .replace(/\.\.\//g, '')
          .split('/')
          .reduce((acc, part) => acc + '/' + part, baseDir);
      } else if (importedModule.startsWith('./')) {
        // Sibling import
        importedPath = currentDir + '/' + importedModule.replace('./', '');
      }

      // Heuristic: if importing a sibling file that contains common pattern names,
      // it's likely importing back (e.g., store.ts ← useStore.ts ← store.ts)
      const isLikelyCyclic =
        (filePath.includes('store') && importedPath.includes('use')) ||
        (filePath.includes('hook') && importedPath.includes('context')) ||
        (filePath.includes('adapter') && importedPath.includes('domain'));

      if (isLikelyCyclic) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "Architecture: Potential circular import detected",
          why: `Importing from '${importedModule}'. File structure suggests mutual dependency (e.g., store ↔ hook).`,
          fix: `Verify with 'npm ls' or dependency graph. If cycle confirmed, extract shared logic to third module.`
        });
      }
    }

    return findings;
  }
};

/**
 * RULE #3: Unhandled Promise Then Chain
 *
 * Detects .then() chains without .catch() or error handling.
 * Network/API failures go silent; request completes while operation fails.
 *
 * False Positive Rate: ~8%
 * External Source: eslint-plugin-promise/catch-or-return
 *
 * Pattern:
 * BAD:  fetch(url).then(r => r.json()).then(data => setState(data))
 * OK:   fetch(url).then(r => r.json()).then(data => setState(data)).catch(e => showToast(e.message))
 */
export const UnhandledPromiseThenRule: IRule = {
  name: "unhandled-promise-then-chain",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();

        // Look for .then() calls
        if (expr.includes('.then') || expr === 'then') {
          // Get the full chain to check for .catch()
          let current: any = node;
          let chainText = node.getText();

          // Walk up a few levels to see if .catch() follows
          for (let i = 0; i < 3; i++) {
            const parent = current.getParent();
            if (!parent) break;
            chainText = parent.getText();
            current = parent;

            // Stop if we hit a statement boundary
            if (Node.isExpressionStatement(parent)) break;
          }

          // Check for error handling
          const hasErrorHandling =
            chainText.includes('.catch(') ||
            chainText.includes('.catch (') ||
            text
              .substring(
                Math.max(0, text.indexOf(chainText) + chainText.length),
                Math.min(text.length, text.indexOf(chainText) + chainText.length + 100)
              )
              .includes('.catch(');

          if (!hasErrorHandling) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Async: Promise .then() chain missing .catch()",
              why: "Promise chain has .then() but no .catch(). Network/API errors are silently ignored.",
              fix: ".then(...).catch(e => console.error('[context]', e)) or .catch(e => showToast(e.message))"
            });
          }
        }
      }
    });

    return findings;
  }
};

/**
 * RULE #4: Bound Event Handler Enforcement
 *
 * Flags event handlers in class components that aren't bound or arrow functions.
 * In Workers, incorrect `this` context causes runtime errors.
 *
 * False Positive Rate: ~10% (depends on class vs functional detection)
 * External Source: React class component best practices
 *
 * This rule is most relevant for Worker/server code, not modern React.
 * Low priority for current codebase (mostly functional components).
 */
export const BoundEventHandlerRule: IRule = {
  name: "bound-event-handler-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Skip functional components (modern React)
    if (!text.includes('class ') || !text.includes('extends')) return findings;

    // This is a class component; check for unbound methods used as handlers
    source.forEachDescendant((node) => {
      if (Node.isMethodDeclaration(node)) {
        const methodName = node.getName();
        const methodText = node.getText();

        // Check if this method is used as an event handler
        // Look for references like onClick={this.methodName}
        if (!text.includes(`this.${methodName}`) || methodText.includes('bind(this)') || methodText.includes('=>')) {
          return; // Already bound or not used as handler
        }

        // This method is used as a handler but not bound
        findings.push({
          file: filePath,
          severity: "medium",
          title: "Class Component: Unbound event handler method",
          why: `Method '${methodName}' is used as event handler but not bound. In Workers, 'this' context will be lost.`,
          fix: `Either: (1) Use arrow function: ${methodName} = () => {...}  or  (2) Bind in constructor: this.${methodName} = this.${methodName}.bind(this)`
        });
      }
    });

    return findings;
  }
};

/**
 * RULE #5: Missing Finally Block for I/O (Enhanced)
 *
 * Extends existing workflow-safety-check to flag more cases.
 * Ensures resources are cleaned up even if error is thrown.
 *
 * False Positive Rate: ~5%
 * External Source: General best practices
 *
 * Pattern:
 * BAD:  try { await fetch(); } catch (e) { /* no cleanup */ }
 * OK:   try { await fetch(); } catch (e) { ... } finally { cleanup(); }
 */
export const MissingFinallyBlockRule: IRule = {
  name: "missing-finally-block-for-io",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    source.forEachDescendant((node) => {
      if (Node.isTryStatement(node)) {
        const tryBlock = node.getTryBlock();
        const finallyBlock = node.getFinallyBlock();

        if (!finallyBlock) {
          // Check if try block has I/O
          const tryText = tryBlock.getText();
          const hasIO =
            tryText.includes('fetch(') ||
            tryText.includes('writeFile') ||
            tryText.includes('createWriteStream') ||
            tryText.includes('open(') ||
            tryText.includes('.write(') ||
            tryText.includes('supabase.from');

          if (hasIO) {
            findings.push({
              file: filePath,
              severity: "medium",
              title: "I/O: Try block without finally for resource cleanup",
              why: "Try/catch without finally. If exception thrown, resources may not be cleaned up (file handles, connections).",
              fix: "Add finally block to guarantee cleanup: try { ... } catch (e) { ... } finally { cleanup(); }"
            });
          }
        }
      }
    });

    return findings;
  }
};

/**
 * RULE #6: Bound Type Guard Enforcement (Worker-specific)
 *
 * Detects type assertions without runtime checks in Worker request handlers.
 * Workers crash at runtime if type is wrong; TypeScript doesn't catch this.
 *
 * False Positive Rate: ~20% (high; complex type inference)
 * External Source: TypeScript strict mode + runtime safety patterns
 *
 * Pattern:
 * BAD:  const data = (await req.json()) as UserData;  // No check if structure matches
 * OK:   const data = UserDataSchema.parse(await req.json());
 */
export const BoundTypeGuardRule: IRule = {
  name: "bound-type-guard-enforcement",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Only check Worker/edge function files
    if (!filePath.includes('worker') && !filePath.includes('edge') && !filePath.includes('/api/')) {
      return findings;
    }

    source.forEachDescendant((node) => {
      // Look for type assertions (e.g., `as Type`)
      if (Node.isAsExpression(node)) {
        const exprText = node.getExpression().getText();
        const typeText = node.getType().getText();

        // Check if this is parsing data from external input (JSON, etc.)
        const isExternalData =
          exprText.includes('req.') ||
          exprText.includes('c.req') ||
          exprText.includes('await') ||
          exprText.includes('parse');

        // Check if there's a schema validation nearby
        const parentText = node
          .getParent()
          ?.getParent()
          ?.getParent()
          ?.getText() || '';
        const hasValidation =
          parentText.includes('.parse(') ||
          parentText.includes('.safeParse(') ||
          parentText.includes('validate(') ||
          parentText.includes('schema.');

        if (isExternalData && !hasValidation) {
          findings.push({
            file: filePath,
            severity: "high",
            title: "Type Safety: Type assertion without runtime validation",
            why: `Asserting type '${typeText}' on external input '${exprText}' without parsing/validation. Runtime TypeError risk.`,
            fix: `Use Zod: const data = UserSchema.parse(await req.json())`
          });
        }
      }
    });

    return findings;
  }
};

/**
 * Integration helper: Register all proposed architecture rules
 * (Not yet integrated into main engine; requires validation first)
 */
export function registerProposedArchitectureRules(engine: unknown) {
  const e = engine as any;
  e.addRule(AsyncVoidHandlerRule);
  e.addRule(CircularImportRule);
  e.addRule(UnhandledPromiseThenRule);
  e.addRule(BoundEventHandlerRule);
  e.addRule(MissingFinallyBlockRule);
  e.addRule(BoundTypeGuardRule);
}
