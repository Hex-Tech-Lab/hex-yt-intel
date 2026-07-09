import { Node, SyntaxKind } from "ts-morph";
import type { SourceFile } from "ts-morph";
import type { Finding, IRule } from "../engine";

export const CredentialLeakRule: IRule = {
    name: "credential-leak-detector",
    check: (source: SourceFile) => {
      const findings: Finding[] = [];
      const filePath = source.getFilePath().replace(/\\/g, "/");
      if (filePath.includes('/quality-engine/rules/') || filePath.includes('verify-quality-engine')) return findings;
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

    // Path Traversal Risk (Juliet/SARD CWE-22)
    // Skip legal pages and other pages that have explicit path traversal guards
    const hasPathGuard = text.includes('startsWith(') || text.includes('.match(/\\.\\./') || text.includes("!realPath.includes('..')");
    if (!hasPathGuard) {
      source.forEachDescendant((node) => {
        if (Node.isCallExpression(node)) {
          const expr = node.getExpression().getText();
          if (expr === "path.join" || expr === "path.resolve" || expr === "join" || expr === "resolve") {
            const args = node.getArguments();
            for (const arg of args) {
              const argText = arg.getText();
              if (
                (argText.includes("input") || argText.includes("user") || argText.includes("param")) &&
                !argText.includes("replace") &&
                !argText.includes("sanitize") &&
                !argText.includes("sanitized")
              ) {
                findings.push({
                  file: filePath,
                  severity: "high",
                  title: "Path Traversal Risk: Unsanitized path construction",
                  why: `Potential user input '${argText}' passed to ${expr} without validation.`,
                  fix: "Sanitize parameter before path resolution: use .replace(/\\.\\.(?:\\/|\\\\|$)/g, '') or validate against a safe whitelist."
                });
                break;
              }
            }
          }
        }
      });
    }

    return findings;
  }
};

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
          // Precision guard (dataflow-lite): match the sensitive patterns only
          // against the *identifier surface* of the arguments — variable names,
          // object-literal keys, property accesses, and `${...}` interpolations —
          // NEVER string-literal text. A real leak passes a secret-named symbol
          // (`console.log(accessToken)`, `Sentry.captureException(e, { token })`);
          // a benign log carries the pattern only inside its message string
          // (`'Token signing failed'`, `'STRIPE_WEBHOOK_SECRET not configured'`),
          // which must not trip this rule. Matching raw arg text (the previous
          // behaviour) flagged every such label and made this security signal
          // ~100% false-positive in full-mode scans.
          const sensitivePatterns = ['token', 'secret', 'password', 'apikey', 'bearer', 'authorization'];
          // A secret-named object KEY whose value is a string literal is a
          // constant label / already-redacted placeholder (`{ token: '[REDACTED]' }`),
          // not the live secret — don't flag code that followed this rule's own
          // advice. `{ token: accessToken }` (identifier value) still fires.
          // Only a KNOWN PLACEHOLDER literal counts as redacted — a real secret
          // hardcoded as a string-literal value must still be flagged, not skipped.
          const REDACTION_PLACEHOLDER = /^(?:\[?redacted\]?|<redacted>|masked|hidden|\*{2,}|x{3,}|n\/a)$/i;
          const isRedactedKey = (idNode: Node): boolean => {
            const parent = idNode.getParent();
            if (parent && Node.isPropertyAssignment(parent) && parent.getNameNode() === idNode) {
              const init = parent.getInitializer();
              return !!init && Node.isStringLiteral(init) &&
                REDACTION_PLACEHOLDER.test(init.getLiteralText().trim());
            }
            return false;
          };
          // Normalize separators so snake/SCREAMING_CASE variants match the same
          // patterns as camelCase (`api_key`, `OPENAI_API_KEY` → `apikey`).
          const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
          // Candidates = every identifier in the args PLUS string-literal object
          // KEYS (`{ 'access_token': v }`) — a quoted key is a real secret-name
          // signal. String-literal *values* and message args are still excluded
          // (only a PropertyAssignment *name* qualifies), preserving the guard
          // against flagging log messages like 'Token signing failed'.
          const isKeyName = (n: Node): boolean => {
            const parent = n.getParent();
            return !!parent && Node.isPropertyAssignment(parent) && parent.getNameNode() === n;
          };
          const idNodes = node.getArguments()
            .flatMap(a => Node.isIdentifier(a)
              ? [a]
              : [
                  ...a.getDescendantsOfKind(SyntaxKind.Identifier),
                  ...a.getDescendantsOfKind(SyntaxKind.StringLiteral).filter(isKeyName),
                ])
            .filter(n => !isRedactedKey(n));
          const hit = sensitivePatterns.find(p =>
            idNodes.some(id => normalize(id.getText()).includes(p)),
          );
          if (hit) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Secrets Exposure: Sensitive data in telemetry",
              why: `Potential secret/key identifier '${hit}' passed to ${expr}.`,
              fix: "Redact sensitive values before passing to Sentry/logs: replace with '[REDACTED]' or hash."
            });
          }
        }
      }

      // Hardcoded Secret Assignment (Juliet/SARD CWE-259)
      if (Node.isVariableDeclaration(node) || Node.isPropertyDeclaration(node)) {
        const nameNode = node.getNameNode();
        const name = nameNode ? nameNode.getText() : "";
        const sensitivePatterns = ['dbpass', 'password', 'passwd', 'secretkey', 'privatekey'];
        if (sensitivePatterns.some(p => name.toLowerCase().includes(p))) {
          const initializer = node.getInitializer();
          if (initializer && Node.isStringLiteral(initializer)) {
            const literalText = initializer.getLiteralText();
            if (literalText.length > 0 && !literalText.startsWith("process.env.")) {
              findings.push({
                file: filePath,
                severity: "critical",
                title: "Security: Hardcoded password/secret assignment",
                why: `Sensitive variable '${name}' initialized with a plaintext string literal.`,
                fix: "Load sensitive secrets exclusively from environment variables (e.g. process.env.DATABASE_PASSWORD)."
              });
            }
          }
        }
      }
    });
    return findings;
  }
};

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

export const EnvPlaceholderNamespaceRule: IRule = {
  name: "env-placeholder-namespace-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Detect clientEnv section that uses || fallback without isPlaceholder() guard
    if (filePath.includes('env.ts') || filePath.includes('env.js')) {
      const clientEnvMatch = text.match(/export\s+const\s+clientEnv\s*=\s*\{[\s\S]*?\};/);
      if (clientEnvMatch) {
        const clientEnvBlock = clientEnvMatch[0];
        const nextPublicOrFallback = clientEnvBlock.match(/NEXT_PUBLIC_\w+\s*:\s*process\.env\.NEXT_PUBLIC_\w+\s*\|\|/g);
        const usesIsPlaceholder = clientEnvBlock.includes('isPlaceholder');
        
        if (nextPublicOrFallback && nextPublicOrFallback.length > 0 && !usesIsPlaceholder) {
          findings.push({
            file: filePath,
            severity: "critical",
            title: "Auth: Client env uses || fallback without isPlaceholder() guard",
            why: `Client env has ${nextPublicOrFallback.length} NEXT_PUBLIC_ fields using simple || fallback. If env var is set to a placeholder URL (e.g., placeholder-project.supabase.co), it passes through. Server uses isPlaceholder() and discards it. Result: PKCE code_verifier cookie written under different project-ref namespace — auth callback fails with 'code verifier not found'.`,
            fix: "Route NEXT_PUBLIC_SUPABASE_URL through isPlaceholder() validation: NEXT_PUBLIC_SUPABASE_URL: isPlaceholder(process.env.NEXT_PUBLIC_SUPABASE_URL) ? MOCK_DEFAULTS.NEXT_PUBLIC_SUPABASE_URL : process.env.NEXT_PUBLIC_SUPABASE_URL"
          });
        }
      }
    }
    return findings;
  }
};

export const InsecureFallbackRule: IRule = {
  name: "insecure-fallback-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    if (filePath.includes('/quality-engine/rules/') || filePath.includes('verify-quality-engine')) return findings;
    const text = source.getText();

    if (text.includes('NODE_ENV') && (text.includes('production') || text.includes('preview'))) {
      const hasConditionalSecret = text.match(/NODE_ENV.*\?.*secret|NODE_ENV.*\?.*key|NODE_ENV.*\?.*token/gi);
      if (hasConditionalSecret) {
        findings.push({
          file: filePath,
          severity: "critical",
          title: "Security: Secret strength varies by NODE_ENV",
          why: "HMAC secret or API key falls back to weak value when NODE_ENV is missing. Preview/staging get weaker security.",
          fix: "Fail closed: if secret is missing or placeholder, return 500 error."
        });
      }
    }
    return findings;
  }
};

export const SqlInjectionRule: IRule = {
  name: "sql-injection-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    if (text.includes("SELECT") || text.includes("INSERT") || text.includes("UPDATE") || text.includes("DELETE")) {
      source.forEachDescendant((node) => {
        if (Node.isTemplateExpression(node)) {
          const literalText = node.getText();
          if (literalText.includes("SELECT") || literalText.includes("INSERT") || literalText.includes("UPDATE")) {
            findings.push({
              file: filePath,
              severity: "critical",
              title: "SQL Injection Risk: Direct string interpolation in SQL query",
              why: "Query constructed using string interpolation or variables directly.",
              fix: "Replace template variables with parameterized query placeholders (e.g. $1, ?) and pass values via arguments."
            });
          }
        }
        if (Node.isBinaryExpression(node)) {
          const operator = node.getOperatorToken().getKind();
          if (operator === SyntaxKind.PlusToken) {
            const nodeText = node.getText();
            if (nodeText.includes("SELECT") || nodeText.includes("INSERT") || nodeText.includes("UPDATE")) {
              findings.push({
                file: filePath,
                severity: "critical",
                title: "SQL Injection Risk: Direct string concatenation in SQL query",
                why: "Query constructed using string concatenation directly.",
                fix: "Replace concatenation with parameterized query placeholders (e.g. $1, ?) and pass values via arguments."
              });
            }
          }
        }
      });
    }

    return findings;
  }
};

export const WhitelistPathSanitizationRule: IRule = {
  name: "whitelist-path-sanitization",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Detect blacklist-based path sanitization (replace specific patterns)
    // Pattern: .replace(/\.\.\//g, '') or .replace(/\.\.\\/g, '')
    const blacklistPattern = /\.replace\(\s*\/\\\.\\\.\s*(?:\\\/|\\\\)\s*\/g\s*,\s*['"]['"]\s*\)/;
    if (blacklistPattern.test(text)) {
      findings.push({
        file: filePath,
        severity: "high",
        title: "Security: Blacklist-based path sanitization (bypass vulnerable)",
        why: "Removing ../ and ..\\ patterns with sequential replace() calls can be bypassed with patterns like ..// or ....//",
        fix: "Replace with whitelist approach: .replace(/[^a-zA-Z0-9._-]/g, '') to allow only safe characters."
      });
    }

    return findings;
  }
};

export const InformationDisclosureRule: IRule = {
  name: "information-disclosure-prevention",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    source.forEachDescendant((node) => {
      // Detect console/Sentry logging with sensitive info in template literals
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();
        const isLogOrSentry = expr.includes('console.') || expr.includes('Sentry.') || expr.includes('logError') || expr.includes('logInfo');

        if (isLogOrSentry && node.getArguments().length > 0) {
          const arg = node.getArguments()[0];
          if (Node.isTemplateExpression(arg)) {
            const templateText = arg.getText();
            // Check for sensitive patterns in template
            const sensitivPatterns = ['filePath', 'userId', 'path:', 'user:', 'id:'];
            for (const pattern of sensitivPatterns) {
              if (templateText.includes(pattern) && templateText.includes('$')) {
                findings.push({
                  file: filePath,
                  severity: "high",
                  title: "Information Disclosure: Sensitive paths/IDs in error logs",
                  why: `Log message includes sensitive pattern '${pattern}' which exposes internal structure to attackers.`,
                  fix: "Remove or redact sensitive information from error messages: log only error type/code, not internal paths or user IDs."
                });
                break;
              }
            }
          }
        }
      }
    });

    return findings;
  }
};

export const YamlInjectionRule: IRule = {
  name: "yaml-injection-prevention",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const text = source.getText();

    // Detect YAML front matter without proper escaping
    if (text.includes('---') && (text.includes('front matter') || text.includes('YAML') || filePath.includes('markdown'))) {
      // Look for unescaped YAML values (missing quotes) - handle both Unix and Windows line endings
      const yamlPattern = /---\r?\n[^:]+:\s*\$\{[^}]+\}/;
      if (yamlPattern.test(text)) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "Security: YAML injection vulnerability (unescaped values)",
          why: "YAML front matter contains unquoted values that can be broken by newlines or special characters in user input.",
          fix: "Escape YAML values: wrap in quotes and escape internal quotes. Use helper: `value = `\"${String(value).replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"')}\"`"
        });
      }
    }

    return findings;
  }
};

export const ReservedKeywordRule: IRule = {
  name: "reserved-keyword-avoidance",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");

    // Reserved words that should not be used as identifiers in test files
    const reservedWords = ['static', 'function', 'class', 'interface', 'type', 'const', 'let', 'var', 'async', 'await', 'return'];

    source.forEachDescendant((node) => {
      // Check variable declarations and test names
      if (Node.isVariableDeclaration(node) || Node.isIdentifier(node)) {
        const nameNode = node.getNameNode?.() || node;
        if (nameNode) {
          const name = nameNode.getText?.() ?? '';
          for (const reserved of reservedWords) {
            if (name.toLowerCase().includes(reserved) && name === reserved) {
              findings.push({
                file: filePath,
                severity: "medium",
                title: `Syntax Error Risk: Reserved keyword '${reserved}' used as identifier`,
                why: `Using '${reserved}' as a variable/test name causes parse errors. JavaScript reserves this keyword.`,
                fix: `Rename to a non-reserved alternative: '${reserved}test', 'test${reserved.charAt(0).toUpperCase() + reserved.slice(1)}', etc.`
              });
              break;
            }
          }
        }
      }
    });

    return findings;
  }
};

/**
 * Register all security-related rules with the QA-Intel engine.
 * Includes comprehensive security checks for credential leaks, XSS/injection attacks,
 * authentication vulnerabilities, secrets exposure, and unsafe code patterns.
 * @param engine - The QA-Intel engine instance
 */
export function registerSecurityRules(engine: unknown) {
  const e = engine as any;
  e.addRule(CredentialLeakRule);
  e.addRule(SanitizationRule);
  e.addRule(SecretsExposureRule);
  e.addRule(AuthSecurityRule);
  e.addRule(HmacMessageFormatRule);
  e.addRule(UnsafePropertyAccessRule);
  e.addRule(EnvPlaceholderNamespaceRule);
  e.addRule(InsecureFallbackRule);
  e.addRule(SqlInjectionRule);
  e.addRule(WhitelistPathSanitizationRule);
  e.addRule(InformationDisclosureRule);
  e.addRule(YamlInjectionRule);
  e.addRule(ReservedKeywordRule);
}
