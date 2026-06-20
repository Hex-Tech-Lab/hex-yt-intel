import { registerSecurityRules } from "./security";

export class SecurityRuleEngine {
  registerRules(engine: any) {
    registerSecurityRules(engine);
  }
}
