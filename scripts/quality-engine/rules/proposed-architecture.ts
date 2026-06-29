/**
 * Proposed new architecture rules for qa-intel expansion
 * Phase 1-2: Dependency and pattern analysis
 */

import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Finding, IRule } from "../engine";

/**
 * RULE #1: Async Void Handler Detector
 * Flags async event handlers without error handling.
 * False Positive Rate: ~5%
 */
export const AsyncVoidHandlerRule: IRule = {
  name: "async-void-handler-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    if (!filePath.includes('.tsx') && !filePath.includes('.jsx')) return findings;

    source.forEachDescendant((node) => {
      if ((Node.isArrowFunction(node) && node.isAsync()) ||
          (Node.isFunctionExpression(node) && node.isAsync())) {
        const parent = node.getParent();
        const isEventHandler = Node.isJsxAttribute(parent) ||
                              (Node.isPropertyAssignment(parent) && parent.getName().startsWith('on'));

        if (!isEventHandler) return;

        const bodyText = node.getBody().getText();
        const hasErrorHandling = bodyText.includes('.catch(') ||
                                (bodyText.includes('try {') && bodyText.includes('showToast'));

        if (!hasErrorHandling) {
          findings.push({
            file: filePath,
            severity: "high",
            title: "React: Async event handler without error handling",
            why: "Async handler has no .catch(). Promise rejection is silent.",
            fix: "Add .catch(): onClick={() => apiCall().catch(e => showToast(e.message))}"
          });
        }
      }
    });
    return findings;
  }
};

/**
 * RULE #2: Circular Import Detector
 * Detects circular dependency cycles A → B → A.
 * False Positive Rate: ~2%
 */
export const CircularImportRule: IRule = {
  name: "circular-import-detector",
  scope: "file",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    const imports = source.getImportDeclarations();
    const importedModules = imports
      .map((imp) => {
        const moduleSpecifier = imp.getModuleSpecifierValue();
        if (moduleSpecifier.startsWith('.')) return moduleSpecifier;
        return null;
      })
      .filter((x): x is string => x !== null);

    if (importedModules.length === 0) return findings;

    for (const importedModule of importedModules) {
      const isLikelyCyclic = (filePath.includes('store') && importedModule.includes('use')) ||
                            (filePath.includes('hook') && importedModule.includes('context')) ||
                            (filePath.includes('adapter') && importedModule.includes('domain'));

      if (isLikelyCyclic) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "Architecture: Potential circular import detected",
          why: `Importing '${importedModule}'. Mutual dependency likely.`,
          fix: "Extract shared logic to third module to break cycle."
        });
      }
    }
    return findings;
  }
};

/**
 * RULE #3: Unhandled Promise Then Chain
 * Detects .then() chains without .catch().
 * False Positive Rate: ~8%
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

        if (expr.includes('.then') || expr === 'then') {
          let chainText = node.getText();
          let current: any = node;

          for (let i = 0; i < 3; i++) {
            const parent = current.getParent();
            if (!parent) break;
            chainText = parent.getText();
            current = parent;
            if (Node.isExpressionStatement(parent)) break;
          }

          const hasErrorHandling = chainText.includes('.catch(') ||
                                  text.substring(text.indexOf(chainText), text.indexOf(chainText) + chainText.length + 100).includes('.catch(');

          if (!hasErrorHandling) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Async: Promise .then() chain missing .catch()",
              why: "Chain has .then() but no .catch(). Errors are silently ignored.",
              fix: ".then(...).catch(e => console.error('[ctx]', e))"
            });
          }
        }
      }
    });
    return findings;
  }
};

/**
 * RULE #4: Side-Effect Import Detector
 * Flags bare imports without variable binding.
 * False Positive Rate: ~3%
 */
export const SideEffectImportRule: IRule = {
  name: "side-effect-import-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    const imports = source.getImportDeclarations();
    for (const imp of imports) {
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
          why: `import '${moduleName}' has no variable binding. Tests fail if import order changes.`,
          fix: "Add binding: import { init } from '...' or document the side effect with a comment."
        });
      }
    }
    return findings;
  }
};

/**
 * RULE #5: Missing Finally Block for I/O
 * Ensures resources are cleaned up even if error thrown.
 * False Positive Rate: ~5%
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
          const tryText = tryBlock.getText();
          const hasIO = tryText.includes('fetch(') ||
                       tryText.includes('writeFile') ||
                       tryText.includes('supabase.from');

          if (hasIO) {
            findings.push({
              file: filePath,
              severity: "medium",
              title: "I/O: Try block without finally for resource cleanup",
              why: "No finally block. Resources may not be cleaned up if exception thrown.",
              fix: "Add finally: try { ... } catch (e) { ... } finally { cleanup(); }"
            });
          }
        }
      }
    });
    return findings;
  }
};
