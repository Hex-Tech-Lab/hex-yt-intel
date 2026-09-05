import type { Finding } from "./Finding";
import type { SourceGraph } from "./SourceGraph";

export type RuleScope = "file" | "neighbors" | "graph";

export interface RuleContext {
  filePath: string;
  ast: any; // ts-morph SourceFile, adapted by infra
  graph?: SourceGraph;
}

export interface Rule {
  name: string;
  scope?: RuleScope; // default = "file"
  check(ctx: RuleContext): Finding[];
}
