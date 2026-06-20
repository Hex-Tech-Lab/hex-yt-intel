import type { CalibrationExample } from "./types";

/**
 * SOURCE-TO-PURPOSE CALIBRATION MAPPING (Calibration-only):
 * - Juliet / SARD: Ground-truth calibration / security patterns (e.g. CWE-22, CWE-259)
 * - CRBench: Review / performance / noise-suppression calibration (e.g. React transitions, layout rendering)
 * - Big-Vul / Devign: Vulnerability-shape calibration (e.g. CWE-89 SQL Injection)
 *
 * NOTE: All sources in this ingester are CALIBRATION-ONLY and do not affect live runtime/PR scans.
 */
export class SardCalibrationIngester {
  /**
   * Load reference test cases modeled after SARD/Juliet, CRBench, and Big-Vul/Devign benchmarks.
   * Features paired bad (vulnerable/violating) and good (remediated) code units.
   */
  public ingestExamples(): CalibrationExample[] {
    return [
      // --- Juliet / SARD ---
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
      },

      // --- CRBench ---
      {
        sourceName: "CRBench",
        externalId: "CRB-RERENDER-01-BAD",
        filePath: "crb_rerender_bad.tsx",
        codeSnippet: `
          import React, { useState } from 'react';
          export function HoverDashboardComponent() {
            const [hovered, setHovered] = useState(false);
            return (
              <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
                {hovered && <span>Complex Visualization Rendered Directly inside hover</span>}
              </div>
            );
          }
        `,
        expectedOutcome: "finding",
        issueCategory: "hover-re-render",
        expectedSeverity: "medium",
        metadata: { cwe: "N/A", context: "performance/rendering trigger on hover" }
      },
      {
        sourceName: "CRBench",
        externalId: "CRB-RERENDER-01-GOOD",
        filePath: "crb_rerender_good.tsx",
        codeSnippet: `
          import React, { useState, useTransition } from 'react';
          export function HoverDashboardComponentClean() {
            const [hovered, setHovered] = useState(false);
            const [isPending, startTransition] = useTransition();
            
            const handleHover = (state: boolean) => {
              startTransition(() => {
                setHovered(state);
              });
            };
            return (
              <div onMouseEnter={() => handleHover(true)} onMouseLeave={() => handleHover(false)}>
                {hovered && <span>Optimized Transition Rendering</span>}
              </div>
            );
          }
        `,
        expectedOutcome: "clean",
        issueCategory: "hover-re-render",
        expectedSeverity: "medium",
        metadata: { cwe: "N/A", context: "remediation using React Transitions" }
      },

      // --- Big-Vul / Devign ---
      {
        sourceName: "Big-Vul / Devign",
        externalId: "BIGVUL-SQLI-01-BAD",
        filePath: "bigvul_sqli_bad.ts",
        codeSnippet: `
          export async function getUserProfile(userId: string, dbClient: any) {
            const query = "SELECT * FROM users WHERE id = '" + userId + "'";
            return dbClient.execute(query);
          }
        `,
        expectedOutcome: "finding",
        issueCategory: "sql-injection",
        expectedSeverity: "critical",
        metadata: { cwe: "CWE-89", context: "string concatenation SQL injection" }
      },
      {
        sourceName: "Big-Vul / Devign",
        externalId: "BIGVUL-SQLI-01-GOOD",
        filePath: "bigvul_sqli_good.ts",
        codeSnippet: `
          export async function getUserProfileClean(userId: string, dbClient: any) {
            const query = "SELECT * FROM users WHERE id = $1";
            return dbClient.execute(query, [userId]);
          }
        `,
        expectedOutcome: "clean",
        issueCategory: "sql-injection",
        expectedSeverity: "critical",
        metadata: { cwe: "CWE-89", context: "parameterized query remediation" }
      }
    ];
  }
}
