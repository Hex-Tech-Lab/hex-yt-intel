import { Node, SyntaxKind, SourceFile, ScriptKind } from "ts-morph";
import { Finding, IRule } from "./engine";

// 1. Hexagonal Boundary Rule
export const HexagonalBoundaryRule: IRule = {
  name: "hexagonal-boundary-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const isAdapter = filePath.includes("/adapters/");
    
    if (!isAdapter) {
      source.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
          const expression = node.getExpression();
          const text = expression.getText();
          if (text === "getSupabaseClient" || text.endsWith(".getSupabaseClient")) {
            findings.push({
              file: filePath,
              severity: "critical",
              title: "Boundary Violation: Direct Supabase Access",
              why: "Direct DB access outside of /adapters/ violates Hexagonal Lite architecture.",
              fix: "Move this logic into a dedicated Adapter port."
            });
          }
        }
      });
    }
    return findings;
  }
};

// 2. Security Rule
export const CredentialLeakRule: IRule = {
    name: "credential-leak-detector",
    check: (source: SourceFile) => {
      const findings: Finding[] = [];
      const filePath = source.getFilePath().replace(/\\/g, "/");
      const FORBIDDEN_IDS = ['test-user-id', 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb'];
      
      source.forEachDescendant((node) => {
        if (Node.isStringLiteral(node) && FORBIDDEN_IDS.includes(node.getLiteralText())) {
          findings.push({
            file: filePath,
            severity: "critical",
            title: "Security: Hardcoded Sensitive ID",
            why: "Hardcoded test/admin IDs detected in source code.",
            fix: "Use environment-based feature flags (e.g., process.env.TEST_USER_BYPASS_ID)."
          });
        }
      });
      return findings;
    }
};

// 3. Workflow Rule (Robust AST check, no loose promises)
export const WorkflowRule: IRule = {
  name: "workflow-safety-check",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    
    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression();
        const text = expr.getText();
        
        // Robust name checking instead of generic regex
        const isIOCall = ["fetch", "writeFile", "exec", "execSync"].some(name => 
           text === name || text.endsWith(`.${name}`)
        );

        if (isIOCall) {
          // 1. Check for try/finally
          const tryStatement = node.getFirstAncestorByKind(SyntaxKind.TryStatement);
          const hasFinally = tryStatement?.getFinallyBlock();

          if (!hasFinally) {
            findings.push({
              file: filePath,
              severity: "medium",
              title: "Workflow: Missing finally block for I/O",
              why: `Risky I/O call '${text}' detected without an explicit finally block.`,
              fix: "Ensure all I/O operations are wrapped in a try/finally block to guarantee resource cleanup."
            });
          }

          // 2. Check for loose promises (unawaited async calls)
          const type = node.getType();
          if (type.getText().includes("Promise") || type.getSymbol()?.getName() === "Promise") {
             const parent = node.getParent();
             if (parent && !Node.isAwaitExpression(parent) && !Node.isReturnStatement(parent) && !Node.isYieldExpression(parent)) {
                // If it's a statement by itself or part of an expression that isn't awaiting it
                if (Node.isExpressionStatement(parent)) {
                   findings.push({
                     file: filePath,
                     severity: "high",
                     title: "Workflow: Unawaited Promise",
                     why: `Loose unawaited promise detected for I/O call '${text}'.`,
                     fix: "Await the promise or explicitly handle it to avoid race conditions or floating promises."
                   });
                }
             }
          }
        }
      }
    });
    return findings;
  }
};

// 4. Complexity Rule
export const ComplexityRule: IRule = {
    name: "complexity-monitor",
    check: (source: SourceFile) => {
      const findings: Finding[] = [];
      const filePath = source.getFilePath().replace(/\\/g, "/");
      const lines = source.getText().split('\n').length;
      if (lines > 500) {
        findings.push({
            file: filePath,
            severity: "medium",
            title: "Complexity: Monolithic File",
            why: `File exceeds 500 lines (${lines} lines).`,
            fix: "Decompose into smaller, domain-specific modules."
        });
      }
      return findings;
    }
};

// 5. Sanitization Rule — detect dangerouslySetInnerHTML without sanitization
export const SanitizationRule: IRule = {
  name: "sanitization-check",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('dangerouslySetInnerHTML')) {
      const hasSanitizer = text.includes('DOMPurify') || text.includes('sanitize') || text.includes('escapeHtml') || text.includes('htmlEscape');
      if (!hasSanitizer) {
        findings.push({
          file: filePath,
          severity: "critical",
          title: "XSS Risk: Unescaped dangerouslySetInnerHTML",
          why: "dangerouslySetInnerHTML used without DOMPurify or sanitizer — injects raw HTML into DOM.",
          fix: "Import DOMPurify from 'isomorphic-dompurify' and wrap: DOMPurify.sanitize(html) before dangerouslySetInnerHTML."
        });
      }
    }
    return findings;
  }
};

// 6. Secrets Exposure Rule — detect secrets/keys in Sentry/logs telemetry
export const SecretsExposureRule: IRule = {
  name: "secrets-exposure-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    
    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();
        const isSentryCall = expr.includes('Sentry.capture') || expr.includes('addBreadcrumb');
        const isLogCall = expr.includes('console.') || expr.includes('logInfo') || expr.includes('logError');
        
        if ((isSentryCall || isLogCall) && node.getArguments().length > 0) {
          const args = node.getArguments().map(a => a.getText()).join(' ');
          const sensitivePatterns = ['token', 'secret', 'password', 'apiKey', 'bearer', 'authorization'];
          if (sensitivePatterns.some(p => args.toLowerCase().includes(p))) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Secrets Exposure: Sensitive data in telemetry",
              why: `Potential secret/key field '${sensitivePatterns.find(p => args.toLowerCase().includes(p))}' passed to ${expr}.`,
              fix: "Redact sensitive values before passing to Sentry/logs: replace with '[REDACTED]' or hash."
            });
          }
        }
      }
    });
    return findings;
  }
};

// 7. Auth Security Rule — detect insecure auth patterns
export const AuthSecurityRule: IRule = {
  name: "auth-security-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Check for 307 redirect with POST (should be 303)
    if (text.includes('307') && text.includes('POST')) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Auth: POST 307 redirect preserves POST method",
        why: "307 redirect preserves the POST method but target may only handle GET. Use 303 to force GET.",
        fix: "Change 307 to 303 redirect when redirecting POST to a GET-only route."
      });
    }

    // Check for localhost fallbacks in production routes
    if (text.includes('localhost') && (text.includes('NEXT_PUBLIC_APP_URL') || text.includes('APP_URL'))) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Auth: localhost fallback in production route",
        why: "Environment variable missing fallback to localhost can redirect production users to localhost:3000.",
        fix: "Fail closed (return 500) when APP_URL is missing, or derive origin from request headers."
      });
    }
    return findings;
  }
};

// 8. Error Taxonomy Rule — detect DB errors collapsed into NotFound
export const ErrorTaxonomyRule: IRule = {
  name: "error-taxonomy-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    
    source.forEachDescendant((node) => {
      if (Node.isIfStatement(node)) {
        const condition = node.getExpression().getText();
        // Pattern: if (error || !data) return { error: 'NotFound' }
        if (condition.includes('error') && condition.includes('!data') || condition.includes('!result')) {
          const block = node.getThenStatement()?.getText() || '';
          if (block.includes('NotFound')) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Error Taxonomy: DB errors collapsed into NotFound",
              why: "Database/query errors are returned as NotFound, hiding real failures as missing resources.",
              fix: "Separate error cases: return 'InternalError' (-> 500) for query failures, 'NotFound' (-> 404) only when no rows match."
            });
          }
        }
      }
    });
    return findings;
  }
};

// 9. Cross-Platform Rule — detect LF-only splitting in CRLF-sensitive code
export const CrossPlatformRule: IRule = {
  name: "cross-platform-compatibility",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();
    
    // Match .split('\n') but not .split(/\r?\n/)
    const lfSplitMatches = text.match(/\.split\(['"]\\n['"]\)/g);
    if (lfSplitMatches) {
      findings.push({
        file: filePath,
        severity: "medium",
        title: "Cross-Platform: LF-only string splitting",
        why: `${lfSplitMatches.length} instance(s) of .split('\\n') detected. CRLF line endings (Windows) will not be handled.`,
        fix: "Replace .split('\\n') with .split(/\\r?\\n/) for cross-platform compatibility."
      });
    }
    return findings;
  }
};

// 10. Stream Resilience Rule — detect missing error state on timeout/abort
export const StreamResilienceRule: IRule = {
  name: "stream-resilience-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Check for setTimeout abort patterns without error state
    if (text.includes('setTimeout') && text.includes('abort') && !text.includes('settleAnalysis') && !text.includes('setError')) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Stream: Timeout abort does not settle error state",
        why: "Abort timeout fires but no error/complete state is set, leaving analysis in limbo.",
        fix: "Call settleAnalysis('error', ...) or setStreamError() when timeout fires, not just abort()."
      });
    }
    return findings;
  }
};

// 11. Schema Contract Rule — detect Zod refinements on optional fields or required fields not sent by all callers
export const SchemaContractRule: IRule = {
  name: "schema-contract-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Detect .refine() on non-optional fields — caller may not send them
    if (text.includes('.refine(') && !text.includes('.optional()')) {
      const refineMatches = text.match(/\.refine\(/g);
      if (refineMatches && text.includes('z.object({')) {
        findings.push({
          file: filePath,
          severity: "critical",
          title: "Schema: Refinement on required field may reject valid requests",
          why: "z.refine() used without .optional() on the chained field. If a caller doesn't send this field, the entire request is rejected with 400.",
          fix: "Add .optional() before .refine() if the field isn't guaranteed from all call paths: .refine(...).optional()"
        });
      }
    }
    return findings;
  }
};

// 12. Redundant Validation Rule — detect manual validation that duplicates Zod schema
export const RedundantValidationRule: IRule = {
  name: "redundant-validation-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Detect: Zod schema validates min/max AND there's a manual if-check on same field
    if (text.includes('.min(') && text.includes('.max(') && text.includes('z.object({')) {
      const hasManualRange = text.match(/if\s*\([^)]*(?:<|>)\s*\d+[^)]*\)/g);
      const zodMin = text.match(/\.min\(\d+\)/g);
      if (hasManualRange && zodMin) {
        findings.push({
          file: filePath,
          severity: "medium",
          title: "Validation: Manual range check duplicates Zod schema",
          why: "Zod already enforces .min()/.max() bounds. Manual if-check after schema parse is redundant and can drift.",
          fix: "Remove manual range validation after schema.safeParse() — Zod handles it. Keep only post-parse semantic checks."
        });
      }
    }
    return findings;
  }
};

// 13. Persist Resilience Rule — detect missing error state in persist flows
export const PersistResilienceRule: IRule = {
  name: "persist-resilience-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('/api/analyses/persist') || text.includes('persistAnalysis')) {
      const hasErrorState = text.includes('setStreamError') || text.includes('settleAnalysis');
      const hasRetry = text.includes('maxRetries') || text.includes('retry');
      if (!hasErrorState && !hasRetry) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "Persist: No error state or retry on failure",
          why: "Persist endpoint call without error state propagation or retry logic.",
          fix: "Add exponential backoff retry (2 attempts) and set error state if all attempts fail."
        });
      }
    }
    return findings;
  }
};

// 14. Bundle Contradiction Rule — detect prompt with both "all dims" + "only these dims"
export const BundleContradictionRule: IRule = {
  name: "bundle-contradiction-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const text = source.getText();
    if (text.includes('All ${TOTAL_DIMENSIONS} dimensions must be present') &&
        text.includes('ONLY generate') &&
        !text.includes('skipAllDimensionsInstruction')) {
      findings.push({
        file: source.getFilePath(),
        severity: "critical",
        title: "Prompt: Contradictory instructions — 'all dims' + 'only these dims'",
        why: "LLM sees both 'All 11 dims' AND 'ONLY these dims'. LLM follows the first. The focus section is ignored.",
        fix: "Set skipAllDimensionsInstruction=true in getUCISPrompt() for bundle-scoped prompts."
      });
    }
    return findings;
  }
};

// 15. Transcript Guard Rule — detect entry-point LLM call without transcript check
export const TranscriptGuardRule: IRule = {
  name: "transcript-guard-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();
    const isEntryPoint = text.includes('app.post') || text.includes('app.get');
    if (isEntryPoint && (text.includes('analyze') || text.includes('stream')) && text.includes('transcript')) {
      const hasGuard = text.includes('transcript unavailable') || text.includes('TranscriptGuard') || text.includes('400');
      if (!hasGuard) {
        findings.push({
          file: filePath,
          severity: "critical",
          title: "Guard: LLM stream entry point without transcript check",
          why: "Entry point calls analyze/stream but doesn't check transcript validity. Costly LLM calls on placeholder data.",
          fix: "Check transcript before LLM call at the entry point. Return 400 if unavailable after all fetch attempts."
        });
      }
    }
    return findings;
  }
};

// 16. Stream Settle Rule — detect parallel streams missing per-stream abort
export const StreamSettleRule: IRule = {
  name: "stream-settle-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();
    if (text.includes('Promise.all') && text.includes('CompletedIndexes') && filePath.includes('useSSEStream')) {
      if (!text.includes('streamController') && !text.includes('AbortController')) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "Stream: Parallel streams missing per-stream abort",
          why: "Parallel SSE streams without per-stream AbortController can hang on timeout.",
          fix: "Create per-stream AbortController, combine with parent via AbortSignal.any()."
        });
      }
    }
    return findings;
  }
};

// 17. Cascade Order Rule — enforce Decodo→YouTube→proxy→graceful order
export const CascadeOrderRule: IRule = {
  name: "cascade-order-enforcer",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    if (!filePath.includes('TranscriptExtractor')) return findings;
    const text = source.getText();
    const decodoIdx = text.indexOf('Decodo');
    const ytIdx = text.indexOf('fetchWithPrimary');
    if (decodoIdx !== -1 && ytIdx !== -1 && decodoIdx > ytIdx) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Cascade: Transcript fallback order wrong",
        why: "Agreed: Decodo→YouTube→proxy→graceful. YouTube-first fails without proxy.",
        fix: "Swap to Decodo primary, YouTube via Bright Data proxy as fallback."
      });
    }
    return findings;
  }
};

// 18. Proxy Promotion Rule — detect documented credentials not deployed
export const ProxyPromotionRule: IRule = {
  name: "proxy-promotion-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    if (!filePath.includes('wrangler.toml')) return findings;
    const text = source.getText();
    if (text.includes('RESIDENTIAL_PROXY_URL') && !text.includes('wrangler secret put')) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Config: Proxy credential documented but not deployed as secret",
        why: "RESIDENTIAL_PROXY_URL in wrangler.toml as comment. YouTube path silently fails without it.",
        fix: "Add 'wrangler secret put RESIDENTIAL_PROXY_URL' instruction. Required for YouTube timedtext API."
      });
    }
    return findings;
  }
};