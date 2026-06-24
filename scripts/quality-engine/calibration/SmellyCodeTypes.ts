export interface SmellyCodeExample {
  code: string;
  metrics: SmellyCodeMetrics;
  labels: SmellyCodeLabels;
}

export interface SmellyCodeMetrics {
  logicalLoc: number;
  cycloComplexity: number;
  basicCyclo: number;
  essentialCyclo: number;
  designCyclo: number;
  linesOfCode: number;
  numOperands: number;
  numOperators: number;
  distinctOperands: number;
  distinctOperators: number;
  effort: number;
  volume: number;
  difficulty: number;
  intelligence: number;
}

export interface SmellyCodeLabels {
  blob: boolean;
  dataClass: boolean;
  featureEnvy: boolean;
  godClass: boolean;
  longMethod: boolean;
  longParameterList: boolean;
}

export interface CalibrationMetricReport {
  example: SmellyCodeExample;
  predictedComplexityFlags: string[];
  actualLabels: SmellyCodeLabels;
  passed: boolean;
}