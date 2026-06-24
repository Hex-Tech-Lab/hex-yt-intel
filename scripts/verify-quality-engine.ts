import { QualityEngine } from "./quality-engine/application/QualityEngine";
import { TsMorphLoader } from "./quality-engine/infra/TsMorphLoader";
import { NodeFileSystem } from "./quality-engine/infra/NodeFileSystem";
import { CacheAdapter } from "./quality-engine/infra/CacheAdapter";
import { wrapLegacyRule } from "./quality-engine/infra/LegacyRuleAdapter";
import { createCache } from "./quality-engine/cache";
import * as legacyRules from "./quality-engine/rules";
import * as glob from "glob";
import * as path from "path";
import * as fs from "fs";
import { execFileSync } from "child_process";

// ─── CLI flag parsing (hoisted before any module init) ──────────────────────
const { flags, mode, baseline, compare, ci, useRedisCache } = parseCliFlags();

if (flags.help || flags.h) {
  showHelp();
  process.exit(0);
}

function parseCliFlags() {
  const args = process.argv.slice(2);
  const f: Record<string, boolean | string> = {};
  let currentFlag: string | null = null;
  for (const arg of args) {
    if (arg === "-h") {
      f.help = true;
    } else if (arg.startsWith("--")) {
      const flag = arg.slice(2);
      if (flag.includes("=")) {
        const [key, value] = flag.split("=");
        f[key] = value;
      } else {
        f[flag] = true;
        currentFlag = flag;
      }
    } else if (currentFlag) {
      f[currentFlag] = arg;
      currentFlag = null;
    }
  }

  const rawMode = (f.mode as string) ?? "diff";
  const VALID_MODES = ["diff", "full", "watch", "working-tree", "HEAD"] as const;
  const mode = VALID_MODES.includes(rawMode as typeof VALID_MODES[number]) ? rawMode : "diff";

  return {
    flags: f,
    mode,
    baseline: f.baseline === true || f.baseline === "true",
    compare: f.compare === true || f.compare === "true",
    ci: f.ci === true || f.ci === "true" || process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true",
    useRedisCache: (f["use-redis-cache"] === true || f["use-redis-cache"] === "true") && !(f.ci === true || f.ci === "true" || process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"),
  };
}

function showHelp() {
  console.log(`
Usage: qa-intel [options]

Options:
  --mode <mode>        Scan mode: "diff" (default), "full", "watch", "working-tree", "HEAD"
  --base <ref>         Base ref for "diff" mode. Defaults to "origin/main".
  --concurrency <num>  Set concurrency limit (default: 3).
  --baseline           Write current findings to baseline.json.
  --compare            Compare findings against baseline.json.
  --use-redis-cache    Enable Redis caching for rule checks.
  --help, -h           Show this help text.

Modes:
  diff                 Scan files changed between the current branch and a base ref (defaults to origin/main).
  full                 Scan all TypeScript/TSX files in the repository.
  watch                Watch files and scan on change.
  working-tree         Scan unstaged/staged files in the current working directory compared to HEAD.
  HEAD                 Scan files changed in the last commit (HEAD vs HEAD~1).
`);
}

// Initialize ts-morph Project — guarded for unhoisted packages in pnpm strict mode
let project: import("ts-morph").Project;
try {
  const { Project: TsMorphProject } = await import("ts-morph");
  project = new TsMorphProject({
    tsConfigFilePath: path.join(process.cwd(), "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
} catch (depErr) {
  console.error("[qa-intel] ts-morph module resolution failed — unhoisted or missing.", depErr instanceof Error ? depErr.message : String(depErr));
  console.error("[qa-intel] Package resolution failures must not mask structural code health. Exiting with failure.");
  process.exit(1);
}

// Load and wrap all legacy rules
const rules = Object.values(legacyRules).map((legacyRule: unknown) => {
  return wrapLegacyRule(legacyRule as any);
});

// Get file list based on mode
let fileList: string[] = [];
if (mode === "full" || mode === "watch") {
  fileList = glob.sync("{web,worker}/**/*.{ts,tsx}", { ignore: "**/node_modules/**" }).map(f => f.replace(/\\/g, "/"));
} else {
  let diffArgs: readonly string[] = [];
  if (mode === "diff") {
    const baseRef = typeof flags.base === "string" ? flags.base : "origin/main";
    diffArgs = ["diff", "--name-only", "--diff-filter=ACM", baseRef];
  } else if (mode === "working-tree") {
    diffArgs = ["diff", "--name-only", "--diff-filter=ACM", "HEAD"];
  } else if (mode === "HEAD") {
    diffArgs = ["diff", "--name-only", "--diff-filter=ACM", "HEAD~1", "HEAD"];
  } else {
    console.error(`❌ qa-intel: Invalid mode "${mode}". Supported: diff, full, watch, working-tree, HEAD`);
    process.exit(1);
  }

  try {
    // Validate target git refs exist first
    if (mode === "diff") {
      const baseRef = typeof flags.base === "string" ? flags.base : "origin/main";
      try {
        execFileSync("git", ["rev-parse", "--verify", baseRef], { stdio: "ignore" });
      } catch {
        console.error(`❌ qa-intel: Invalid git ref "${baseRef}". Cannot perform diff scan.`);
        process.exit(1);
      }
    } else if (mode === "HEAD") {
      try {
        execFileSync("git", ["rev-parse", "--verify", "HEAD~1"], { stdio: "ignore" });
      } catch {
        console.error("❌ qa-intel: No previous commit found (HEAD~1 does not exist). Cannot perform HEAD diff scan.");
        process.exit(1);
      }
    }

    const diffOutput = execFileSync("git", diffArgs, { encoding: "utf8" });
    fileList = diffOutput
      .split(/\r?\n/)
      .filter(line => line.trim().endsWith(".ts") || line.trim().endsWith(".tsx"))
      .map(f => f.trim())
      .filter(f => f.length > 0);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[qa-intel]', { message, operation: 'git-diff', command: diffArgs });
    try {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureException(e, { contexts: { operation: 'qa-intel', method: 'git-diff', command: diffArgs } });
    } catch (sentryErr) {
      console.error('[qa-intel-sentry]', sentryErr);
    }
    process.exit(1);
  }
}

const fsAdapter = new NodeFileSystem();
// Ensure files exist
fileList = fileList.filter(f => fsAdapter.exists(f));

if (fileList.length === 0) {
  if (mode === "diff" || mode === "working-tree" || mode === "HEAD") {
    console.log(`✅ qa-intel: No changed TS/TSX files detected to scan (mode: ${mode}).`);
    process.exit(0);
  }
  console.error("❌ qa-intel: No files found to scan.");
  process.exit(1);
}

const concurrencyFlag = flags.concurrency ? parseInt(String(flags.concurrency), 10) : 3;
const concurrency = isNaN(concurrencyFlag) ? 3 : concurrencyFlag;

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
    concurrency,
  }
);

async function run() {
  console.log("--- Source Provenance & Runtime Honesty Audit ---");
  console.log(`Runtime scan sources: ${fileList.length} files scanned via TS/TSX globs (excl. node_modules)`);
  console.log("Calibration sources: Juliet/SARD (CWE-22, CWE-259), CRBench, Big-Vul/Devign (CWE-89)");
  console.log("Calibration source visibility: CALIBRATION-ONLY (none affect live PR scans)");
  const hasActiveGraphRule = rules.some(r => r.scope === "graph");
  console.log(`Graph status: ${hasActiveGraphRule ? "ACTIVE (GraphAwareBoundaryRule consumes ctx.graph)" : "PLUMBED-ONLY"}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log("-------------------------------------------------");

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
    const baselineFindings: {file:string;title:string}[] = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
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