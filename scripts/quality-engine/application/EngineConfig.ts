import type { RuleScope } from "../domain/Rule";

export type AnalysisMode = "diff" | "full";

export interface EngineConfig {
  /** Repo-wide tracked files, passed through to rules as ctx.scanWideFiles. */
  scanWideFiles?: string[];
  mode: AnalysisMode;
  defaultScope?: RuleScope; // default "file"
  concurrency?: number; // default 3
}
