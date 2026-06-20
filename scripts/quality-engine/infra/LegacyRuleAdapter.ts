import type { Rule, RuleContext } from "../domain/Rule";
import type { Finding } from "../domain/Finding";

// Define a structural interface for the legacy IRule to avoid circular dependency
export interface LegacyIRule {
  name: string;
  check: (source: any) => Finding[];
}

export function wrapLegacyRule(legacyRule: LegacyIRule): Rule {
  return {
    name: legacyRule.name,
    scope: "file",
    check(ctx: RuleContext): Finding[] {
      return legacyRule.check(ctx.ast);
    }
  };
}
