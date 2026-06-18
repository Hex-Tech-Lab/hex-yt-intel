import { QualityIntelligenceEngine } from "./scripts/quality-engine/engine";
import { 
    SanitizationRule,
    SecretsExposureRule,
    AuthSecurityRule,
    ErrorTaxonomyRule,
    CrossPlatformRule,
    StreamResilienceRule,
} from "./scripts/quality-engine/rules";
import * as glob from "glob";

const engine = new QualityIntelligenceEngine(process.cwd());

engine.addRule(SanitizationRule);
engine.addRule(SecretsExposureRule);
engine.addRule(AuthSecurityRule);
engine.addRule(ErrorTaxonomyRule);
engine.addRule(CrossPlatformRule);
engine.addRule(StreamResilienceRule);

const files = glob.sync('{web,worker}/**/*.{ts,tsx}', { ignore: '**/node_modules/**' }).map(f => f.replace(/\\/g, "/"));
const findings = engine.analyze(files);
console.log(JSON.stringify(findings, null, 2));
