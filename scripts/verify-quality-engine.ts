import { QualityIntelligenceEngine } from "./quality-engine/engine";
import { SecurityRuleEngine } from "./quality-engine/rules/SecurityRuleEngine";
import { StreamingRuleEngine } from "./quality-engine/rules/StreamingRuleEngine";
import { UIRuleEngine } from "./quality-engine/rules/UIRuleEngine";
import { ArchitectureRuleEngine } from "./quality-engine/rules/ArchitectureRuleEngine";
import { PersistenceRuleEngine } from "./quality-engine/rules/PersistenceRuleEngine";
import * as glob from "glob";

const engine = new QualityIntelligenceEngine(process.cwd());

const securityAgent = new SecurityRuleEngine();
securityAgent.registerRules(engine);

const streamingAgent = new StreamingRuleEngine();
streamingAgent.registerRules(engine);

const uiAgent = new UIRuleEngine();
uiAgent.registerRules(engine);

const architectureAgent = new ArchitectureRuleEngine();
architectureAgent.registerRules(engine);

const persistenceAgent = new PersistenceRuleEngine();
persistenceAgent.registerRules(engine);

const files = glob.sync('{web,worker}/**/*.{ts,tsx}', { ignore: '**/node_modules/**' }).map(f => f.replace(/\\/g, "/"));

if (files.length === 0) {
  console.error('❌ Quality Intelligence Engine: No files found to scan.');
  process.exit(1);
}

const findings = engine.analyze(files);

const criticalFindings = findings.filter(f => f.severity === 'critical');
if (criticalFindings.length > 0) {
  console.error('❌ Quality Intelligence Engine: Critical issues found:');
  console.error(JSON.stringify(criticalFindings, null, 2));
  
  const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
  const strictMode = process.env.STRICT_QUALITY_ENGINE === 'true';
  
  if (isCI || strictMode) {
    console.error('❌ Quality Intelligence Engine: Blocking — critical findings must be resolved in CI/strict mode.');
    process.exit(1);
  } else {
    console.warn('⚠️ Quality Intelligence Engine: Warning only (local/non-CI). Please resolve critical findings before final merge.');
    process.exit(0);
  }
}

const nonCritical = findings.filter(f => f.severity !== 'critical');
if (nonCritical.length > 0) {
  console.warn('⚠️ Quality Intelligence Engine: Medium/Low issues found:');
  console.warn(JSON.stringify(nonCritical, null, 2));
  console.error('✅ No critical issues. Medium/low findings listed above.');
  process.exit(0);
}

console.log('✅ Quality Intelligence Engine: No issues found.');
process.exit(0);