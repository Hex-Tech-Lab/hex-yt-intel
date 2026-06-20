import { registerSecurityRules } from "./security";

export class SecurityRuleEngine {
  registerRules(engine: unknown) {
    registerSecurityRules(engine);
  }
}
