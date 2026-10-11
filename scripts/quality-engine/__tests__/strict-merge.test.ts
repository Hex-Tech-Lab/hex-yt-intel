/**
 * scripts/strict-merge.sh gates merges, so its refusal paths are tested with a
 * stubbed `gh` on PATH (no network, no real PR).
 */
import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "../../strict-merge.sh");

const NO_THREADS = { nodes: [], hasNextPage: false };
type Threads = { nodes: object[]; hasNextPage?: boolean };
const threadsJson = (t: Threads) =>
  JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: t.hasNextPage ?? false }, nodes: t.nodes } } } } });

// threads: reply to the first graphql call; lateThreads: reply to the second
// (the pre-merge re-check). `gh pr merge` args are logged to <bin>/merge.log.
function runWithGh(prJson: object, args: string[], threads: Threads = NO_THREADS, lateThreads: Threads = threads) {
  const bin = mkdtempSync(path.join(tmpdir(), "gh-stub-"));
  const gh = path.join(bin, "gh");
  writeFileSync(path.join(bin, "t1.json"), threadsJson(threads));
  writeFileSync(path.join(bin, "t2.json"), threadsJson(lateThreads));
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
case "$1 $2" in
  "repo view") echo "o/n" ;;
  "pr view") cat <<'JSON'
${JSON.stringify(prJson)}
JSON
  ;;
  "api graphql")
    n=1; [ -f "${bin}/called" ] && n=2; touch "${bin}/called"
    if [[ " $* " == *" --jq "* ]]; then
      jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length' "${bin}/t$n.json"
    else cat "${bin}/t$n.json"; fi ;;
  "pr merge") echo "$*" > "${bin}/merge.log" ;;
  *) echo "unexpected gh call: $*" >&2; exit 9 ;;
esac
`
  );
  chmodSync(gh, 0o755);
  const result = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  const mergeLog = path.join(bin, "merge.log");
  return { ...result, mergeArgs: existsSync(mergeLog) ? readFileSync(mergeLog, "utf8") : null };
}

const OPEN_PR = { state: "OPEN", isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", headRefOid: "abc", title: "t" };

describe("strict-merge.sh", () => {
  test("refuses a PR that reports no status checks at all", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: [] }, ["123"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("no status checks reported");
  });

  test("rejects a non-numeric PR argument", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: [] }, ["abc"]);
    expect(result.status).toBe(1);
  });

  test("rejects an unknown flag", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: [] }, ["123", "--yolo"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown flag");
  });
  const PASSING = [{ name: "CI", conclusion: "SUCCESS" }];

  test("draft PR is gated normally (passes when clean)", () => {
    const result = runWithGh({ ...OPEN_PR, isDraft: true, mergeStateStatus: "DRAFT", statusCheckRollup: PASSING }, ["123"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("NOTE: PR is a draft");
    expect(result.stdout).toContain("GATE PASSED");
  });

  test("draft PR refuses --merge", () => {
    const result = runWithGh({ ...OPEN_PR, isDraft: true, mergeStateStatus: "DRAFT", statusCheckRollup: PASSING }, ["123", "--merge"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("--merge refused: PR is a draft");
  });

  test("merged PR runs in audit mode and is clean when nothing is left", () => {
    const result = runWithGh({ ...OPEN_PR, state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", statusCheckRollup: PASSING }, ["123"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AUDIT CLEAN");
  });

  test("merged PR audit reports failing checks left behind", () => {
    const result = runWithGh({ ...OPEN_PR, state: "MERGED", mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", statusCheckRollup: [{ name: "Lint", conclusion: "FAILURE" }] }, ["123"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AUDIT FOUND 1 item(s)");
  });

  const OPEN_THREAD = { nodes: [{ isResolved: false, path: "a.ts", line: 12 }] };

  test("refuses on an unresolved review thread and names it", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: PASSING }, ["123"], OPEN_THREAD);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("1 unresolved review thread(s)");
    expect(result.stdout).toContain("thread: a.ts:12");
  });

  test("refuses when more than 100 threads cannot be verified", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: PASSING }, ["123"], { nodes: [], hasNextPage: true });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("more than 100 review threads");
  });

  test("--merge squash-merges pinned to the gated head SHA", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: PASSING }, ["123", "--merge"]);
    expect(result.status).toBe(0);
    expect(result.mergeArgs).toContain("--squash");
    expect(result.mergeArgs).toContain("--match-head-commit abc");
  });

  test("--merge refuses a thread opened after the gate check", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: PASSING }, ["123", "--merge"], NO_THREADS, OPEN_THREAD);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("opened after the gate check");
    expect(result.mergeArgs).toBeNull();
  });

  test("--bypass passes a named failing check and prints it", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: [{ name: "Lint", conclusion: "FAILURE" }] }, ["123", "--bypass", "Lint"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("BYPASSED (explicit --bypass): Lint (FAILURE)");
  });

  test("--bypass of a different name still refuses the failing check", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: [{ name: "Lint", conclusion: "FAILURE" }] }, ["123", "--bypass", "Other"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("check not passing: Lint = FAILURE");
  });

  test("refuses a conflicting PR", () => {
    const result = runWithGh({ ...OPEN_PR, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", statusCheckRollup: PASSING }, ["123"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("mergeable is CONFLICTING");
    expect(result.stdout).toContain("mergeStateStatus is DIRTY");
  });

  test("a pending StatusContext row is not a pass", () => {
    const result = runWithGh({ ...OPEN_PR, statusCheckRollup: [{ context: "vercel", state: "PENDING" }] }, ["123"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("check not passing: vercel = PENDING");
  });
});
