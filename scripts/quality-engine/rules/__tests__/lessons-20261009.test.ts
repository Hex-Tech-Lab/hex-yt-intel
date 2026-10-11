import { describe, test, expect } from "vitest";
import { Project } from "ts-morph";
import * as legacyRules from "../index";
import { StreamReaderWithoutFinallyRule, UnregisteredSettingsKeyRule } from "../lessons-20261009";
import type { Rule } from "../../domain/Rule";

// Settings-key checks read the real supabase/migrations manifest, so these tests
// run from the repo root (the same directory the engine uses).
function run(rule: Rule, code: string, filePath = "web/lib/example.ts") {
  const project = new Project({ useInMemoryFileSystem: true });
  const ast = project.createSourceFile(filePath, code);
  return rule.check({ filePath, ast });
}

describe("StreamReaderWithoutFinallyRule", () => {
  test("flags a getReader() with no finally that releases it", () => {
    const findings = run(StreamReaderWithoutFinallyRule, `
      export async function drain(res: Response) {
        const reader = res.body!.getReader();
        const first = await reader.read();
        return first;
      }`);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("Stream reader not released in a finally block");
  });

  test("passes when a finally releases the lock", () => {
    const findings = run(StreamReaderWithoutFinallyRule, `
      export async function drain(res: Response) {
        const reader = res.body!.getReader();
        try {
          return await reader.read();
        } finally {
          reader.releaseLock();
        }
      }`);
    expect(findings).toHaveLength(0);
  });

  test("passes when a finally cancels the reader", () => {
    const findings = run(StreamReaderWithoutFinallyRule, `
      export async function drain(res: Response) {
        const reader = res.body!.getReader();
        try {
          return await reader.read();
        } finally {
          await reader.cancel();
        }
      }`);
    expect(findings).toHaveLength(0);
  });

  test("ignores test files", () => {
    const findings = run(StreamReaderWithoutFinallyRule, `const r = body.getReader();`, "web/lib/__tests__/x.test.ts");
    expect(findings).toHaveLength(0);
  });
});

describe("UnregisteredSettingsKeyRule", () => {
  test("flags a *_KEY constant that names an unregistered key under a registry prefix", () => {
    const findings = run(UnregisteredSettingsKeyRule, `export const CAP_KEY = 'analysis.layer2.priorPayloadMaxBytess';`);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe("Settings key not registered in setting_definitions");
  });

  test("flags an unregistered `as const` key constant (the shape the epistemic retry key uses)", () => {
    const findings = run(UnregisteredSettingsKeyRule, `export const RETRY_KEY = 'analysis.pipeline.retry.epistemc' as const;`);
    expect(findings).toHaveLength(1);
  });

  test("passes a *_KEY constant that is registered in a migration", () => {
    const findings = run(UnregisteredSettingsKeyRule, `export const CAP_KEY = 'analysis.layer2.priorPayloadMaxBytes';`);
    expect(findings).toHaveLength(0);
  });

  test("ignores dotted strings whose prefix is not a registry prefix", () => {
    const findings = run(UnregisteredSettingsKeyRule, `export const LOG_KEY = 'somewhere.else.entirely';`);
    expect(findings).toHaveLength(0);
  });

  test("flags an unregistered literal passed to a registry-style call", () => {
    const findings = run(UnregisteredSettingsKeyRule, `resolveSettings(['analysis.pipeline.epistmic']);`);
    expect(findings).toHaveLength(1);
  });

  test("ignores test files", () => {
    const findings = run(UnregisteredSettingsKeyRule, `export const RETRY_KEY = 'analysis.pipeline.retry.epistemc';`, "web/lib/__tests__/x.test.ts");
    expect(findings).toHaveLength(0);
  });
});

describe("lessons-20261009 rules — production registration", () => {
  test("both rules are exported through the production registration set", () => {
    const registered = Object.values(legacyRules);
    expect(registered).toContain(StreamReaderWithoutFinallyRule);
    expect(registered).toContain(UnregisteredSettingsKeyRule);
  });

  test("both rules use the file scope the engine dispatches on", () => {
    for (const rule of [StreamReaderWithoutFinallyRule, UnregisteredSettingsKeyRule]) {
      expect((rule as { scope?: string }).scope).toBe("file");
    }
  });
});
