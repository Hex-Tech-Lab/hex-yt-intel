import type { CalibrationExample } from "./types";

export class SardCalibrationIngester {
  /**
   * Load reference test cases modeled after SARD/Juliet benchmarks.
   * Juliet features paired bad (vulnerable) and good (remediated) code units.
   */
  public ingestExamples(): CalibrationExample[] {
    return [
      {
        sourceName: "SARD / Juliet Test Suite",
        externalId: "SARD-CWE22-01-BAD",
        filePath: "sard_cwe22_bad.ts",
        codeSnippet: `
          import * as path from 'path';
          import * as fs from 'fs';
          export function loadUserData(userInput: string) {
            const resolved = path.join('/var/data', userInput);
            return fs.readFileSync(resolved, 'utf8');
          }
        `,
        expectedOutcome: "finding",
        issueCategory: "path-traversal",
        expectedSeverity: "high",
        metadata: { cwe: "CWE-22", context: "path.join / path.resolve user input vulnerability" }
      },
      {
        sourceName: "SARD / Juliet Test Suite",
        externalId: "SARD-CWE22-01-GOOD",
        filePath: "sard_cwe22_good.ts",
        codeSnippet: `
          import * as path from 'path';
          import * as fs from 'fs';
          export function loadUserDataClean(userInput: string) {
            const sanitized = userInput.replace(/\\.\\.(?:\\/|\\\\|$)/g, "");
            const resolved = path.join('/var/data', sanitized);
            return fs.readFileSync(resolved, 'utf8');
          }
        `,
        expectedOutcome: "clean",
        issueCategory: "path-traversal",
        expectedSeverity: "high",
        metadata: { cwe: "CWE-22", context: "sanitized path resolution" }
      },
      {
        sourceName: "SARD / Juliet Test Suite",
        externalId: "SARD-CWE259-01-BAD",
        filePath: "sard_cwe259_bad.ts",
        codeSnippet: `
          export class DatabaseConnector {
            private dbPass = "SuperSecretAdminPassword123!";
            public connect() {
              return "connected with " + this.dbPass;
            }
          }
        `,
        expectedOutcome: "finding",
        issueCategory: "hardcoded-secret",
        expectedSeverity: "critical",
        metadata: { cwe: "CWE-259", context: "hardcoded password assignments" }
      },
      {
        sourceName: "SARD / Juliet Test Suite",
        externalId: "SARD-CWE259-01-GOOD",
        filePath: "sard_cwe259_good.ts",
        codeSnippet: `
          export class DatabaseConnectorClean {
            private dbPass = process.env.DATABASE_PASSWORD;
            public connect() {
              if (!this.dbPass) throw new Error("Missing password");
              return "connected with env password";
            }
          }
        `,
        expectedOutcome: "clean",
        issueCategory: "hardcoded-secret",
        expectedSeverity: "critical",
        metadata: { cwe: "CWE-259", context: "environment variables configuration" }
      }
    ];
  }
}
