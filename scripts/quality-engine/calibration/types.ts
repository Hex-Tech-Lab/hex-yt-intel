export interface CalibrationExample {
  sourceName: string; // e.g. "SARD" / "CRBench"
  externalId: string; // e.g. "SARD-112" or issue number
  filePath: string;
  codeSnippet: string;
  expectedOutcome: "finding" | "clean";
  issueCategory: string; // e.g. "path-traversal", "hardcoded-secret", "unhandled-promise"
  expectedSeverity?: "critical" | "high" | "medium" | "low";
  metadata?: Record<string, unknown>;
}

export interface CalibrationResult {
  example: CalibrationExample;
  passed: boolean;
  actualFindings: number;
}
