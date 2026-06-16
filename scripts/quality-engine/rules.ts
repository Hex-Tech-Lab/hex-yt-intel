import { Node, SyntaxKind, SourceFile } from "ts-morph";
import { Finding, IRule } from "./engine";

// 1. Hexagonal Boundary Rule
export const HexagonalBoundaryRule: IRule = {
  name: "hexagonal-boundary-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const isAdapter = filePath.includes("/adapters/");
    
    if (!isAdapter) {
      source.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
          const expression = node.getExpression();
          const text = expression.getText();
          if (text === "getSupabaseClient" || text.endsWith(".getSupabaseClient")) {
            findings.push({
              file: filePath,
              severity: "critical",
              title: "Boundary Violation: Direct Supabase Access",
              why: "Direct DB access outside of /adapters/ violates Hexagonal Lite architecture.",
              fix: "Move this logic into a dedicated Adapter port."
            });
          }
        }
      });
    }
    return findings;
  }
};

// 2. Security Rule
export const CredentialLeakRule: IRule = {
    name: "credential-leak-detector",
    check: (source: SourceFile) => {
      const findings: Finding[] = [];
      const filePath = source.getFilePath().replace(/\\/g, "/");
      const FORBIDDEN_IDS = ['test-user-id', 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb'];
      
      source.forEachDescendant((node) => {
        if (Node.isStringLiteral(node) && FORBIDDEN_IDS.includes(node.getLiteralText())) {
          findings.push({
            file: filePath,
            severity: "critical",
            title: "Security: Hardcoded Sensitive ID",
            why: "Hardcoded test/admin IDs detected in source code.",
            fix: "Use environment-based feature flags (e.g., process.env.TEST_USER_BYPASS_ID)."
          });
        }
      });
      return findings;
    }
};

// 3. Workflow Rule (Robust AST check, no loose promises)
export const WorkflowRule: IRule = {
  name: "workflow-safety-check",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    
    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        const text = expr.getText();
        
        // Robust name checking instead of generic regex
        const isIOCall = ["fetch", "writeFile", "exec", "execSync"].some(name => 
           text === name || text.endsWith(`.${name}`)
        );

        if (isIOCall) {
          // 1. Check for try/finally
          const tryStatement = node.getFirstAncestorByKind(SyntaxKind.TryStatement);
          const hasFinally = tryStatement?.getFinallyBlock();

          if (!hasFinally) {
            findings.push({
              file: filePath,
              severity: "medium",
              title: "Workflow: Missing finally block for I/O",
              why: `Risky I/O call '${text}' detected without an explicit finally block.`,
              fix: "Ensure all I/O operations are wrapped in a try/finally block to guarantee resource cleanup."
            });
          }

          // 2. Check for loose promises (unawaited async calls)
          const type = node.getType();
          if (type.getText().includes("Promise") || type.getSymbol()?.getName() === "Promise") {
             const parent = node.getParent();
             if (parent && !Node.isAwaitExpression(parent) && !Node.isReturnStatement(parent) && !Node.isYieldExpression(parent)) {
                // If it's a statement by itself or part of an expression that isn't awaiting it
                if (Node.isExpressionStatement(parent)) {
                   findings.push({
                     file: filePath,
                     severity: "high",
                     title: "Workflow: Unawaited Promise",
                     why: `Loose unawaited promise detected for I/O call '${text}'.`,
                     fix: "Await the promise or explicitly handle it to avoid race conditions or floating promises."
                   });
                }
             }
          }
        }
      }
    });
    return findings;
  }
};

// 4. Complexity Rule
export const ComplexityRule: IRule = {
    name: "complexity-monitor",
    check: (source: SourceFile) => {
      const findings: Finding[] = [];
      const filePath = source.getFilePath().replace(/\\/g, "/");
      const lines = source.getText().split('\n').length;
      if (lines > 500) {
        findings.push({
            file: filePath,
            severity: "medium",
            title: "Complexity: Monolithic File",
            why: `File exceeds 500 lines (${lines} lines).`,
            fix: "Decompose into smaller, domain-specific modules."
        });
      }
      return findings;
    }
};