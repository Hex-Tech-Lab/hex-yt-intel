/**
 * scripts/strict-merge.sh gates merges, so its refusal paths are tested with a
 * stubbed `gh` on PATH (no network, no real PR).
 */
import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../strict-merge.sh");

function runWithGh(prJson: object, args: string[]) {
  const bin = mkdtempSync(path.join(tmpdir(), "gh-stub-"));
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
case "$1 $2" in
  "repo view") echo "o/n" ;;
  "pr view") cat <<'JSON'
${JSON.stringify(prJson)}
JSON
  ;;
  "api graphql") echo '{"data":{"repository":{"pullRequest":{"reviewThreads":{"pageInfo":{"hasNextPage":false},"nodes":[]}}}}}' ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`
  );
  chmodSync(gh, 0o755);
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

const OPEN_PR = { state: "OPEN", isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", headRefOid: "abc", title: "t" };

describe("strict-merge.sh", () => {
  test("refuses a PR that reports no status checks at all", () => {
    const r = runWithGh({ ...OPEN_PR, statusCheckRollup: [] }, ["123"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("no status checks reported");
  });

  test("rejects a non-numeric PR argument", () => {
    const r = runWithGh({ ...OPEN_PR, statusCheckRollup: [] }, ["abc"]);
    expect(r.status).toBe(1);
  });

  test("rejects an unknown flag", () => {
    const r = runWithGh({ ...OPEN_PR, statusCheckRollup: [] }, ["123", "--yolo"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unknown flag");
  });
  const PASSING = [{ name: "CI", conclusion: "SUCCESS" }];

  test("draft PR is gated normally (passes when clean)", () => {
    const r = runWithGh({ ...OPEN_PR, isDraft: true, mergeStateStatus: "DRAFT", statusCheckRollup: PASSING }, ["123"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("NOTE: PR is a draft");
    expect(r.stdout).toContain("GATE PASSED");
  });

  test("draft PR refuses --merge", () => {
    const r = runWithGh({ ...OPEN_PR, isDraft: true, mergeStateStatus: "DRAFT", statusCheckRollup: PASSING }, ["123", "--merge"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("--merge refused: PR is a draft");
  });

  test("merged PR runs in audit mode and is clean when nothing is left", () => {
    const r = runWithGh({ ...OPEN_PR, state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", statusCheckRollup: PASSING }, ["123"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("AUDIT CLEAN");
  });

  test("merged PR audit reports failing checks left behind", () => {
    const r = runWithGh({ ...OPEN_PR, state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", statusCheckRollup: [{ name: "Lint", conclusion: "FAILURE" }] }, ["123"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("AUDIT FOUND 1 item(s)");
  });
});
