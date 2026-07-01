import { Project } from "ts-morph";
import { QualityEngine } from "../application/QualityEngine";
import { TsMorphLoader } from "../infra/TsMorphLoader";
import { NodeFileSystem } from "../infra/NodeFileSystem";
import { CacheAdapter } from "../infra/CacheAdapter";
import { createCache } from "../cache";
import { wrapLegacyRule, type LegacyIRule } from "../infra/LegacyRuleAdapter";
import type { FileSystemPort } from "../application/ports/FileSystemPort";
import type { Rule } from "../domain/Rule";
import * as legacyRules from "../rules";
import { SardCalibrationIngester } from "./SardCalibrationIngester";
import type { CalibrationExample, CalibrationResult } from "./types";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("=== qa-intel: Calibration Runner ===");
  
  // 1. Initialize SARD/Juliet examples
  const ingester = new SardCalibrationIngester();
  const examples = ingester.ingestExamples();
  console.log(`Loaded ${examples.length} SARD/Juliet reference examples.`);

  // 2. Prepare ts-morph dynamic sandbox
  const project = new Project({ useInMemoryFileSystem: true });
  const loader = new TsMorphLoader(project);
  
  // 3. Load active rules (handle both legacy IRule and new Rule formats)
  const rules: Rule[] = Object.values(legacyRules)
    .filter((r): r is any => r && typeof r === "object" && "check" in r && "name" in r)
    .map((rule) => {
      // Detect new Rule format explicitly (same heuristic as verify-quality-engine.ts):
      // a `scope` property, or a check body that consumes the RuleContext (ctx.ast/ctx.filePath).
      // Arity is unreliable — some legacy IRule checks also declare a single parameter,
      // which would misclassify them and pass a RuleContext where a SourceFile is expected.
      const isNewRule =
        (rule as { scope?: unknown }).scope !== undefined ||
        (typeof rule.check === "function" &&
          (rule.check.toString().includes("ctx.ast") ||
            rule.check.toString().includes("ctx.filePath")));
      if (isNewRule) {
        return rule as Rule;
      }
      // Legacy IRule format — wrap so it receives a SourceFile.
      return wrapLegacyRule(rule as unknown as LegacyIRule);
    });
  
  const cache = new CacheAdapter(createCache(false));
  const fileSystem: FileSystemPort = {
    exists: (p: string) => true,
    resolve: (p: string) => p,
  };
  
  // Instantiate QualityEngine
  const engine = new QualityEngine(rules, loader, cache, fileSystem, {
    mode: "full",
    defaultScope: "file"
  });

  const results: CalibrationResult[] = [];
  let tp = 0; // True Positives (Found issue in bad example)
  let fp = 0; // False Positives (Found issue in clean example)
  let tn = 0; // True Negatives (Clean example stayed clean)
  let fn = 0; // False Negatives (Missed issue in bad example)

  // 4. Run rules over each source example
  for (const example of examples) {
    // Load virtual file into project context
    await loader.loadFromText(example.filePath, example.codeSnippet);
    
    // Analyze using the engine
    const findings = await engine.analyze([example.filePath]);
    
    const hasFindings = findings.length > 0;
    const expected = example.expectedOutcome;
    
    let passed = false;
    if (expected === "finding") {
      if (hasFindings) {
        tp++;
        passed = true;
      } else {
        fn++;
      }
    } else {
      if (!hasFindings) {
        tn++;
        passed = true;
      } else {
        fp++;
      }
    }

    results.push({
      example,
      passed,
      actualFindings: findings.length
    });

    console.log(`- [${example.externalId}] [Expected: ${expected}] -> Actual Findings: ${findings.length} (${passed ? "PASS" : "FAIL"})`);
    if (!passed && findings.length > 0) {
      console.log(`  Findings: ${JSON.stringify(findings.map(f => f.title))}`);
    }
  }

  // 5. Calculate Metrics
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;
  
  console.log("\n=== Calibration Scoreboard ===");
  console.log(`True Positives (TP):  ${tp}`);
  console.log(`False Positives (FP): ${fp}`);
  console.log(`True Negatives (TN):  ${tn}`);
  console.log(`False Negatives (FN): ${fn}`);
  console.log(`Precision:            ${precision.toFixed(1)}%`);
  console.log(`Recall:               ${recall.toFixed(1)}%`);

  // Write calibration artifact to output
  const outputPath = path.resolve(process.cwd(), ".qa-intel/calibration-results.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    metrics: { tp, fp, tn, fn, precision, recall },
    results
  }, null, 2));
  console.log(`\nCalibration results written to: ${outputPath}`);
}

main().catch(err => {
  console.error('[calibration]', { error: err instanceof Error ? err.message : String(err), phase: 'sard-calibration' });
  process.exit(1);
});
