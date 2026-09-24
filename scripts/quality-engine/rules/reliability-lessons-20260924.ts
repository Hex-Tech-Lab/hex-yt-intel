/**
 * Reliability rules mined from the 2026-09-24 false-negative wave
 * (external PR reviews #320/#321/#322 found defects qa-intel passed clean).
 *
 * Source entries: docs/qa-intel/RULESET_LESSONS_LEDGER.md (2026-09-24, R6/R7/R9/R11)
 * Real pre-fix snippets (verified at the actual PR head commits):
 * - R6/R7: cb5d1aa2 web/lib/admin-logs/fetchers.ts (`obsJson?.result?.events?.events || []`;
 *   observability fetch with no signal/timeout)
 * - R9: 92cb6a75 worker/src/routes/analysis.ts (Sentry.captureMessage on the
 *   non-2xx branch; sibling catch only console.warn)
 * - R11: 8c159c92 web/app/api/analyses/[id]/relations/route.ts:178
 *   (`if (insights.length > 0) { ...update... }`)
 */
import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Finding } from "../domain/Finding";
import type { Rule, RuleContext } from "../domain/Rule";

function normalizePosixPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isTestFile(f: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(f) || f.includes("__tests__/");
}

/** True if the expression contains a real optional-access link (`?.`), either
 * as a `?.` property access, `?.()` call, `?.[]` element access, or nested
 * within a member chain. AST-based, not textual, so ternaries like
 * `a ? b?.c : d` are attributed correctly. */
function hasOptionalAccess(expr: Node): boolean {
  if (Node.isPropertyAccessExpression(expr) || Node.isElementAccessExpression(expr)) {
    if (expr.hasQuestionDotToken()) return true;
    return hasOptionalAccess(expr.getExpression());
  }
  if (Node.isCallExpression(expr)) {
    if (expr.hasQuestionDotToken()) return true;
    return hasOptionalAccess(expr.getExpression());
  }
  if (Node.isNonNullExpression(expr)) return hasOptionalAccess(expr.getExpression());
  return false;
}

/** Root identifier of a member/call chain, e.g. `obsJson` for
 * `obsJson?.result?.events?.events`. Returns undefined for non-chain bases. */
function rootIdentifierOf(expr: Node): string | undefined {
  let current = expr;
  for (;;) {
    if (Node.isIdentifier(current)) return current.getText();
    if (Node.isPropertyAccessExpression(current) || Node.isElementAccessExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isCallExpression(current)) {
      current = current.getExpression();
      continue;
    }
    if (Node.isNonNullExpression(current) || Node.isAwaitExpression(current)) {
      current = current.getExpression();
      continue;
    }
    return undefined;
  }
}

/**
 * R6 — Silent default on an external response shape.
 *
 * `fetchedJson?.deep?.path || []` / `?? []` silently converts an unexpected
 * upstream shape (auth drift, renamed field, envelope change) into an empty
 * success — the exact PR #321 incident (`obsJson?.result?.events?.events ||
 * []` swallowed a real shape and returned 200 with zero entries).
 *
 * Scope guard (false-positive control): only fires when the chain's root
 * identifier is a local variable whose initializer traces to a fetch/JSON
 * boundary (`await fetch(`, `.json()`, or `fetchWithTimeout(`). Internal
 * optional data (`store?.items ?? []`, props/params) is not flagged.
 */
export const SilentDefaultOnExternalResponseRule: Rule = {
  name: "silent-default-on-external-response-shape",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath)) return findings;

    const fetchedRoots = new Set<string>();
    source.forEachDescendant((node) => {
      if (!Node.isVariableDeclaration(node)) return;
      const init = node.getInitializer();
      if (!init) return;
      const text = init.getText();
      if (text.includes(".json()") || text.includes("fetch(") || text.includes("fetchWithTimeout(")) {
        fetchedRoots.add(node.getName());
      }
    });
    if (fetchedRoots.size === 0) return findings;

    source.forEachDescendant((node) => {
      if (!Node.isBinaryExpression(node)) return;
      const op = node.getOperatorToken().getText();
      if (op !== "||" && op !== "??") return;
      const rhs = node.getRight();
      if (!Node.isArrayLiteralExpression(rhs)) return;
      if (rhs.getElements().length !== 0) return;
      const lhs = node.getLeft();
      if (!hasOptionalAccess(lhs)) return;
      const root = rootIdentifierOf(lhs);
      if (!root || !fetchedRoots.has(root)) return;

      findings.push({
        file: filePath,
        severity: "medium",
        title: `Reliability: silent empty-default on fetched response shape ('${root}')`,
        why: `'${node.getText()}' defaults an optionally-chained read of a fetched response (${root} traces to a fetch/.json() boundary) to an empty array. An upstream shape change, auth drift or error envelope silently becomes an empty success instead of surfacing.`,
        fix: "Validate the response shape explicitly (Zod schema, or explicit checks that throw/log a warning with the raw shape) before defaulting; never turn an unknown shape into an empty success.",
      });
    });

    return findings;
  },
};

/**
 * R7 — Server-side fetch without a timeout/AbortSignal.
 *
 * The PR #321 second Cloudflare call had no timeout: one hung upstream
 * request held the whole admin route open despite the "fail-soft" intent,
 * violating the project's dual-timeout convention (CLAUDE.md Law #2).
 *
 * Scope: server-side files only (web/app/api/**, worker/src/**, and the
 * server-only web/lib/admin-logs/**). Client components/hooks legitimately
 * stream long responses and are NOT flagged. Calls through
 * `fetchWithTimeout(...)` or with an explicit `signal:` option are safe.
 */
export const ServerFetchWithoutTimeoutRule: Rule = {
  name: "server-fetch-without-timeout",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath)) return findings;

    const SERVER_PREFIXES = ["web/app/api/", "worker/src/", "web/lib/admin-logs/"];
    const isServerSide = SERVER_PREFIXES.some((p) => filePath.startsWith(p) || filePath.includes(`/${p}`));
    if (!isServerSide) return findings;

    source.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callee = node.getExpression().getText();
      // Only the real global `fetch` — a `something.fetch(...)` domain-method
      // wrapper (TranscriptExtractor.fetch, MetadataScraper.fetch, …) manages
      // its own internal timeouts/retries and is out of scope; same for
      // `fetchWithTimeout(...)` which does not textually match `fetch` anyway.
      const isPlainFetch = callee === "fetch" || callee === "globalThis.fetch";
      if (!isPlainFetch) return;

      const callText = node.getText();
      // Guard against nested/inner fetch matching twice (e.g. fetch inside
      // the arguments of another call) — only check top-level argument
      // object literals for `signal:`.
      const hasSignal = node.getArguments().some((arg) => {
        if (Node.isObjectLiteralExpression(arg)) {
          return arg.getProperties().some((prop) => {
            if (Node.isPropertyAssignment(prop)) return prop.getName() === "signal";
            if (Node.isShorthandPropertyAssignment(prop)) return prop.getName() === "signal";
            if (Node.isSpreadAssignment(prop)) return /\bsignal\b/.test(prop.getText());
            return false;
          });
        }
        return /\bsignal\b\s*:/.test(arg.getText());
      });
      if (hasSignal) return;

      findings.push({
        file: filePath,
        severity: "medium",
        title: "Reliability: server-side fetch without timeout/AbortSignal",
        why: `A server-side call (${callText.slice(0, 120)}${callText.length > 120 ? "…" : ""}) has no 'signal' option. A hung upstream connection blocks this server context indefinitely — outside fetchWithTimeout there is no deadline (dual-timeout Law #2).`,
        fix: "Pass an AbortController signal with a bounded timeout (or use the project's fetchWithTimeout helper), and clearTimeout in a finally block.",
      });
    });

    return findings;
  },
};

/**
 * R9 — Error-path asymmetry.
 *
 * The PR #320 incident: the non-2xx branch captured to Sentry, but the
 * sibling `catch` (network/timeout/DNS — the MORE common failure class) only
 * console.warn'd, so a real auth regression ran for weeks with zero alerting
 * signal.
 *
 * Fires on a catch block that logs only via console.* (no Sentry, no rethrow)
 * when the same enclosing function already contains a Sentry.capture* call
 * — i.e., the function clearly has an established telemetry convention that
 * this path silently drops.
 */
export const ErrorPathAsymmetryRule: Rule = {
  name: "error-path-telemetry-asymmetry",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath)) return findings;

    source.forEachDescendant((node) => {
      if (!Node.isCatchClause(node)) return;
      const body = node.getBlock();
      const bodyText = body.getText();
      const hasConsoleLog = /console\.(warn|error|log)\(/.test(bodyText);
      if (!hasConsoleLog) return;
      if (bodyText.includes("Sentry.")) return;
      if (/\bthrow\b/.test(bodyText)) return; // error is re-raised upstream, not swallowed

      // The asymmetry must be BETWEEN SIBLING BRANCHES OF THE SAME try — the
      // exact PR #320 shape: try { if (!ok) Sentry.captureMessage(...) }
      // catch (err) { console.warn(...) }. A Sentry capture elsewhere in the
      // file/function is NOT asymmetry: deliberate console-only best-effort
      // paths (middleware auth-diag, Redis fail-soft getters, retry-loop
      // intermediates with a terminal Sentry capture after exhaustion) are an
      // established convention, not the bug.
      const tryStmt = node.getFirstAncestorByKind(SyntaxKind.TryStatement);
      if (!tryStmt) return;
      // AST-based, not textual: "Sentry.capture" in explanatory comments
      // (e.g. middleware.ts's "console.warn only here (not Sentry.captureMessage)")
      // must not count as a real sibling capture.
      const hasSiblingSentryCapture = tryStmt
        .getTryBlock()
        .getDescendants()
        .some((d) => Node.isCallExpression(d) && d.getExpression().getText().startsWith("Sentry.capture"));
      if (!hasSiblingSentryCapture) return;

      // Do not double-flag nested catches when the outer function body
      // already produced a finding for an outer catch.
      const caught = node.getVariableDeclaration()?.getText() ?? "error";
      findings.push({
        file: filePath,
        severity: "medium",
        title: "Reliability: sibling catch logs console-only while the same function captures to Sentry",
        why: `This catch ('${caught}') only console-warns, while other failure paths in the same function capture to Sentry. Failure classes that land in the catch (network/timeout/parse) get zero alerting signal — the exact PR #320 gap (non-2xx → Sentry, catch → console.warn for weeks).`,
        fix: "Capture this catch's error to Sentry too (Sentry.captureException/captureMessage with operation tags), matching the function's other failure branches.",
      });
    });

    return findings;
  },
};

/**
 * R11 — Success-guarded persistence.
 *
 * `if (result.length > 0) { persist(result) }` treats a valid empty
 * computed result as "nothing to save", so the cache/DB row never exists and
 * every subsequent request recomputes (PR #322: `if (insights.length > 0)`
 * around the stance-relations write-through → paid recompute on every cache
 * expiry for legitimately-empty results).
 *
 * False-positive control: fires only on the write-through shape — an
 * `.update(...)` on a Supabase table or a Redis SET inside the guard. An
 * empty-batch `.insert()` guard is a legitimate pattern and is NOT flagged
 * (there is genuinely nothing to insert); an empty-result update skip is the
 * bug (the correct write is "empty result" itself).
 */
export const SuccessGuardedPersistenceRule: Rule = {
  name: "success-guarded-persistence",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(ctx.filePath);
    if (isTestFile(filePath)) return findings;

    source.forEachDescendant((node) => {
      if (!Node.isIfStatement(node)) return;
      const condText = node.getExpression().getText().trim();
      const condMatch = /^([\w$.]+)\.length\s*>\s*0$/.exec(condText);
      if (!condMatch) return;
      const thenText = node.getThenStatement().getText();
      const isWriteThrough = /\.update\(/.test(thenText) || /setRedisValue\(/.test(thenText);
      if (!isWriteThrough) return;

      findings.push({
        file: filePath,
        severity: "medium",
        title: `Reliability: persistence skipped on empty result ('${condMatch[1]}.length > 0')`,
        why: `An .update()/Redis write-through is gated on '${condText}'. A valid empty result skips the write, so no cached/persisted value ever exists for that state and every later request recomputes (PR #322: empty stance-relations → paid recompute on every cache expiry).`,
        fix: "Persist the empty result too (it is a valid terminal state), or add an explicit tombstone/negative-cache marker instead of skipping the write entirely.",
      });
    });

    return findings;
  },
};
