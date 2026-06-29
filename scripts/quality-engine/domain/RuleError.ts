export interface RuleError {
  ruleName: string;
  filePath: string;
  message: string;
  timestamp: number;
}

export interface AnalysisResult {
  findings: any[]; // Finding[]
  errors: RuleError[];
}
