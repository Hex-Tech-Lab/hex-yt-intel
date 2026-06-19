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

// ──────────────────────────────────────────────────────────────────────────────
// PR #91 LESSONS — INP, Security, Retry, Type Safety (2026-06-19)
// ──────────────────────────────────────────────────────────────────────────────

// 19. INP Alert Blocker Rule — detect alert() in React event handlers
export const InpAlertBlockerRule: IRule = {
  name: "inp-alert-blocker",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    if (!filePath.includes('.tsx') && !filePath.includes('.jsx')) return findings;

    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();
        if (expr === 'alert') {
          // Find the enclosing function — check if it's an event handler
          const func = node.getFirstAncestorByKind(SyntaxKind.ArrowFunction)
            || node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
            || node.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
          if (func) {
            const parent = func.getParent();
            const isEventHandler = parent && (
              Node.isJsxAttribute(parent) ||
              (Node.isVariableDeclaration(parent) && parent.getName().startsWith('handle'))
            );
            if (isEventHandler) {
              findings.push({
                file: filePath,
                severity: "high",
                title: "INP: alert() blocks main thread in event handler",
                why: "alert() is synchronous and blocks the main thread for 100-500ms. Causes INP regression on every affected click.",
                fix: "Replace alert() with a non-blocking toast: showToast(message) using a CSS-animated DOM element."
              });
            }
          }
        }
      }
    });
    return findings;
  }
};

// 20. Canvas Hover Re-render Rule — detect useState hover on canvas elements
export const CanvasHoverReRenderRule: IRule = {
  name: "canvas-hover-rerender",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Detect canvas components with useState for hover
    if ((text.includes('<canvas') || text.includes('ForceGraph2D') || text.includes('react-force-graph'))
        && text.includes('setHover') && text.includes('useState')) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "INP: Canvas hover triggers React re-render",
        why: "useState for hover state causes full component re-render on every mousemove. Canvas should redraw imperatively.",
        fix: "Use useRef for hoverId + imperative canvas redraw. Call drawCanvas() directly instead of setState."
      });
    }
    return findings;
  }
};

// 21. Overlay Close Cascade Rule — detect overlay/modal close without startTransition
export const OverlayCloseCascadeRule: IRule = {
  name: "overlay-close-cascade",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('inert=') && text.includes('setOverlayOpen')) {
      // Check if overlay close handlers use startTransition
      const closeHandlers = text.match(/onClick=\{[^}]*set\w+\(null\)/g) || [];
      const transitionWrapped = text.includes('startTransition');

      if (closeHandlers.length > 0 && !transitionWrapped) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "INP: Overlay close cascades full component re-render",
          why: "Overlay close triggers state update that re-renders the entire parent (potentially 500+ lines). Blocks UI for 200-500ms.",
          fix: "Wrap close handler in startTransition: onClick={() => startTransition(() => setX(null))}"
        });
      }
    }
    return findings;
  }
};

// 22. Validation In onChange Rule — detect Zod/regex validation in onChange handlers
export const ValidationOnChangeRule: IRule = {
  name: "validation-onchange-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Detect Zod safeParse in store setters that are called from onChange
    if (text.includes('safeParse') || text.includes('.parse(')) {
      const isStore = filePath.includes('store/') || filePath.includes('Store');
      if (isStore && text.includes('setUrl') || text.includes('setQuery') || text.includes('setSearch')) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "INP: Synchronous validation in onChange/state setter",
          why: "Zod safeParse (regex) runs on every keystroke. Blocks UI for 200-500ms per keystroke.",
          fix: "Remove validation from the state setter. Defer to submit/analyze time: validate only when user triggers action."
        });
      }
    }
    return findings;
  }
};

// 23. HMAC Message Format Rule — detect Vercel↔Worker HMAC field mismatches
export const HmacMessageFormatRule: IRule = {
  name: "hmac-message-format-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Both sides must sign identical messages — check for asymmetric fields
    if (filePath.includes('stream-token') || filePath.includes('worker.ts')) {
      const fieldPattern = /\$\{.*?\}:\$\{.*?\}/g;
      const fields = text.match(fieldPattern) || [];
      if (fields.length > 0) {
        const fieldNames = fields.flatMap(f => f.match(/\$\{(\w+)/g) || []);
        const hasDimensions = fieldNames.some(f => f.includes('dimensions') || f.includes('chunkIndex') || f.includes('totalChunks'));
        const hasBasic = fieldNames.some(f => f.includes('videoId') || f.includes('analysisId'));

        if (hasDimensions && hasBasic) {
          findings.push({
            file: filePath,
            severity: "critical",
            title: "HMAC: Vercel↔Worker message format may mismatch",
            why: "Vercel signs videoId:analysisId:exp:models but worker may verify additional fields (dimensions, chunks). Mismatch = 401 Invalid token.",
            fix: "Ensure both sides sign the exact same fields. Vercel stream-token.ts is the source of truth — worker must match."
          });
        }
      }
    }
    return findings;
  }
};

// 24. Unhandled Clipboard Promise Rule — detect navigator.clipboard without catch
export const UnhandledClipboardPromiseRule: IRule = {
  name: "unhandled-clipboard-promise",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('navigator.clipboard')) {
      // Find clipboard calls without try/catch or .catch()
      source.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
          const expr = node.getExpression().getText();
          if (expr.includes('clipboard.writeText') || expr.includes('clipboard.readText')) {
            const tryStatement = node.getFirstAncestorByKind(SyntaxKind.TryStatement);
            const hasCatch = node.getFirstAncestorByKind(SyntaxKind.CatchClause);
            const parentText = node.getParent()?.getText() || '';
            const hasDotCatch = parentText.includes('.catch(');

            if (!tryStatement && !hasCatch && !hasDotCatch) {
              findings.push({
                file: filePath,
                severity: "medium",
                title: "Promise: Unhandled clipboard promise rejection",
                why: "navigator.clipboard returns a Promise. Without catch, permission denial causes unhandled rejection in console.",
                fix: "Wrap in try/catch or add .catch(() => {}): await navigator.clipboard.writeText(text).catch(() => {})"
              });
            }
          }
        }
      });
    }
    return findings;
  }
};

// 25. Retry Flag Interference Rule — detect flags that block retry loops
export const RetryFlagInterferenceRule: IRule = {
  name: "retry-flag-interference",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('maxRetries') || text.includes('atomic-persist')) {
      // Detect attempt-tracking flags that may interfere with retry loops
      const flagPatterns = text.match(/let\s+\w*(attempt|persisted|done)\w*\s*=/g) || [];
      if (flagPatterns.length > 0) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "Retry: Flag may interfere with atomic-persist retry loop",
          why: "Attempt-tracking flag (persistAttempted, hasAttempted) may block retries after first failure. Atomic-persist manages its own retry state.",
          fix: "Let atomic-persist manage retry logic. Remove attempt-tracking flags that return early from retry callbacks."
        });
      }
    }
    return findings;
  }
};

// 26. Persist Abort Scope Rule — detect client signal chained to persist fetch
export const PersistAbortScopeRule: IRule = {
  name: "persist-abort-scope",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes('persist') && text.includes('fetch') && text.includes('signal')) {
      const hasClientSignal = text.includes('req.raw.signal') || text.includes('c.req.raw.signal');
      if (hasClientSignal) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "Persist: Client signal aborts server-side persist",
          why: "Client disconnect signal chained to persist fetch. When user navigates away, persist is killed. Data lost.",
          fix: "Use only a server-side AbortController for persist (10s timeout). Remove client signal from persist fetch."
        });
      }
    }
    return findings;
  }
};

// 27. Unsafe Property Access Rule — detect array/object access without null guard
export const UnsafePropertyAccessRule: IRule = {
  name: "unsafe-property-access",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    source.forEachDescendant((node) => {
      if (Node.isElementAccessExpression(node)) {
        try {
          const index = node.getArgumentExpression()?.getText();
          if (index === '0' || index === '1') {
            const hasOptional = node.getQuestionTokenNode() !== undefined;
            if (!hasOptional) {
              const tryStatement = node.getFirstAncestorByKind(SyntaxKind.TryStatement);
              if (!tryStatement) {
                const func = node.getFirstAncestorByKind(SyntaxKind.ArrowFunction)
                  || node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
                if (func && (func.getText().includes('fetch') || func.getText().includes('extract') || func.getText().includes('parse'))) {
                  findings.push({
                    file: filePath,
                    severity: "medium",
                    title: "Access: Array index without null guard in I/O path",
                    why: "Array[0] access without optional chaining or try/catch. API response may be empty, causing TypeError.",
                    fix: "Add null guard: const first = arr?.[0]; if (!first) return fallback;"
                  });
                }
              }
            }
          }
        } catch {
          // skip nodes where API not available
        }
      }
    });
    return findings;
  }
};

// 28. startTransition Wrapping Rule — detect high-frequency state setters without transition
export const StartTransitionWrappingRule: IRule = {
  name: "start-transition-wrapping",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Only check DashboardContainer and similar top-level orchestrators
    if (!filePath.includes('Dashboard') && !filePath.includes('Container')) return findings;

    // Detect set*Node, set*Tab, set*Panel passed directly to child components
    const directPasses = text.match(/onSelect=\{set\w+\}/g) || [];
    if (directPasses.length > 0 && !text.includes('startTransition')) {
      findings.push({
        file: filePath,
        severity: "medium",
        title: "INP: High-frequency state setter passed directly to child",
        why: "setSelectedNodeId/setConsoleTab passed directly to child. Each click/hover triggers full re-render of 500+ line parent.",
        fix: "Create handleSelectNode = (id) => startTransition(() => setSelectedNodeId(id)) and pass that instead."
      });
    }
    return findings;
  }
};

// 29. Transcript Unsafe Access Rule — detect unsafe property chains in transcript parsing
export const TranscriptUnsafeAccessRule: IRule = {
  name: "transcript-unsafe-access",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    if (!filePath.includes('Transcript') && !filePath.includes('transcript')) return findings;

    const text = source.getText();
    // Detect deep property chains without optional chaining
    const deepChains = text.match(/results\[0\]\.\w+\.\w+\.\w+/g) || [];
    if (deepChains.length > 0) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Transcript: Unsafe deep property chain access",
        why: "results[0].content.auto_generated.en.events — any intermediate can be undefined. Causes TypeError on unexpected API shapes.",
        fix: "Use optional chaining: results?.[0]?.content?.auto_generated?.[lang]?.events ?? fallback"
      });
    }
    return findings;
  }
};