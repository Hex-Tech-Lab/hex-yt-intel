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
    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();
        if (expr === "path.join" || expr === "path.resolve" || expr === "join" || expr === "resolve") {
          const args = node.getArguments();
          for (const arg of args) {
            const argText = arg.getText();
            if (
              (argText.includes("input") || argText.includes("user") || argText.includes("param") || argText.includes("path") || argText.includes("p")) &&
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
}
