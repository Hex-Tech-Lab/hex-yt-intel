import { QualityEngine } from "./quality-engine/application/QualityEngine";
import { TsMorphLoader } from "./quality-engine/infra/TsMorphLoader";
import { NodeFileSystem } from "./quality-engine/infra/NodeFileSystem";
import { CacheAdapter } from "./quality-engine/infra/CacheAdapter";
import { wrapLegacyRule } from "./quality-engine/infra/LegacyRuleAdapter";
import { createCache } from "./quality-engine/cache";
import * as legacyRules from "./quality-engine/rules";
import { Project } from "ts-morph";
import * as glob from "glob";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";

// Initialize ts-morph Project
const project = new Project({
  tsConfigFilePath: path.join(process.cwd(), "tsconfig.json"),
  skipAddingFilesFromTsConfig: true,
});

// Load and wrap all legacy rules
const rules = Object.values(legacyRules).map((legacyRule: any) => {
  return wrapLegacyRule(legacyRule);
});

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

// Get file list based on mode
let fileList: string[] = [];
if (mode === "full" || mode === "watch") {
  fileList = glob.sync("{web,worker}/**/*.{ts,tsx}", { ignore: "**/node_modules/**" }).map(f => f.replace(/\\/g, "/"));
} else if (mode === "diff") {
  // Get changed files via git diff
  try {
    const diffOutput = execSync("git diff --name-only --diff-filter=ACM HEAD", { encoding: "utf8" });
    fileList = diffOutput
      .split(/\r?\n/)
      .filter(line => line.trim().endsWith(".ts") || line.trim().endsWith(".tsx"))
      .map(f => f.trim())
      .filter(f => f.length > 0);
    if (fileList.length === 0) {
      console.log("No changed TS/TSX files; falling back to full scan");
      fileList = glob.sync("{web,worker}/**/*.{ts,tsx}", { ignore: "**/node_modules/**" }).map(f => f.replace(/\\/g, "/"));
    }
  } catch (e: any) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[qa-intel]', { message, operation: 'git-diff' });
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(e, { contexts: { operation: 'qa-intel', method: 'git-diff' } });
    } catch (sentryErr) {
      console.error('[qa-intel-sentry]', sentryErr);
    }
    fileList = glob.sync("{web,worker}/**/*.{ts,tsx}", { ignore: "**/node_modules/**" }).map(f => f.replace(/\\/g, "/"));
  }
}

const fsAdapter = new NodeFileSystem();
// Ensure files exist
fileList = fileList.filter(f => fsAdapter.exists(f));

if (fileList.length === 0) {
  console.error("❌ qa-intel: No files found to scan.");
  process.exit(1);
}

// Initialize cache adapter
const legacyCache = createCache(useRedisCache);
const cacheAdapter = new CacheAdapter(legacyCache);

// Construct QualityEngine
const engine = new QualityEngine(
  rules,
  new TsMorphLoader(project),
  cacheAdapter,
  fsAdapter,
  {
    mode: mode === "diff" ? "diff" : "full",
    defaultScope: "file",
  }
);

async function run() {
  const findings = await engine.analyze(fileList);

  // Handle baseline
  const baselinePath = path.resolve(process.cwd(), ".qa-intel/baseline.json");
  if (baseline) {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, JSON.stringify(findings, null, 2));
    console.log(`✅ Baseline written to ${baselinePath}`);
    process.exit(0);
  }

  if (compare) {
    if (!fs.existsSync(baselinePath)) {
      console.error("❌ No baseline found. Run with --baseline first.");
      process.exit(1);
    }
    const baselineFindings: any[] = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const baselineSet = new Set(baselineFindings.map(f => `${f.file}:${f.title}`));
    const newFindings = findings.filter(f => !baselineSet.has(`${f.file}:${f.title}`));
    if (newFindings.length > 0) {
      console.error("⚠️ qa-intel: New/changed issues found:");
      console.error(JSON.stringify(newFindings, null, 2));
      process.exit(1);
    } else {
      console.log("✅ qa-intel: No new issues since baseline.");
      process.exit(0);
    }
  }

  // Default reporting
  const criticalFindings = findings.filter(f => f.severity === "critical");
  if (criticalFindings.length > 0) {
    console.error("❌ qa-intel: Critical issues found:");
    console.error(JSON.stringify(criticalFindings, null, 2));
    if (ci) {
      console.error("❌ qa-intel: Blocking — critical findings must be resolved in CI.");
      process.exit(1);
    } else {
      console.warn("⚠️ qa-intel: Warning only (local/non-CI). Please resolve critical findings before final merge.");
      process.exit(0);
    }
  }

  const nonCritical = findings.filter(f => f.severity !== "critical");
  if (nonCritical.length > 0) {
    console.warn("⚠️ qa-intel: Medium/Low issues found:");
    console.warn(JSON.stringify(nonCritical, null, 2));
  }
  console.log("✅ qa-intel: Analysis complete.");
  process.exit(0);
}

run().catch(err => {
  console.error("Fatal engine error:", err);
  process.exit(1);
});