import { Node, SyntaxKind, SourceFile } from "ts-morph";
import { Finding, IRule } from "../engine";

// 1. Hexagonal Boundary Rule
export const HexagonalBoundaryRule: IRule = {
  name: "hexagonal-boundary-enforcer",
  check: (source) => {
    const findings: Finding[] = [];
    const isAdapter = source.getFilePath().includes("/adapters/");
    
    if (!isAdapter) {
      source.forEachDescendant((node) => {
        if (Node.isCallExpression(node) && node.getExpression().getText().includes("getSupabaseClient")) {
          findings.push({
            file: source.getFilePath(),
            severity: "critical",
            title: "Boundary Violation: Direct Supabase Access",
            why: "Direct DB access outside of /adapters/ violates Hexagonal Lite architecture.",
            fix: "Move this logic into a dedicated Adapter port."
          });
        }
      });
    }
    return findings;
  }
};

// 2. Security Rule
export const CredentialLeakRule: IRule = {
    name: "credential-leak-detector",
    check: (source) => {
      const findings: Finding[] = [];
      const FORBIDDEN_IDS = ['test-user-id', 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb'];
      
      source.forEachDescendant((node) => {
        if (Node.isStringLiteral(node) && FORBIDDEN_IDS.includes(node.getLiteralText())) {
          findings.push({
            file: source.getFilePath(),
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

// 3. Workflow Rule
export const WorkflowRule: IRule = {
    name: "workflow-safety-check",
    check: (source) => {
      const findings: Finding[] = [];
      
      source.forEachDescendant((node) => {
        // Detect risky operations (I/O, network)
        if (Node.isCallExpression(node) && /fetch|writeFile|exec/i.test(node.getExpression().getText())) {
          const parentBlock = node.getParentIfKind(SyntaxKind.Block);
          if (parentBlock && !parentBlock.getText().includes('finally')) {
             findings.push({
                file: source.getFilePath(),
                severity: "medium",
                title: "Workflow: Missing finally/cleanup",
                why: "Risky I/O call without finally block detected.",
                fix: "Wrap in finally block or structured cleanup to prevent resource leaks."
              });
          }
        }
      });
      return findings;
    }
};

// 4. Complexity Rule
export const ComplexityRule: IRule = {
    name: "complexity-monitor",
    check: (source) => {
      const findings: Finding[] = [];
      const lines = source.getText().split('\n').length;
      if (lines > 500) {
        findings.push({
            file: source.getFilePath(),
            severity: "medium",
            title: "Complexity: Monolithic File",
            why: `File exceeds 500 lines (${lines} lines).`,
            fix: "Decompose into smaller, domain-specific modules."
        });
      }
      return findings;
    }
};
