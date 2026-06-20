import { QualityIntelligenceEngine } from "./quality-engine/engine";
import { SecurityRuleEngine } from "./quality-engine/rules/SecurityRuleEngine";
import { StreamingRuleEngine } from "./quality-engine/rules/StreamingRuleEngine";
import { UIRuleEngine } from "./quality-engine/rules/UIRuleEngine";
import { ArchitectureRuleEngine } from "./quality-engine/rules/ArchitectureRuleEngine";
import { PersistenceRuleEngine } from "./quality-engine/rules/PersistenceRuleEngine";
import * as glob from "glob";
import { createCache } from "./quality-engine/cache";

const engine = new QualityIntelligenceEngine(process.cwd());

// Register rule subagents
const securityAgent = new SecurityRuleEngine();
securityAgent.registerRules(engine);
const streamingAgent = new StreamingRuleEngine();
streamingAgent.registerRules(engine);
const uiAgent = new UIRuleEngine();
uiAgent.registerRules(engine);
const architectureAgent = new ArchitectureRuleEngine();
architectureAgent.registerRules(engine);
const persistenceAgent = new PersistenceRuleEngine();
persistenceAgent.registerRules(engine);

// CLI flags
const args = process.argv.slice(2);
const flags: Record<string, boolean | string> = {};
let currentFlag: string | null = null;
for (const arg of args) {
  if (arg.startsWith("--")) {
    const flag = arg.slice(2);
    if (flag.includes("=")) {
      const [key, value] = flag.split("=");
      flags[key] = value;
    } else {
      flags[flag] = true;
      currentFlag = flag;
    }
  } else if (currentFlag) {
    flags[currentFlag] = arg;
    currentFlag = null;
  }
}

const mode: "diff" | "full" | "watch" = (flags.mode as "diff" | "full" | "watch") ?? "diff";
const baseline = flags.baseline === true || flags.baseline === "true";
const compare = flags.compare === true || flags.compare === "true";
const ci = flags.ci === true || flags.ci === "true" || process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const useRedisCache = (flags["use-redis-cache"] === true || flags["use-redis-cache"] === "true") && !ci;
const persistCache = flags["persist-cache"] === true || flags["persist-cache"] === "true";

// Initialize cache
const cache = createCache(useRedisCache);

// Get file list based on mode
let fileList: string[] = [];
if (mode === "watch") {
  // For simplicity, fall back to full scan; watch mode would need fs.watch (out of scope for this script)
  console.warn("Watch mode not implemented in CLI; using full scan");
}
if (mode === "full" || mode === "watch") {
  fileList = glob.sync("{web,worker}/**/*.{ts,tsx}", { ignore: "**/node_modules/**" }).map(f => f.replace(/\\/g, "/"));
} else if (mode === "diff") {
  // Get changed files via git diff
  const { execSync } = require("child_process");
  try {
    const diffOutput = execSync("git diff --name-only --diff-filter=ACM HEAD", { encoding: "utf8" });
    fileList = diffOutput
      .split("\n")
      .filter(line => line.trim().endsWith(".ts") || line.trim().endsWith(".tsx"))
      .map(f => f.trim())
      .filter(f => f.length > 0);
    if (fileList.length === 0) {
      console.log("No changed TS/TSX files; falling back to full scan");
      fileList = glob.sync("{web,worker}/**/*.{ts,tsx}", { ignore: "**/node_modules/**" }).map(f => f.replace(/\\/g, "/"));
    }
  } catch (e) {
    console.warn("Git diff failed, falling back to full scan:", e.message);
    fileList = glob.sync("{web,worker}/**/*.{ts,tsx}", { ignore: "**/node_modules/**" }).map(f => f.replace(/\\/g, "/"));
  }
}

// Ensure files exist
fileList = fileList.filter(f => require("fs").existsSync(require("path").resolve(process.cwd(), f)));

if (fileList.length === 0) {
  console.error("❌ Quality Intelligence Engine: No files found to scan.");
  process.exit(1);
}

// Run analysis
const findings = engine.analyze(fileList, { cache });

// Handle baseline
const baselinePath = require("path").resolve(process.cwd(), ".qa-intel/baseline.json");
if (baseline) {
  require("fs").mkdirSync(require("path").dirname(baselinePath), { recursive: true });
  require("fs").writeFileSync(baselinePath, JSON.stringify(findings, null, 2));
  console.log(`✅ Baseline written to ${baselinePath}`);
  process.exit(0);
}
if (compare) {
  if (!require("fs").existsSync(baselinePath)) {
    console.error("❌ No baseline found. Run with --baseline first.");
    process.exit(1);
  }
  const baselineFindings: any[] = JSON.parse(require("fs").readFileSync(baselinePath, "utf8"));
  // Simple diff: new findings not in baseline (by file+title)
  const baselineSet = new Set(baselineFindings.map(f => `${f.file}:${f.title}`));
  const newFindings = findings.filter(f => !baselineSet.has(`${f.file}:${f.title}`));
  if (newFindings.length > 0) {
    console.error("⚠️ Quality Intelligence Engine: New/changed issues found:");
    console.error(JSON.stringify(newFindings, null, 2));
    process.exit(1);
  } else {
    console.log("✅ Quality Intelligence Engine: No new issues since baseline.");
    process.exit(0);
  }
}

// Default reporting
const criticalFindings = findings.filter(f => f.severity === "critical");
if (criticalFindings.length > 0) {
  console.error("❌ Quality Intelligence Engine: Critical issues found:");
  console.error(JSON.stringify(criticalFindings, null, 2));
  if (ci) {
    console.error("❌ Quality Intelligence Engine: Blocking — critical findings must be resolved in CI.");
    process.exit(1);
  } else {
    console.warn("⚠️ Quality Intelligence Engine: Warning only (local/non-CI). Please resolve critical findings before final merge.");
    process.exit(0);
  }
}
const nonCritical = findings.filter(f => f.severity !== "critical");
if (nonCritical.length > 0) {
  console.warn("⚠️ Quality Intelligence Engine: Medium/Low issues found:");
  console.warn(JSON.stringify(nonCritical, null, 2));
}
console.log("✅ Quality Intelligence Engine: Analysis complete.");
process.exit(0);