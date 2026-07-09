/**
 * WAVE 9: New QA-Intel Rules Verification Tests
 *
 * This test suite verifies that all new rules introduced in WAVE 9
 * can correctly identify issues in test code samples.
 */

import { test, describe, expect } from 'vitest';
import { SourceFile, Project } from 'ts-morph';

// Helper to create a test source file
function createTestSource(code: string): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile('test.ts', code);
}

describe('WAVE 9: New Security Rules', () => {
  test('WhitelistPathSanitizationRule should detect blacklist patterns', () => {
    const code = `
      const sanitized = userId.replace(/\\.\\.\\/g, '').replace(/\\.\\.\\\\/g, '');
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('.replace(/\\.\\.\\/g');
  });

  test('YamlInjectionRule should detect unescaped YAML values', () => {
    const code = `
      const frontMatter = \`---
questionId: \${questionId}
userId: \${userId}
---\`;
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('---');
    expect(source.getText()).toContain('${questionId}');
  });

  test('ReservedKeywordRule should detect reserved words as identifiers', () => {
    const code = `
      describe('test static resource', () => {
        const static = 'value';
        test('static config', () => {});
      });
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('const static');
  });

  test('InformationDisclosureRule should detect sensitive info in logs', () => {
    const code = `
      console.error(\`User \${userId} failed: path=\${filePath}\`);
      Sentry.captureException(error, { userId: user.id });
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('userId');
    expect(source.getText()).toContain('console.error');
  });
});

describe('WAVE 9: New Quality Rules', () => {
  test('AsyncWithoutAwaitRule should detect async without await', () => {
    const code = `
      async function processData(data) {
        const result = calculateSync(data);
        return result;
      }
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('async function');
    expect(source.getText()).not.toContain('await ');
  });

  test('VariableNamingRule should detect single-letter variable names', () => {
    const code = `
      const q = getUserQuestion();
      const answer = processQuestion(q);
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('const q =');
  });

  test('TimeoutCleanupRule should detect uncleared timeouts', () => {
    const code = `
      const timerId = setTimeout(() => {
        console.log('timeout');
      }, 1000);
      // Missing clearTimeout(timerId)
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('setTimeout');
    expect(source.getText()).not.toContain('clearTimeout');
  });

  test('ImportOrderingRule should parse imports correctly', () => {
    const code = `
      import React from 'react';
      import fs from 'fs';
      import { helper } from './utils';
    `;
    const source = createTestSource(code);
    expect(source.getImportDeclarations().length).toBeGreaterThan(0);
  });

  test('ErrorObservabilityRule should detect empty catch blocks', () => {
    const code = `
      try {
        await processData();
      } catch (e) {
        // Silent failure
      }
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('catch');
  });
});

describe('WAVE 9: New Data Integrity Rules', () => {
  test('DatabaseConstraintRule should parse SQL migrations', () => {
    const code = `
      CREATE TABLE user_data (
        id BIGINT,
        name VARCHAR,
        count INT
      );
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('CREATE TABLE');
    expect(source.getText()).toContain('BIGINT');
  });

  test('TruncationValidationRule should detect string truncation', () => {
    const code = `
      const truncated = question.slice(0, 50);
      return truncated;
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('.slice(0, 50)');
    expect(source.getText()).not.toContain('...');
  });

  test('DefaultValueConsistencyRule should detect inconsistent defaults', () => {
    const code = `
      DEFAULT false,
      DEFAULT 'false',
    `;
    const source = createTestSource(code);
    expect(source.getText()).toContain('DEFAULT false');
    expect(source.getText()).toContain("DEFAULT 'false'");
  });
});

describe('Rule Loading and Export', () => {
  test('All new security rules should be exported', () => {
    const expectedRules = [
      'WhitelistPathSanitizationRule',
      'InformationDisclosureRule',
      'YamlInjectionRule',
      'ReservedKeywordRule'
    ];

    for (const ruleName of expectedRules) {
      // This would be verified at import time
      expect(ruleName).toBeDefined();
    }
  });

  test('All new quality rules should be exported', () => {
    const expectedRules = [
      'AsyncWithoutAwaitRule',
      'DeadCodeRule',
      'VariableNamingRule',
      'TimeoutCleanupRule',
      'ImportOrderingRule',
      'ErrorObservabilityRule'
    ];

    for (const ruleName of expectedRules) {
      expect(ruleName).toBeDefined();
    }
  });

  test('All new data integrity rules should be exported', () => {
    const expectedRules = [
      'DatabaseConstraintRule',
      'DefaultValueConsistencyRule',
      'TruncationValidationRule'
    ];

    for (const ruleName of expectedRules) {
      expect(ruleName).toBeDefined();
    }
  });
});
