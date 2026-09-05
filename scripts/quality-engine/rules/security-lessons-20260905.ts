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

/**
 * Lesson from the 2026-09-05 security-fix PR (#286, entitlements bypass +
 * get_temporal_subgraph IDOR): both fixes originally shipped with zero new
 * tests proving the removed bypass stays closed. External review (Cubic)
 * caught it; qa-intel did not. This rule mechanizes that catch.
 *
 * Heuristic: a non-test file whose text contains an authorization-relevant
 * marker (auth.uid(), is_founder/founder tier grants, SECURITY DEFINER
 * references in TS glue code, "bypass"/"HARDCODED_OWNER"-style identifiers)
 * is flagged UNLESS the current scan (ctx.allFiles -- the diff or full file
 * list, whichever mode is running) also contains at least one test file
 * whose path stem matches this file's stem (e.g. GetUserEntitlementsUseCase.ts
 * <-> get-user-entitlements*.test.ts / GetUserEntitlementsUseCase.test.ts).
 * This is a coarse same-diff heuristic, not proof the test actually covers
 * the changed branch -- it catches "shipped zero tests," not "shipped a
 * weak test."
 */
export const SecurityFixWithoutTestRule: Rule = {
  name: "security-fix-without-regression-test",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(source.getFilePath());

    if (isTestFile(filePath)) return findings;
    if (filePath.includes("/quality-engine/") || filePath.includes("verify-quality-engine")) return findings;

    const text = source.getText();
    const AUTH_MARKERS = [
      "auth.uid()",
      "auth.jwt()",
      "SECURITY DEFINER",
      "is_founder",
      "isFounder",
      "FOUNDER_USER_IDS",
      "ADMIN_FOUNDER_EMAILS",
      "getSession(",
      "getUser(",
    ];
    const hasAuthMarker = AUTH_MARKERS.some((m) => text.includes(m));
    if (!hasAuthMarker) return findings;

    const allFiles = ctx.allFiles ?? [];
    if (allFiles.length === 0) return findings; // no scan-wide context available (e.g. single-file invocation) -- don't false-positive

    // Derive a loose "stem" to match this file against a sibling test.
    // This repo's convention drops architectural-role suffixes in test
    // filenames (GetUserEntitlementsUseCase.ts -> get-user-entitlements.test.ts,
    // not get-user-entitlements-use-case.test.ts) -- verified against this
    // exact file's own real test on 2026-09-05. Try both the full stem and
    // the stem with a trailing architectural suffix word stripped.
    const base = filePath.split("/").pop() ?? filePath;
    const stem = base.replace(/\.(ts|tsx)$/, "");
    const ARCHITECTURAL_SUFFIXES = ["usecase", "adapter", "service", "route", "repository", "client", "component", "hook", "handler", "controller"];
    const toNormalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const candidateStems = [stem];
    for (const suffix of ARCHITECTURAL_SUFFIXES) {
      const normalizedFull = toNormalized(stem);
      if (normalizedFull.endsWith(suffix) && normalizedFull.length > suffix.length) {
        // Strip the suffix from the ORIGINAL-case stem, not the normalized
        // one, so case-boundary word-splitting below still works correctly.
        const suffixLen = suffix.length;
        candidateStems.push(stem.slice(0, stem.length - suffixLen));
        break; // at most one architectural suffix realistically applies
      }
    }
    const stemNormalizedVariants = candidateStems.map(toNormalized);

    const hasSiblingTest = allFiles.some((f) => {
      const norm = normalizePosixPath(f);
      if (!isTestFile(norm)) return false;
      const testBase = norm.split("/").pop() ?? norm;
      const testNormalized = toNormalized(testBase);
      return stemNormalizedVariants.some((v) => testNormalized.includes(v));
    });

    if (!hasSiblingTest) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Security: authorization-relevant change with no sibling test in this scan",
        why: `File contains an authorization/entitlement marker (${AUTH_MARKERS.find((m) => text.includes(m))}) but no test file matching this file's name was found in the current scan. A removed or changed authorization check with no regression test can be silently reintroduced later.`,
        fix: `Add or update a test file for ${base} (e.g. __tests__/${stemKebab}.test.ts) asserting the specific authorization branch this change touches, in the same PR.`,
      });
    }

    return findings;
  },
};

/**
 * Lesson from the same PR: DeepSource caught `valid[0]!` (a non-null
 * assertion on an array index immediately following a .sort()/.filter()
 * chain) -- a distinct, common pattern worth its own narrow rule instead of
 * relying on an external tool per-PR.
 */
export const NonNullAfterArraySortFilterRule: Rule = {
  name: "non-null-assertion-after-array-transform",
  scope: "file",
  check: (ctx: RuleContext) => {
    const source = ctx.ast as SourceFile;
    const findings: Finding[] = [];
    const filePath = normalizePosixPath(source.getFilePath());

    source.forEachDescendant((node) => {
      if (!Node.isNonNullExpression(node)) return;
      const inner = node.getExpression();
      if (!Node.isElementAccessExpression(inner)) return;

      const objectExpr = inner.getExpression();
      const objectText = objectExpr.getText();

      // Walk back through preceding sibling statements in the same block for
      // a `.sort(` or `.filter(` call on the same identifier -- a coarse but
      // low-false-positive signal that this array's "definitely has an
      // element" assumption came from a runtime transform, not a literal.
      const block = node.getFirstAncestorByKind(SyntaxKind.Block);
      if (!block) return;
      const blockText = block.getText();
      const sortOrFilterPattern = new RegExp(
        `${objectText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*[\\s\\S]*?\\.(sort|filter)\\(`,
      );
      if (!sortOrFilterPattern.test(blockText)) return;

      findings.push({
        file: filePath,
        severity: "medium",
        title: "Risk: non-null assertion on array index after sort/filter",
        why: `${node.getText()} asserts a result exists after a .sort()/.filter() transform on '${objectText}'. A future refactor that changes the filter predicate (e.g. widening it to allow an empty result) will not be caught by the type system and can throw or silently produce 'undefined' at runtime.`,
        fix: `Replace with an explicit check: const first = ${objectText}[0]; if (!first) { /* handle empty case */ }`,
      });
    });

    return findings;
  },
};
