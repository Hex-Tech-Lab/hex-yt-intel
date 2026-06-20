import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Finding, IRule } from "../engine";

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

export const ComplexityRule: IRule = {
    name: "complexity-monitor",
    check: (source: SourceFile) => {
      const findings: Finding[] = [];
      const filePath = source.getFilePath().replace(/\\/g, "/");
      const lines = source.getText().split(/\r?\n/).length;
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

export const ErrorTaxonomyRule: IRule = {
  name: "error-taxonomy-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    source.forEachDescendant((node) => {
      if (Node.isIfStatement(node)) {
        const condition = node.getExpression().getText();
        if (condition.includes('error') && (condition.includes('!data') || condition.includes('!result'))) {
          const block = node.getThenStatement()?.getText() || '';
          if (block.includes('NotFound')) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Error Taxonomy: DB errors collapsed into NotFound",
              why: "Database/query errors are returned as NotFound, hiding real failures as missing resources.",
              fix: "Separate error cases: return 'InternalError' (-> 500) for query failures, 'NotFound' (-> 404) only when no rows match."
            });
          }
        }
      }
    });
    return findings;
  }
};

export const CrossPlatformRule: IRule = {
  name: "cross-platform-compatibility",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    const lfSplitMatches = text.match(/\.split\(['"]\\n['"]\)/g);
    if (lfSplitMatches) {
      findings.push({
        file: filePath,
        severity: "medium",
        title: "Cross-Platform: LF-only string splitting",
        why: `${lfSplitMatches.length} instance(s) of .split('\\n') detected. CRLF line endings (Windows) will not be handled.`,
        fix: "Replace .split('\\n') with .split(/\\r?\\n/) for cross-platform compatibility."
      });
    }
    return findings;
  }
};

export const SchemaContractRule: IRule = {
  name: "schema-contract-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('.refine(')) {
      const refineChains = text.match(/\.\w+\([^)]*\)\.refine\(/g) || [];
      const hasOptionalBeforeRefine = refineChains.some(chain => {
        const fieldStart = text.indexOf(chain);
        const fieldSegment = text.substring(Math.max(0, fieldStart - 200), fieldStart);
        return fieldSegment.includes('.optional()');
      });
      if (refineChains.length > 0 && !hasOptionalBeforeRefine && text.includes('z.object({')) {
        findings.push({
          file: filePath,
          severity: "critical",
          title: "Schema: Refinement on required field may reject valid requests",
          why: "z.refine() used without .optional() on the chained field. If a caller doesn't send this field, the entire request is rejected with 400.",
          fix: "Add .optional() before .refine() if the field isn't guaranteed from all call paths: .refine(...).optional()"
        });
      }
    }
    return findings;
  }
};

export const RedundantValidationRule: IRule = {
  name: "redundant-validation-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('.min(') && text.includes('.max(') && text.includes('z.object({')) {
      const hasManualRange = text.match(/if\s*\([^)]*(?:<|>)\s*\d+[^)]*\)/g);
      const zodMin = text.match(/\.min\(\d+\)/g);
      if (hasManualRange && zodMin) {
        findings.push({
          file: filePath,
          severity: "medium",
          title: "Validation: Manual range check duplicates Zod schema",
          why: "Zod already enforces .min()/.max() bounds. Manual if-check after schema parse is redundant and can drift.",
          fix: "Remove manual range validation after schema.safeParse() — Zod handles it. Keep only post-parse semantic checks."
        });
      }
    }
    return findings;
  }
};

export const WorkflowRule: IRule = {
  name: "workflow-safety-check",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        const text = expr.getText();

        const isIOCall = ["fetch", "writeFile", "exec", "execSync"].some(name =>
           text === name || text.endsWith(`.${name}`)
        );

        if (isIOCall) {
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

          const type = node.getType();
          if (type.getText().includes("Promise") || type.getSymbol()?.getName() === "Promise") {
             const parent = node.getParent();
             if (parent && !Node.isAwaitExpression(parent) && !Node.isReturnStatement(parent) && !Node.isYieldExpression(parent)) {
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

export const TranscriptUnsafeAccessRule: IRule = {
  name: "transcript-unsafe-access",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    if (!filePath.includes('Transcript') && !filePath.includes('transcript')) return findings;

    const text = source.getText();
    const deepChains = text.match(/results\[0\]\.\w+\.\w+\.\w+/g) || [];
    if (deepChains.length > 0) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Transcript: Unsafe deep property chain access",
        why: "results[0].content.auto_generated.en.events — any intermediate can be undefined. Causes TypeError on unexpected API shapes.",
        fix: "Use optional chaining: results?.[0]?.content?.auto_generated?.[lang]?.events ?? fallback"
      });
    }
    return findings;
  }
};

export const HardcodedDomainLogicRule: IRule = {
  name: "hardcoded-domain-logic",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    const hardcodedPersonas = text.match(/['"]?(?:detailed|balanced|brief|academic|casual)['"]?\s*[,:]\s*['"]?(?:detailed|balanced|brief|academic|casual)['"]?/g);
    if (hardcodedPersonas && filePath.includes('persona')) {
      findings.push({
        file: filePath,
        severity: "medium",
        title: "Domain: Hardcoded persona list may drift from actual personas",
        why: "isValidPersona() uses a hardcoded array. When new personas are added to UCI PersonaConfig, this must be manually updated.",
        fix: "Import persona list from UCI PersonaConfig or derive from a shared constant."
      });
    }
    return findings;
  }
};

export const StateSyncRule: IRule = {
  name: "state-sync-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('setUrl') && (filePath.includes('store') || filePath.includes('Store'))) {
      const hasSetIsValid = text.includes('setIsValid') || text.includes('isValid:');
      if (!hasSetIsValid) {
        findings.push({
          file: filePath,
          severity: "medium",
          title: "State: setUrl doesn't sync isValid state",
          why: "setUrl() updates URL string but doesn't update isValid. Derived state drifts from source state.",
          fix: "Derive isValid from url inside the store, or call setIsValid in the same setter."
        });
      }
    }
    return findings;
  }
};

export const CanvasStaleDataRule: IRule = {
  name: "canvas-stale-data-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if ((text.includes('d3.') || text.includes('canvas') || text.includes('ForceGraph')) && text.includes('useEffect')) {
      const effectBlocks = text.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[[\s\S]*?\]\)/g) || [];
      for (const block of effectBlocks) {
        const hasGraphData = block.includes('graphData') || block.includes('nodes') || block.includes('words') || block.includes('data');
        if (!hasGraphData && (block.includes('d3.') || block.includes('canvas'))) {
          findings.push({
            file: filePath,
            severity: "high",
            title: "Canvas: d3/canvas render effect missing data dependency",
            why: "useEffect renders d3 visualization but dependency array doesn't include the data variable.",
            fix: "Add graphData/nodes/words to the useEffect dependency array."
          });
          break;
        }
      }
    }
    return findings;
  }
};

export const GraphAwareBoundaryRule: IRule = {
  name: "graph-aware-boundary",
  scope: "graph" as any,
  check: (source: SourceFile, ctx?: any) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    
    // Graph boundary checks: only run on domain/usecases files to ensure they don't depend on raw infrastructure
    if (!filePath.includes('/domain/') && !filePath.includes('/usecases/')) {
      return findings;
    }

    const graph = ctx?.graph;
    if (!graph) return findings;

    const node = graph.get(filePath);
    if (!node) return findings;

    for (const imp of node.imports) {
      if (imp.includes("/adapters/") && (imp.includes("supabase") || imp.includes("db") || imp.includes("postgres"))) {
        findings.push({
          file: filePath,
          severity: "critical",
          title: "Boundary Violation: Domain relies on DB infrastructure in dependency graph",
          why: `Domain layer file ${filePath} has a direct dependency on adapter file ${imp}.`,
          fix: "Decouple domain from concrete adapters. Put adapter behind a port interface."
        });
      }
    }

    return findings;
  }
};

export function registerArchitectureRules(engine: unknown) {
  const e = engine as any;
  e.addRule(HexagonalBoundaryRule);
  e.addRule(ComplexityRule);
  e.addRule(ErrorTaxonomyRule);
  e.addRule(CrossPlatformRule);
  e.addRule(SchemaContractRule);
  e.addRule(RedundantValidationRule);
  e.addRule(WorkflowRule);
  e.addRule(TranscriptUnsafeAccessRule);
  e.addRule(HardcodedDomainLogicRule);
  e.addRule(StateSyncRule);
  e.addRule(CanvasStaleDataRule);
  e.addRule(GraphAwareBoundaryRule);
}