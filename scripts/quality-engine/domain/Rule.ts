import type { Finding } from "./Finding";
import type { SourceGraph } from "./SourceGraph";

export type RuleScope = "file" | "neighbors" | "graph";

export interface RuleContext {
  filePath: string;
  ast: any; // ts-morph SourceFile, adapted by infra
  graph?: SourceGraph;
  // Every file in the current scan (diff or full), regardless of rule scope.
  // Lets a file-scoped rule ask "is there a sibling test file in this same
  // scan?" without needing graph/neighbors traversal — e.g.
  // SecurityFixWithoutTestRule checks this to flag an authorization change
  // with no corresponding test file touched in the same diff.
  allFiles?: string[];
}

export interface Rule {
  name: string;
  scope?: RuleScope; // default = "file"
  // Most rules are excluded from scripts/quality-engine/rules/** and
  // scripts/verify-quality-engine.ts to suppress self-analysis false
  // positives (see QualityEngine.analyze). A rule that specifically audits
  // the quality-engine's own rule files (e.g. UnregisteredRuleExportRule)
  // must opt in here, or it silently never runs against its own target.
  allowSelfAnalysis?: boolean;
  check(ctx: RuleContext): Finding[];
}
