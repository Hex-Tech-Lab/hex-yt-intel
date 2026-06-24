/**
 * SmellyCode++ Calibration Runner — abstract metric testing harness.
 *
 * Evaluates the quality engine's rules against the SmellyCode++ numerical
 * feature corpus (107,554 examples). This is strictly language-agnostic:
 * it tests cyclomatic complexity thresholds, LOC boundaries, operand/operator
 * density, and other abstract code metrics — NOT Java syntax.
 *
 * The dataset is OPTIONAL and LOCAL-ONLY. If the CSV is not present, the
 * runner emits a warning and exits cleanly (exit 0).
 *
 * Usage:
 *   bash scripts/quality-engine/calibration/fetch-smellycode.sh   # one-time
 *   pnpm dlx tsx scripts/quality-engine/calibration/run-smellycode-calibration.ts
 */
import { Project } from "ts-morph";
import { QualityEngine } from "../application/QualityEngine";
import { TsMorphLoader } from "../infra/TsMorphLoader";
import { CacheAdapter } from "../infra/CacheAdapter";
import { createCache } from "../cache";
import { wrapLegacyRule, type LegacyIRule } from "../infra/LegacyRuleAdapter";
import * as legacyRules from "../rules";
import { SmellyCodeIngester } from "./SmellyCodeIngester";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const SAMPLE_SIZE = 500; // Cap at 500 for local runs; use 0 for full corpus
const DATA_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "data",
  "multi-smell-dataset-v1_2.csv"
);

async function main() {
  console.log("=== qa-intel: SmellyCode++ Calibration Runner ===");
  console.log(`Dataset path: ${DATA_FILE}`);

  if (!fs.existsSync(DATA_FILE)) {
    console.warn("[SmellyCode++] Dataset not found — this is optional and local-only.");
    console.warn("[SmellyCode++] Run `bash scripts/quality-engine/calibration/fetch-smellycode.sh` to download.");
    console.log("=== SmellyCode++ Calibration: SKIPPED (no dataset) ===");
    process.exit(0);
  }

  // 1. Parse CSV via streaming (avoids Node 512MB string limit on 590MB file)
  const ingester = new SmellyCodeIngester();
  // Parse only enough for the sample to keep memory lean; full corpus count separately
  const parseTarget = SAMPLE_SIZE > 0 ? SAMPLE_SIZE + 50 : 0;
  const examples = await ingester.loadFromCsv(DATA_FILE, parseTarget);
  if (examples.length === 0) {
    console.warn("[SmellyCode++] No examples parsed from dataset.");
    process.exit(0);
  }
  console.log(`Loaded ${examples.length.toLocaleString()} SmellyCode++ examples.`);

  // 2. Abstract metric threshold evaluation (language-agnostic)
  const thresholds = ingester.evaluateMetricThresholds(examples);
  console.log("\n--- Abstract Metric Threshold Report ---");
  console.log(`High cyclomatic complexity (>10):  ${thresholds.highComplexity.toLocaleString()}`);
  console.log(`Long method (>100 LOC):            ${thresholds.longMethod.toLocaleString()}`);
  console.log(`Many parameters (>30 operands):    ${thresholds.manyParams.toLocaleString()}`);

  // 3. Sample subset for engine calibration
  const sample = ingester.toCalibrationExamples(SAMPLE_SIZE || undefined);
  console.log(`\nCalibration sample: ${sample.length} examples (${examples.length - sample.length} held back).`);

  // 4. Run quality engine over the sample
  const project = new Project({ useInMemoryFileSystem: true });
  const loader = new TsMorphLoader(project);
  const rules = Object.values(legacyRules)
    .filter((r): r is any => r && typeof r === "object" && "check" in r && "name" in r)
    .map((legacyRule) => {
      return wrapLegacyRule(legacyRule as unknown as LegacyIRule);
    });
  const cache = new CacheAdapter(createCache(false));
  const fileSystem: import("../infra/NodeFileSystem").NodeFileSystem = {
    exists: () => true,
    resolve: (p: string) => p,
  } as unknown as import("../infra/NodeFileSystem").NodeFileSystem;

  const engine = new QualityEngine(rules, loader, cache, fileSystem, {
    mode: "full",
    defaultScope: "file",
  });

  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const cal of sample) {
    await loader.loadFromText(cal.filePath, cal.codeSnippet);
    const findings = await engine.analyze([cal.filePath]);

    const hasFindings = findings.length > 0;
    if (cal.expectedOutcome === "finding") {
      if (hasFindings) tp++; else fn++;
    } else {
      if (!hasFindings) tn++; else fp++;
    }
  }

  // 5. Scoreboard
  const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
  const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;

  console.log("\n=== SmellyCode++ Calibration Scoreboard ===");
  console.log(`True Positives (TP):  ${tp}`);
  console.log(`False Positives (FP): ${fp}`);
  console.log(`True Negatives (TN):  ${tn}`);
  console.log(`False Negatives (FN): ${fn}`);
  console.log(`Precision:            ${precision.toFixed(1)}%`);
  console.log(`Recall:               ${recall.toFixed(1)}%`);
  console.log(`Sample size:          ${sample.length}`);

  // 6. Write report
  const outputPath = path.resolve(process.cwd(), ".qa-intel/smellycode-calibration.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    dataset: "SmellyCode++ v1.2",
    source: "Alomari et al. (2025) figshare 10.6084/m9.figshare.28519385.v1",
    license: "CC0 1.0 Universal",
    totalExamples: examples.length,
    thresholds,
    metrics: { tp, fp, tn, fn, precision, recall },
  }, null, 2));
  console.log(`\nCalibration report written to: ${outputPath}`);
}

main().catch(err => {
  console.error('[smellycode-calibration]', { error: err instanceof Error ? err.message : String(err), phase: 'smellycode-calibration' });
  process.exit(1);
});