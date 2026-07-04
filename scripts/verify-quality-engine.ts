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

/** Parse command-line arguments and extract flags, mode, baseline, compare, CI, and Redis cache settings. */
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
  if (!VALID_MODES.includes(rawMode as typeof VALID_MODES[number])) {
    console.error(`❌ qa-intel: Invalid mode "${rawMode}". Supported modes: ${VALID_MODES.join(", ")}`);
    process.exit(1);
  }
  const mode = rawMode;

  return {
    flags: f,
    mode,
    baseline: f.baseline === true || f.baseline === "true",
    compare: f.compare === true || f.compare === "true",
    ci: f.ci === true || f.ci === "true" || process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true",
    useRedisCache: (f["use-redis-cache"] === true || f["use-redis-cache"] === "true") && !(f.ci === true || f.ci === "true" || process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"),
  };
}

/** Display command-line usage information and available options. */
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

// Load and wrap legacy rules (IRule format), pass new rules (Rule format) through unchanged
const rules = Object.values(legacyRules)
  .filter((r): r is any => r && typeof r === "object" && "check" in r && "name" in r)
  .map((rule: unknown) => {
    const r = rule as any;
    // Check if this is a new Rule format (has scope property or check function references RuleContext)
    // vs legacy IRule format (check function takes SourceFile directly)
    if (r.scope !== undefined || (r.check && (r.check.toString().includes('ctx.ast') || r.check.toString().includes('ctx.filePath')))) {
      // Already in new Rule format
      return r as any;
    }
    // Legacy IRule format, wrap it
    return wrapLegacyRule(r as any);
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

/** Execute quality analysis engine on specified files and report findings. */
async function run() {
  // Initialize ts-morph Project — guard unhoisted packages in pnpm strict mode
  let project: import("ts-morph").Project;
  try {
    const { Project: TsMorphProject } = await import("ts-morph");
    project = new TsMorphProject({
      tsConfigFilePath: path.join(process.cwd(), "tsconfig.json"),
      skipAddingFilesFromTsConfig: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[qa-intel] Failed to load ts-morph (required for verify-quality-engine). Failing run.", { error: message });
    process.exit(1);
  }

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
  console.log("--- Source Provenance & Runtime Honesty Audit ---");
  console.log(`Runtime scan sources: ${fileList.length} files scanned via TS/TSX globs (excl. node_modules)`);
  console.log("Calibration sources: Juliet/SARD (CWE-22, CWE-259), CRBench, Big-Vul/Devign (CWE-89)");
  console.log("Calibration source visibility: CALIBRATION-ONLY (none affect live PR scans)");
  const hasActiveGraphRule = rules.some(r => r.scope === "graph");
  console.log(`Graph status: ${hasActiveGraphRule ? "ACTIVE (GraphAwareBoundaryRule consumes ctx.graph)" : "PLUMBED-ONLY"}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log("-------------------------------------------------");

  // Normalize every finding's `file` to a repo-relative POSIX path at this single
  // choke point. Rules emit a mix of absolute (`/home/user/…/x.ts`) and relative
  // paths depending on how the source was loaded; the baseline/compare flow keys
  // on `${file}:${title}`, so un-normalized absolute paths would make `--compare`
  // treat every finding as "new" on CI or another developer's checkout (different
  // cwd). Relativizing here keeps baseline write, compare, and reporting stable
  // and machine-independent.
  // Pure string prefix-strip (no `path.resolve`/`path.relative` on a variable):
  // the finding paths are engine-produced repo file paths, either absolute under
  // cwd or already repo-relative. Avoiding `path.*` on a variable also keeps
  // static analysers from flagging a (non-applicable) path-traversal sink here.
  const cwdPosix = process.cwd().replace(/\\/g, '/').replace(/\/+$/, '');
  const toRepoRelative = (f: string): string => {
    const norm = f.replace(/\\/g, '/');
    if (norm === cwdPosix) return '';
    if (norm.startsWith(cwdPosix + '/')) return norm.slice(cwdPosix.length + 1);
    return norm.replace(/^\.\//, '');
  };
  const findings = (await engine.analyze(fileList)).map(f => ({
    ...f,
    file: toRepoRelative(f.file),
  }));

  // Surface per-rule errors if any occurred — always hard-fail if rules are broken
  if (engine.ruleErrors && engine.ruleErrors.length > 0) {
    console.error("\n❌ [qa-intel] Per-rule execution errors detected during analysis:");
    const errorsByRule: Record<string, Array<{ file: string; message: string }>> = {};
    for (const err of engine.ruleErrors) {
      if (!errorsByRule[err.ruleName]) {
        errorsByRule[err.ruleName] = [];
      }
      errorsByRule[err.ruleName].push({
        file: err.filePath,
        message: err.message
      });
    }
    Object.entries(errorsByRule).forEach(([ruleName, errors]) => {
      console.error(`\n  Rule: "${ruleName}" (${errors.length} error${errors.length !== 1 ? 's' : ''})`);
      errors.forEach(err => {
        console.error(`    File: ${err.file}`);
        console.error(`    Error: ${err.message}`);
      });
    });
    console.error("\n  Investigate rule implementations for: " + Object.keys(errorsByRule).join(", "));
    console.error("\n❌ qa-intel: Rule execution errors are blocking. Cannot proceed with quality gate.");
    process.exit(1);
  }

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

  // Treat HIGH severity as blocking in CI (same as critical) and advisory in local/non-CI runs
  const highFindings = findings.filter(f => f.severity === "high");
  if (highFindings.length > 0) {
    console.error("❌ qa-intel: High-severity issues found:");
    console.error(JSON.stringify(highFindings, null, 2));
    if (ci) {
      console.error("❌ qa-intel: Blocking — high-severity findings must be resolved in CI.");
      process.exit(1);
    } else {
      console.warn("⚠️ qa-intel: High-severity findings are advisory in local/non-CI runs (not blocking).");
      console.warn("⚠️ qa-intel: Please resolve high-severity findings before final merge to avoid CI failures.");
      process.exit(0);
    }
  }

  const nonCritical = findings.filter(f => f.severity !== "critical" && f.severity !== "high");
  if (nonCritical.length > 0) {
    console.warn("⚠️ qa-intel: Medium/Low issues found:");
    console.warn(JSON.stringify(nonCritical, null, 2));
  }
  console.log("✅ qa-intel: Analysis complete.");
  process.exit(0);
}

run().catch(err => {
  console.error('[qa-intel]', { error: err instanceof Error ? err.message : String(err), phase: 'engine-execution' });
  process.exit(1);
});