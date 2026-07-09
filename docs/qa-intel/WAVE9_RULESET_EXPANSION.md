# WAVE 9: QA-Intel Ruleset Expansion (2026-07-09)

## Overview

WAVE 9 expands the qa-intel ruleset from 42 rules to 55 rules (+13 new detection rules) by extracting patterns from recent PR review findings (Cubic/CodeRabbit/Snyk/CodeQL/DeepSource).

**Completion Status:** ✅ Complete
**Rule Count Before:** 42 rules  
**Rule Count After:** 55 rules  
**Net Addition:** 13 new rules  
**Coverage Areas:** Security, Code Quality, Data Integrity, Observability

---

## New Rules Breakdown

### Security Rules (4 new rules added; 13 total)

#### 1. WhitelistPathSanitizationRule
**File:** `scripts/quality-engine/rules/security.ts`  
**Severity:** High  
**Pattern:** Detects blacklist-based path sanitization (e.g., `.replace(/\.\.\//g, '')`)

**Why it matters:**
- Blacklist approaches can be bypassed with patterns like `..//` or `....//`
- Sequential `.replace()` calls don't prevent all traversal vectors

**Example violation:**
```typescript
const sanitized = userId.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
```

**Recommended fix:**
```typescript
const sanitized = userId.replace(/[^a-zA-Z0-9._-]/g, '') || 'unknown-user';
```

**References:**
- Commit 2fa445b: "Fix CodeQL path traversal alert: use whitelist sanitization instead of blacklist"
- CWE-22: Improper Limitation of a Pathname to a Restricted Directory

---

#### 2. InformationDisclosureRule
**File:** `scripts/quality-engine/rules/security.ts`  
**Severity:** High  
**Pattern:** Detects sensitive paths/IDs leaked in error messages and logs

**Why it matters:**
- Exposing internal paths (e.g., `/home/user/xyz`) helps attackers map infrastructure
- Leaking user IDs in logs violates GDPR/privacy regulations
- Error messages should be generic for user-facing APIs

**Example violation:**
```typescript
console.error(`Query failed (path=${filePath}): ${error.message}`);
console.debug(`Stored file: ${filePath}`);
```

**Recommended fix:**
```typescript
console.debug('[question-capture] File stored successfully');
const context = 'Failed to store question in Supabase Storage';
throw new Error(`[question-capture] ${context}: ${msg}`);
```

**References:**
- Commit d1620a9: "Fix information disclosure in error messages"
- CWE-209: Information Exposure Through an Error Message

---

#### 3. YamlInjectionRule
**File:** `scripts/quality-engine/rules/security.ts`  
**Severity:** High  
**Pattern:** Detects unescaped YAML values in front matter

**Why it matters:**
- YAML is sensitive to whitespace and special characters (newlines, colons, quotes)
- Unescaped user input can break YAML structure or inject malicious content
- Impacts any code parsing YAML headers (frontmatter, config, metadata)

**Example violation:**
```typescript
const frontMatter = `---
questionId: ${questionId}
userId: ${userId}
timestamp: ${timestamp}
---`;
```

**Recommended fix:**
```typescript
const escapeYamlValue = (value: string | null | undefined): string => {
  if (!value) return 'null';
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

const frontMatter = `---
questionId: ${escapeYamlValue(questionId)}
userId: ${escapeYamlValue(userId)}
timestamp: ${escapeYamlValue(timestamp)}
---`;
```

**References:**
- Commit e5618a6: "Fix YAML injection vulnerability in question capture"
- CWE-94: Improper Control of Generation of Code ('Code Injection')

---

#### 4. ReservedKeywordRule
**File:** `scripts/quality-engine/rules/security.ts`  
**Severity:** Medium  
**Pattern:** Detects use of reserved keywords as identifiers

**Why it matters:**
- Using reserved words like `static`, `function`, `async` as variable names causes parse errors
- Indicates incomplete refactoring or copy-paste mistakes
- Breaks production code silently

**Example violation:**
```typescript
describe('test static resource', () => {
  const static = 'value'; // ❌ Parse error: 'static' is reserved
});
```

**Recommended fix:**
```typescript
describe('test static resource', () => {
  const staticValue = 'value'; // ✅ Clear, non-reserved name
});
```

**References:**
- Commit 3cdd1b2: "fix: Address critical CodeRabbit findings from Wave 4 PR review"

---

### Quality Rules (6 new rules added; 6 total in new file)

#### 5. AsyncWithoutAwaitRule
**File:** `scripts/quality-engine/rules/quality.ts`  
**Severity:** Medium  
**Pattern:** Detects `async` functions with no `await` expressions

**Why it matters:**
- Redundant `async` keyword indicates incomplete refactoring
- Signals potential logic errors (forgot to `await` something)
- Wastes CPU on unnecessary Promise wrapper

**Example violation:**
```typescript
async function processData(data) {
  const result = calculateSync(data);
  return result; // ❌ Wrapped in Promise unnecessarily
}
```

**Recommended fix:**
```typescript
function processData(data) {
  const result = calculateSync(data);
  return result;
}
// Or if it must return a Promise:
async function processData(data) {
  const result = await someAsyncOp(data);
  return result;
}
```

**References:**
- Commit cc2c51a: "fix: Address DeepSource quality issues (variable names, async clarity, redundant conditionals)"

---

#### 6. DeadCodeRule
**File:** `scripts/quality-engine/rules/quality.ts`  
**Severity:** Medium  
**Pattern:** Detects unreachable code and unused variables

**Why it matters:**
- Dead code accumulates technical debt and confuses maintainers
- Flags indicate incomplete refactoring or logic errors
- Can hide bugs (if condition is always false, intended behavior never runs)

**Example violation:**
```typescript
if (false) {
  // ❌ Unreachable code block
  resetState();
}

let optionsSent = true;
if (!optionsSent) {
  // ❌ Unreachable (optionsSent is always true)
  send(options);
}
```

**Recommended fix:**
```typescript
// Remove unreachable if statements
resetState();
send(options);
```

**References:**
- Commit cc2c51a: "Remove redundant 'optionsSent' flag (always true in all branches)"

---

#### 7. VariableNamingRule
**File:** `scripts/quality-engine/rules/quality.ts`  
**Severity:** Low  
**Pattern:** Detects unclear single-letter variable names (outside loops)

**Why it matters:**
- Single-letter names (`q`, `u`, `r`) make code hard to understand
- Exception: loop indices (`i`, `j`, `x`, `y`) are conventional
- Makes diffs harder to review and code harder to maintain

**Example violation:**
```typescript
const q = getUserQuestion();
const u = getUser();
const answer = processQuestion(q, u);
```

**Recommended fix:**
```typescript
const question = getUserQuestion();
const user = getUser();
const answer = processQuestion(question, user);
```

**References:**
- Commit cc2c51a: "Renamed variable 'q' to 'question' for clarity"

---

#### 8. TimeoutCleanupRule
**File:** `scripts/quality-engine/rules/quality.ts`  
**Severity:** Medium  
**Pattern:** Detects setTimeout/setInterval without corresponding cleanup

**Why it matters:**
- Uncleared timeouts cause memory leaks and unintended side effects
- Timeouts can fire after component unmounts, accessing stale state
- In long-running processes, leak accumulates and eventually crashes

**Example violation:**
```typescript
const timerId = setTimeout(() => {
  console.log('timeout');
}, 1000);
// ❌ Missing clearTimeout(timerId)
```

**Recommended fix:**
```typescript
const timerId = setTimeout(() => {
  console.log('timeout');
}, 1000);

// In cleanup (React):
useEffect(() => {
  return () => clearTimeout(timerId);
}, []);

// Or in try-finally:
try {
  await operation();
} finally {
  clearTimeout(timerId);
}
```

**References:**
- Commit 3cdd1b2: "Clear timeout handle in KnowledgeHistoryService.loadUserKnowledgeContext"

---

#### 9. ImportOrderingRule
**File:** `scripts/quality-engine/rules/quality.ts`  
**Severity:** Low  
**Pattern:** Enforces import group ordering: framework → third-party → internal → types

**Why it matters:**
- Consistent import ordering reduces merge conflicts
- Improves code review readability (clear dependency layers)
- Standard across teams (Prettier, ESLint conventions)

**Expected order:**
```typescript
// 1. Framework/built-in
import React from 'react';
import { useState } from 'react';
import fs from 'fs';

// 2. Third-party packages
import axios from 'axios';
import { z } from 'zod';

// 3. Internal imports
import { helper } from './utils';
import { MyComponent } from '../components';

// 4. Type-only imports (at end)
import type { User } from '@/types';
```

**References:**
- Commit 3cdd1b2: "Add import grouping to messages/route.ts (framework/lib, third-party, internal)"

---

#### 10. ErrorObservabilityRule
**File:** `scripts/quality-engine/rules/quality.ts`  
**Severity:** High (empty catch blocks) / Medium (missing logging)  
**Pattern:** Detects catch blocks without error logging or re-throwing

**Why it matters:**
- Silent failures (empty catch) make debugging impossible in production
- Errors disappear with no audit trail
- Prevents incident response and root cause analysis

**Example violation:**
```typescript
try {
  await processData();
} catch (e) {
  // ❌ Silent failure
}

try {
  await operation();
} catch (error) {
  // ❌ No logging
}
```

**Recommended fix:**
```typescript
try {
  await processData();
} catch (error) {
  console.error('[context] Failed to process:', error);
  Sentry.captureException(error);
  throw error; // Re-throw if appropriate
}
```

**References:**
- Commit 3cdd1b2: "Add Sentry capture to POST /conversations/[id]/messages error handler"

---

### Data Integrity Rules (3 new rules added; 3 total in new file)

#### 11. DatabaseConstraintRule
**File:** `scripts/quality-engine/rules/data-integrity.ts`  
**Severity:** Medium  
**Pattern:** Detects missing NOT NULL and CHECK constraints in SQL migrations

**Why it matters:**
- Missing constraints allow invalid data into the database
- NULL in count fields (should be >= 0) causes application logic errors
- NULL comparisons (`WHERE count = NULL`) fail silently in SQL

**Example violation:**
```sql
CREATE TABLE analyses (
  id BIGINT,
  user_id VARCHAR,
  question_count INT,  -- ❌ No NOT NULL or CHECK
  status VARCHAR       -- ❌ No NOT NULL
);
```

**Recommended fix:**
```sql
CREATE TABLE analyses (
  id BIGINT PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  question_count INT NOT NULL CHECK (question_count >= 0),
  status VARCHAR NOT NULL DEFAULT 'pending'
);
```

**References:**
- Commit 3cdd1b2: "Add database constraints for question_count and theme_count (data integrity)"

---

#### 12. DefaultValueConsistencyRule
**File:** `scripts/quality-engine/rules/data-integrity.ts`  
**Severity:** Medium  
**Pattern:** Detects inconsistent DEFAULT values (boolean vs string)

**Why it matters:**
- Inconsistent defaults cause subtle comparison bugs
- Some columns default to `false` (boolean), others to `'false'` (string)
- Leads to unexpected behavior in WHERE clauses

**Example violation:**
```sql
CREATE TABLE config (
  enabled_v1 BOOLEAN DEFAULT false,    -- ❌ Inconsistent
  enabled_v2 VARCHAR DEFAULT 'false'   -- ❌ Inconsistent (string!)
);
```

**Result in application:**
```typescript
if (config.enabled_v1 === false) { }        // ✅ Works: false === false
if (config.enabled_v2 === false) { }        // ❌ Bug: 'false' !== false (string vs boolean)
```

**Recommended fix:**
```sql
CREATE TABLE config (
  enabled_v1 BOOLEAN DEFAULT false,
  enabled_v2 BOOLEAN DEFAULT false  -- ✅ Consistent
);
```

---

#### 13. TruncationValidationRule
**File:** `scripts/quality-engine/rules/data-integrity.ts`  
**Severity:** Low  
**Pattern:** Detects string truncation without ellipsis indicator

**Why it matters:**
- Truncated text should indicate truncation with `...`
- Users see incomplete sentences without visual cue
- UX degradation (confusion about what content is missing)

**Example violation:**
```typescript
const truncated = question.slice(0, 50);
return truncated;  // ❌ "What is the meaning of l" (cut off abruptly)
```

**Recommended fix:**
```typescript
const maxLength = 50;
const truncated = question.length > maxLength
  ? question.slice(0, maxLength) + '...'
  : question;
return truncated;  // ✅ "What is the meaning of l..." (indicates more content)
```

**References:**
- Commit 3cdd1b2: "Add ellipsis when FAQ answers are truncated to 50 chars"

---

## Implementation Summary

### Files Modified/Created:
1. **scripts/quality-engine/rules/security.ts** — Added 4 new security rules
2. **scripts/quality-engine/rules/quality.ts** — NEW file with 6 quality rules
3. **scripts/quality-engine/rules/data-integrity.ts** — NEW file with 3 data integrity rules
4. **scripts/quality-engine/rules/index.ts** — Updated exports and rule count

### Rule Statistics:
| Category | Before | After | Added |
|----------|--------|-------|-------|
| Architecture | 11 | 11 | 0 |
| Security | 9 | 13 | 4 |
| Streaming | 7 | 7 | 0 |
| Persistence | 5 | 5 | 0 |
| UI | 10 | 10 | 0 |
| Quality | 0 | 6 | 6 |
| Data Integrity | 0 | 3 | 3 |
| **TOTAL** | **42** | **55** | **13** |

### Test Coverage:
- All rules compile without errors
- Rules successfully load via `rules/index.ts`
- Quality engine executes all rules without crashing
- Rules correctly identify violations in test code

### Quality Gate Status:
✅ Type-check: 0 errors  
✅ Lint: Clean  
✅ Rule loading: 55/55 rules loaded  
✅ Quality engine: Executes all rules without errors  

---

## Usage Examples

### Running Quality Engine with New Rules:
```bash
# Full scan (all files)
pnpm exec tsx scripts/verify-quality-engine.ts --mode full

# Diff mode (only changed files)
pnpm exec tsx scripts/verify-quality-engine.ts --mode diff

# Working tree (uncommitted changes)
pnpm exec tsx scripts/verify-quality-engine.ts --mode working-tree
```

### Output Format:
```json
{
  "file": "web/app/api/chat/capture-question/route.ts",
  "severity": "high",
  "title": "Security: YAML injection vulnerability (unescaped values)",
  "why": "YAML front matter contains unquoted values...",
  "fix": "Escape YAML values: wrap in quotes..."
}
```

---

## Migration Guide for Existing Code

### If Your Code Triggers New Rules:

1. **WhitelistPathSanitizationRule** ➜ Replace blacklist with whitelist
2. **InformationDisclosureRule** ➜ Remove internal details from error logs
3. **YamlInjectionRule** ➜ Use escape helper for YAML values
4. **ReservedKeywordRule** ➜ Rename variables to non-reserved names
5. **AsyncWithoutAwaitRule** ➜ Remove redundant `async` or add `await`
6. **DeadCodeRule** ➜ Remove unreachable code blocks
7. **VariableNamingRule** ➜ Use clear multi-letter names
8. **TimeoutCleanupRule** ➜ Add `clearTimeout()` in cleanup
9. **ImportOrderingRule** ➜ Reorganize imports (framework → third-party → internal)
10. **ErrorObservabilityRule** ➜ Add logging/Sentry to catch blocks
11. **DatabaseConstraintRule** ➜ Add NOT NULL and CHECK constraints
12. **DefaultValueConsistencyRule** ➜ Standardize boolean defaults
13. **TruncationValidationRule** ➜ Add `...` when truncating text

---

## References & Sources

**Commits analyzed for patterns:**
- 2fa445b: Path traversal whitelist fix
- d1620a9: Information disclosure fix
- e5618a6: YAML injection escape fix
- 3cdd1b2: CodeRabbit critical findings batch
- cc2c51a: DeepSource quality issues

**Standards referenced:**
- CWE-22: Path Traversal
- CWE-94: Code Injection (YAML)
- CWE-209: Information Exposure
- OWASP Top 10: A03:2021 – Injection

---

**Status:** ✅ WAVE 9 Complete  
**Date:** 2026-07-09  
**Ruleset Version:** 1.0  
**Total Rules:** 55
