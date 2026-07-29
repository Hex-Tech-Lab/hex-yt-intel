/**
 * Contract Auditor -- catches "it compiles, it's not a security bug, and it
 * still silently does the wrong thing" defects that tsc/lint/qa-intel miss.
 *
 * Every rule below is reverse-engineered from a REAL incident found by hand
 * in this repo on 2026-07-28/29, not a hypothetical:
 *   - SILENT_SUCCESS_ON_MISSING_CONFIG: scripts/setup-qstash-cron.ts did
 *     `console.warn(...); process.exit(0)` when QSTASH_TOKEN was empty --
 *     CI's "Cron Registration" job reported green for 2+ months while
 *     registering zero schedules.
 *   - UNVERIFIED_EXTERNAL_ENDPOINT: lib/admin-logs/fetchers.ts hit
 *     `api.supabase.com/v1/projects/{ref}/logs?type=postgres`, a path that
 *     doesn't exist (confirmed via live curl -- 404), and separately AGY's
 *     own fix landed on a POST+JSON-body call to logs.all that also 404s.
 *     No test or health-check would ever have exercised either path.
 *   - SCRIPTED_TEMPLATE_FAILURE: ucis-v5.1.ts's Monetization dimension
 *     instructs the model "Action: "[Insufficient...]" (typically)" for two
 *     of five personas while the other three are told to find a real
 *     answer -- a template defect that LOOKS like a data problem in output
 *     but is actually an authoring gap.
 *
 * This is intentionally a small, high-precision ruleset, not a general
 * linter -- false positives here train people to ignore the tool, which
 * defeats the point. Run: `pnpm tsx scripts/contract-auditor.ts`.
 * Exits 1 only on CRITICAL findings so CI turns red on the exact class of
 * bug that used to stay invisible; WARNING findings are informational.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { createHash } from 'crypto';

interface Finding {
  rule: string;
  severity: 'critical' | 'warning';
  file: string;
  line: number;
  /** Stable identity across runs (rule+file+line), used to compute new/recurring/resolved against the previous run -- a raw findings dump tells you what's wrong TODAY, not whether it's the same thing you already knew about or a fresh regression. */
  fingerprint?: string;
  why: string;
  snippet: string;
}

const REPO_ROOT = join(__dirname, '..', '..');
const SCAN_ROOTS = [join(REPO_ROOT, 'web'), join(REPO_ROOT, 'worker')];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage', '.turbo']);
const CODE_EXT = new Set(['.ts', '.tsx']);
const TEST_MARKERS = ['.test.', '.spec.', '__tests__'];

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (CODE_EXT.has(entry.slice(entry.lastIndexOf('.')))) {
      yield full;
    }
  }
}

function isTestFile(path: string): boolean {
  return TEST_MARKERS.some((m) => path.includes(m));
}

const findings: Finding[] = [];

// --- Rule 1: SILENT_SUCCESS_ON_MISSING_CONFIG ---------------------------
// A script that warns about missing required config and then exits 0 (or
// just `return`s with no non-zero exit) will report success to whatever
// invoked it. CI-invoked scripts (package.json "scripts" entries reachable
// from a workflow `run:` line) are the highest-risk case -- a green check
// that did nothing is strictly worse than a red one that's honest.
function auditSilentSuccess(file: string, content: string) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!/console\.(warn|error)\(/.test(line)) continue;
    const isMissingConfigWarning = /missing|not (configured|set|found)|skip/i.test(line);
    if (!isMissingConfigWarning) continue;
    // Look ahead a few lines for a bare `process.exit(0)` (or a `return`
    // with no throw) that would make the caller see success.
    const window = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
    if (/process\.exit\(0\)/.test(window)) {
      findings.push({
        rule: 'SILENT_SUCCESS_ON_MISSING_CONFIG',
        severity: 'critical',
        file,
        line: i + 1,
        why: 'A missing-config warning is immediately followed by process.exit(0) -- the caller (likely CI) sees this as success. If this script is invoked from a workflow step with no other verification, a rotated/emptied credential becomes permanently invisible.',
        snippet: line.trim(),
      });
    }
  }
}

// --- Rule 2: UNVERIFIED_EXTERNAL_ENDPOINT --------------------------------
// A hardcoded call to a known third-party management/analytics API, in a
// non-test file, with no sibling test file for the same module. This is a
// heuristic, not proof of a broken contract -- it flags the SHAPE of risk
// (a guessed API path with nothing ever asserting it still returns 2xx),
// not a certain bug. Kept to a short, deliberately narrow host list so it
// stays high-signal.
const RISKY_HOSTS = [
  'api.supabase.com',
  'qstash.upstash.io',
  'api.vercel.com',
  '.upstash.io',
  'openrouter.ai',
  'api.cloudflare.com',
];
function auditUnverifiedEndpoints(file: string, content: string, hasSiblingTest: boolean) {
  if (hasSiblingTest || isTestFile(file)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const hit = RISKY_HOSTS.find((h) => line.includes(h));
    if (!hit) continue;
    if (!/fetch\(|axios\.|https?:\/\//.test(line)) continue;
    findings.push({
      rule: 'UNVERIFIED_ENDPOINT_NO_TEST',
      severity: 'warning',
      file,
      line: i + 1,
      why: `Hardcoded call to ${hit} with no sibling test file (*.test.ts / *.spec.ts) for this module. Management/analytics API paths drift between API versions with no compile-time signal -- verify this exact path+method+body shape against a live call before trusting it, the way the Supabase logs.all and QStash schedule endpoints in this repo both silently 404'd.`,
      snippet: line.trim(),
    });
  }
}

// --- Rule 3: SCRIPTED_TEMPLATE_FAILURE -----------------------------------
// Enumerated-persona/section prompt templates (P1, P2, P3... or Dimension
// N.M style) where some entries are told to attempt a real answer and
// others are pre-scripted to fail. Looks for the literal pattern that
// caused the Monetization Dimension 11 bug: an "Action:"/"Verdict:" style
// line whose ONLY instruction is a bracketed placeholder plus a
// parenthetical like "(typically)" hinting the model should default to
// giving up, while sibling persona blocks in the same file get an
// "X OR insufficient" instruction instead of a bare default-to-fail one.
function auditScriptedTemplateFailure(file: string, content: string) {
  if (!/prompts?/i.test(file)) return;
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/\[Insufficient[^\]]*\]"\s*\(typically\)/i.test(line) || /"\[Insufficient[^\]]*\]"\s*\(default\)/i.test(line)) {
      findings.push({
        rule: 'SCRIPTED_TEMPLATE_FAILURE',
        severity: 'warning',
        file,
        line: i + 1,
        why: 'This template line pre-scripts an insufficient-data outcome by default rather than instructing the model to attempt a real answer first (contrast with sibling entries using an "X OR insufficient" pattern). Confirmed this exact pattern in ucis-v5.1.ts caused Researcher/Product Manager Monetization verdicts to fail even when Creator/Indie Maker/Consultant produced real numbers from the same transcript.',
        snippet: line.trim(),
      });
    }
  }
}

for (const root of SCAN_ROOTS) {
  const dirFiles = [...walk(root)];
  const stems = new Set(dirFiles.map((f) => f.replace(/\.(test|spec)\.tsx?$/, '.___').replace(/\.tsx?$/, '')));
  for (const file of dirFiles) {
    if (isTestFile(file)) continue;
    const content = readFileSync(file, 'utf-8');
    const relPath = relative(REPO_ROOT, file);
    const stem = file.replace(/\.tsx?$/, '');
    const hasSiblingTest = stems.has(`${stem}.___`) || dirFiles.some((f) => isTestFile(f) && f.startsWith(stem));
    auditSilentSuccess(relPath, content);
    auditUnverifiedEndpoints(relPath, content, hasSiblingTest);
    auditScriptedTemplateFailure(relPath, content);
  }
}

for (const f of findings) {
  f.fingerprint = createHash('sha1').update(`${f.rule}:${f.file}:${f.line}`).digest('hex').slice(0, 12);
}

const criticalCount = findings.filter((f) => f.severity === 'critical').length;
const warningCount = findings.filter((f) => f.severity === 'warning').length;

async function fetchPreviousFingerprints(url: string, serviceKey: string): Promise<Set<string> | null> {
  try {
    const res = await fetch(
      `${url}/rest/v1/contract_audit_runs?select=findings&order=run_at.desc&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const prevFindings = rows?.[0]?.findings;
    if (!Array.isArray(prevFindings)) return null;
    return new Set(prevFindings.map((f: any) => f.fingerprint).filter(Boolean));
  } catch {
    return null;
  }
}

async function persistRun() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Contract Auditor: skipping DB persistence (no Supabase service credentials in this environment).');
    printSummary(null);
    return;
  }

  const prevFingerprints = await fetchPreviousFingerprints(url, serviceKey);
  const currentFingerprints = new Set(findings.map((f) => f.fingerprint));
  const remediation = prevFingerprints
    ? {
        newCount: findings.filter((f) => !prevFingerprints.has(f.fingerprint!)).length,
        recurringCount: findings.filter((f) => prevFingerprints.has(f.fingerprint!)).length,
        resolvedCount: [...prevFingerprints].filter((fp) => !currentFingerprints.has(fp)).length,
      }
    : null;

  printSummary(remediation);

  try {
    const res = await fetch(`${url}/rest/v1/contract_audit_runs`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        source: process.env.CI ? 'ci' : 'local',
        commit_sha: process.env.GITHUB_SHA || null,
        critical_count: criticalCount,
        warning_count: warningCount,
        findings,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Contract Auditor: failed to persist run to Supabase (${res.status}): ${text}`);
      return;
    }
    console.error('Contract Auditor: run persisted to public.contract_audit_runs.');
  } catch (err) {
    console.error('Contract Auditor: failed to persist run to Supabase:', err instanceof Error ? err.message : String(err));
  }
}

function printSummary(remediation: { newCount: number; recurringCount: number; resolvedCount: number } | null) {
  const summary = {
    runAt: new Date().toISOString(),
    criticalCount,
    warningCount,
    remediation,
    findings,
  };
  console.log(JSON.stringify(summary, null, 2));
  const remediationLine = remediation
    ? ` (${remediation.newCount} new, ${remediation.recurringCount} recurring, ${remediation.resolvedCount} resolved since last run)`
    : '';
  console.error(`\nContract Auditor: ${criticalCount} critical, ${warningCount} warning finding(s)${remediationLine}.`);
}

persistRun().finally(() => {
  process.exit(criticalCount > 0 ? 1 : 0);
});
