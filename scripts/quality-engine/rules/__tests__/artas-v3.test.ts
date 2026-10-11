import { describe, test, expect } from "vitest";
import { Project } from "ts-morph";
import * as legacyRules from "../index";
import type { Rule } from "../../domain/Rule";
import {
  UnconsumedStreamLeakRule,
  UnboundedBodyReadRule,
  NonIdempotentRetryRule,
  FailOpenUndefinedFilterRule,
} from "../artas-v3";

const project = new Project({ useInMemoryFileSystem: true });

function check(rule: Rule, filePath: string, content: string) {
  const sf = project.createSourceFile(filePath, content, { overwrite: true });
  return rule.check({ filePath, ast: sf, allFiles: [filePath] });
}

// Positive snippets mirror the historical incident shapes cited in
// .memory/ARTAS_REGISTRY.md; negative controls are the fixed/safe shapes.

describe("UnconsumedStreamLeakRule (V20)", () => {
  test("positive: !res.ok early return without body cancel", () => {
    const findings = check(
      UnconsumedStreamLeakRule,
      "web/lib/adapters/some-fetcher.ts",
      `
      export async function getThing(url: string) {
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error("bad status " + res.status);
        }
        return res.json();
      }
      `,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]?.title).toContain("V20");
    expect(findings[0]?.severity).toBe("medium");
  });

  test("negative control: body already consumed before the branch", () => {
    const findings = check(
      UnconsumedStreamLeakRule,
      "web/lib/api-client.ts",
      `
      export async function apiCall(url: string) {
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) {
          throw new Error("bad status " + res.status);
        }
        return data;
      }
      `,
    );
    expect(findings.length).toBe(0);
  });

  test("positive: res.status === 500 throw without cancel", () => {
    const findings = check(
      UnconsumedStreamLeakRule,
      "web/lib/adapters/other-fetcher.ts",
      `
      export async function getThing(url: string) {
        const res = await fetch(url);
        if (res.status === 500) {
          return null;
        }
        return res.json();
      }
      `,
    );
    expect(findings.length).toBe(1);
  });

  test("negative control: branch cancels the body before throwing", () => {
    const findings = check(
      UnconsumedStreamLeakRule,
      "web/lib/adapters/some-fetcher.ts",
      `
      export async function getThing(url: string) {
        const res = await fetch(url);
        if (!res.ok) {
          await res.body?.cancel();
          throw new Error("bad status");
        }
        return res.json();
      }
      `,
    );
    expect(findings.length).toBe(0);
  });

  test("negative control: branch drains the body via text()", () => {
    const findings = check(
      UnconsumedStreamLeakRule,
      "web/lib/adapters/some-fetcher.ts",
      `
      export async function getThing(url: string) {
        const res = await fetch(url);
        if (!res.ok) {
          await res.text();
          return null;
        }
        return res.json();
      }
      `,
    );
    expect(findings.length).toBe(0);
  });
});

describe("UnboundedBodyReadRule (V10)", () => {
  test("positive: arrayBuffer with no byte-limit evidence", () => {
    const findings = check(
      UnboundedBodyReadRule,
      "web/lib/services/doc-fetcher.ts",
      `
      export async function readDoc(url: string) {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        return decode(buf);
      }
      `,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]?.title).toContain("V10");
    expect(findings[0]?.severity).toBe("medium");
  });

  test("negative control: content-length cap checked before read", () => {
    const findings = check(
      UnboundedBodyReadRule,
      "web/lib/services/doc-fetcher.ts",
      `
      export async function readDoc(url: string) {
        const res = await fetch(url);
        const len = Number(res.headers.get('content-length') ?? '0');
        if (len > 5_000_000) throw new Error('too large');
        const buf = await res.arrayBuffer();
        return decode(buf);
      }
      `,
    );
    expect(findings.length).toBe(0);
  });

  test("negative control: hard-coded first-party YouTube fetch", () => {
    const findings = check(
      UnboundedBodyReadRule,
      "web/lib/services/ythumb.ts",
      `
      export async function readThumb() {
        const res = await fetch("https://i.ytimg.com/vi/abc/hqdefault.jpg");
        const buf = await res.arrayBuffer();
        return buf;
      }
      `,
    );
    expect(findings.length).toBe(0);
  });
});

describe("NonIdempotentRetryRule (V19)", () => {
  test("positive: while-loop retry with fetch and no method gate", () => {
    const findings = check(
      NonIdempotentRetryRule,
      "worker/src/lib/retry-fetch.ts",
      `
      export async function sendWithRetry(url: string, init: RequestInit) {
        let attempts = 0;
        while (attempts < 3) {
          try {
            return await fetch(url, init);
          } catch (e) {
            attempts++;
            await sleep(100 * attempts);
          }
        }
        throw new Error("exhausted");
      }
      `,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]?.title).toContain("V19");
    expect(findings[0]?.severity).toBe("high");
  });

  test("positive: recursive fetch retry", () => {
    const findings = check(
      NonIdempotentRetryRule,
      "worker/src/lib/recursive-retry.ts",
      `
      export async function tryFetch(url: string, n: number): Promise<Response> {
        try {
          return await fetch(url, { method: "POST" });
        } catch {
          if (n <= 0) throw new Error("exhausted");
          return tryFetch(url, n - 1);
        }
      }
      `,
    );
    expect(findings.length).toBe(1);
  });

  test("gate in a DIFFERENT function does not suppress (no cross-function flow): still fires", () => {
    const findings = check(
      NonIdempotentRetryRule,
      "worker/src/lib/retry-fetch.ts",
      `
      export async function sendWithRetry(url: string, method: string) {
        let attempts = 0;
        while (attempts < 3) {
          try {
            return await fetch(url, { method });
          } catch (e) {
            attempts++;
          }
        }
        throw new Error("exhausted");
      }
      // gate applied by callers / guard below
      if (method !== "GET" && method !== "HEAD") return fetch(url, { method });
      `,
    );
    // The loop itself is inside sendWithRetry; the guard text lives in the
    // same file but a different function — the rule's enclosing-function
    // scope means this shape still fires unless the gate is inside the
    // function. Rewrite: this test asserts the UNGATED loop fires once.
    expect(findings.length).toBe(1);
  });

  test("negative control: gate inside the function is honored", () => {
    const findings = check(
      NonIdempotentRetryRule,
      "worker/src/lib/retry-fetch-safe.ts",
      `
      export async function sendWithRetry(url: string, method: string) {
        if (method !== "GET" && method !== "HEAD") return fetch(url, { method });
        let attempts = 0;
        while (attempts < 3) {
          try {
            return await fetch(url, { method });
          } catch (e) {
            attempts++;
          }
        }
        throw new Error("exhausted");
      }
      `,
    );
    expect(findings.length).toBe(0);
  });
});

describe("FailOpenUndefinedFilterRule (V05)", () => {
  test("positive: optional parameter passed as filter value, no guard", () => {
    const findings = check(
      FailOpenUndefinedFilterRule,
      "web/lib/services/subgraph.ts",
      `
      export async function getSubgraph(userId?: string) {
        const { data } = await supabase
          .from("nodes")
          .select("*")
          .eq("owner_id", userId);
        return data;
      }
      `,
    );
    expect(findings.length).toBe(1);
    expect(findings[0]?.title).toContain("V05");
    expect(findings[0]?.severity).toBe("high");
  });

  test("positive: union-with-undefined parameter", () => {
    const findings = check(
      FailOpenUndefinedFilterRule,
      "web/lib/services/subgraph2.ts",
      `
      export async function getSubgraph(userId: string | undefined) {
        return supabase.from("nodes").select("*").in("owner_id", [userId]);
      }
      `,
    );
    expect(findings.length).toBe(1);
  });

  test("negative control: guarded with if (!x) throw", () => {
    const findings = check(
      FailOpenUndefinedFilterRule,
      "web/lib/services/subgraph.ts",
      `
      export async function getSubgraph(userId?: string) {
        if (!userId) throw new Error("missing userId");
        const { data } = await supabase
          .from("nodes")
          .select("*")
          .eq("owner_id", userId);
        return data;
      }
      `,
    );
    expect(findings.length).toBe(0);
  });

  test("negative control: required parameter, literal column", () => {
    const findings = check(
      FailOpenUndefinedFilterRule,
      "web/lib/services/subgraph3.ts",
      `
      export async function getSubgraph(userId: string) {
        return supabase.from("nodes").select("*").eq("owner_id", userId);
      }
      `,
    );
    expect(findings.length).toBe(0);
  });
});
