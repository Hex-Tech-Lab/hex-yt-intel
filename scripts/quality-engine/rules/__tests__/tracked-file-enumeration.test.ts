import { describe, test, expect } from "vitest";
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { listTrackedFiles, selectScannableTextFiles, isSqlMigration } from "../../infra/TrackedFileEnumeration";

// R12 round 2 (2026-09-25): full-mode text-file enumeration policy.
// These tests run against the REAL repo checkout (they invoke the real
// `git ls-files -z`), asserting the policy surface the dispatch mandated:
// hidden dirs (.memory/), another hidden dir (.github/), untracked exclusion.

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

describe("TrackedFileEnumeration (R12 round 2)", () => {
  test("lists real tracked files, POSIX-normalized, incl. hidden dirs", () => {
    const files = listTrackedFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(".memory/AGENT_LEDGER.md");
    expect(files).toContain(".github/workflows/ci-cd.yml");
  });

  test("hidden-dir tracked text files pass the text-extension policy (.memory/AGENT_LEDGER.md)", () => {
    const selected = selectScannableTextFiles(listTrackedFiles(REPO_ROOT));
    expect(selected).toContain(".memory/AGENT_LEDGER.md");
  });

  test("another hidden dir's tracked text files pass the policy (.github/workflows/*.yml, .github/SECURITY.md)", () => {
    const selected = selectScannableTextFiles(listTrackedFiles(REPO_ROOT));
    expect(selected).toContain(".github/workflows/ci-cd.yml");
    expect(selected).toContain(".github/SECURITY.md");
  });

  test("never lists untracked files (git ls-files lists the index only)", () => {
    mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
    const probeName = "r12-untracked-probe.md";
    writeFileSync(join(REPO_ROOT, ".scratch", probeName), "deliberately untracked probe\n");
    const files = listTrackedFiles(REPO_ROOT);
    expect(files).not.toContain(`.scratch/${probeName}`);
    expect(selectScannableTextFiles(files)).not.toContain(`.scratch/${probeName}`);
  });

  test("policy excludes pnpm-lock.yaml (generated lockfile denylist)", () => {
    const files = listTrackedFiles(REPO_ROOT);
    expect(files).toContain("pnpm-lock.yaml");
    expect(selectScannableTextFiles(files)).not.toContain("pnpm-lock.yaml");
  });

  test("supabase/migrations/*.sql are NOT selected into the text-only pass (code routing preserved)", () => {
    const tracked = listTrackedFiles(REPO_ROOT).filter(isSqlMigration);
    expect(tracked.length).toBeGreaterThan(0);
    const selected = selectScannableTextFiles(listTrackedFiles(REPO_ROOT));
    for (const migration of tracked) {
      expect(selected).not.toContain(migration);
    }
  });

  test("non-text tracked files (e.g. .ts) are not selected into the text pass", () => {
    const selected = selectScannableTextFiles(listTrackedFiles(REPO_ROOT));
    expect(selected.every((f) => /\.(md|mdx|sql|json|ya?ml|sh|txt)$/.test(f))).toBe(true);
  });
});