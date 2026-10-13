# PR #501 Hostile-Adversarial Red-Team Review Gate Evidence

**PR Number**: #501
**Branch**: `fix/combiner-dedupe`
**Target**: `origin/uat`
**Head SHA**: `1f87e4ae`
**Timestamp**: 2026-10-13T17:49:00+03:00

---

## 1. Skill Execution: `refactor-safely` & `contract-auditor`
- **Target**: `web/lib/services/CombinerPass.ts` and `web/lib/services/combiner-dedupe.ts`
- **Architectural Scope**:
  - Pre-PR Risk: `CombinerPass.ts` had expanded to over 500 lines, violating the codebase's monolithic file constraint.
  - Decomposition Strategy: Extracted deduplication, normalization, and token comparison helpers into `web/lib/services/combiner-dedupe.ts` (288 lines), leaving `CombinerPass.ts` at 317 lines.
  - Line-Count Gate Compliance: Both files are strictly <500 lines.
- **Contract Preservation**:
  - `CombinerPass.ts` re-exports all contracts via `export * from './combiner-dedupe'`.
  - Interfaces `ParsedSubSection`, `ParsedDimensionAST`, `DimensionChunk`, and all static methods (`CombinerPass.parseDimensionMarkdown`, `CombinerPass.combineDimensionChunks`, `CombinerPass.reduceDimensions`) remain 100% byte-compatible with existing callers.
- **Verdict**: PASS.

---

## 2. Blast Radius & Dependency Tracing via `code-review-graph`
- **Graph Inquiries**:
  - `code-review-graph query callers_of "web/lib/services/CombinerPass.ts::CombinerPass.reduceDimensions"`
  - `code-review-graph search "CombinerPass"`
- **Call Chain**:
  - Direct Caller: `web/lib/services/stitch-analysis-chunks.ts::stitchChunksIntoPayload` at line 236.
  - Direct Caller: `web/lib/services/reduce-grounded-chunks.ts` at line 24.
  - Test Harnesses:
    - `web/lib/__tests__/pr442-group4-fixes.test.ts`
    - `web/lib/__tests__/reduce-grounded-chunks.test.ts`
    - `web/lib/__tests__/reduce-grounded-section-merge.test.ts`
- **Circular Import Audit**:
  - `combiner-dedupe.ts` has ZERO external imports (pure AST and string processing functions).
  - Graph traversal confirms: zero circular dependencies and zero import cycles.
- **Verdict**: PASS.

---

## 3. ARTAS Hostile-Adversarial Red-Team Audit

### 3.1 Attacker & Failure Mode Modeling
- **Actor/Vector**: Malformed LLM Markdown AST / Numerical & Currency Collision / Loss of Video Timestamps / Non-Latin Unicode inputs.
- **Failure Mode**: Epistemic data corruption during Map-Reduce dimension merging. In previous implementations, naive string containment or whitespace normalization caused:
  1. False-positive deduplication collisions dropping critical financial metrics ($5 vs $50).
  2. Loss of real user timestamps when merged with placeholder text.
  3. Overwriting distinct glyphs or non-Latin text (e.g. Arabic, ratings).

### 3.2 Boundary Stress: Empirical Verification
1. **Currency & Strict Token Boundaries**:
   - `isTokenSubsequence()` splits on whitespace and validates whole-token equality.
   - Empirical Proof: `$5` is NOT dropped as duplicate of `$50`. `15000` is NOT dropped as duplicate of `150000`.
2. **Glyph & Symbol Distinction**:
   - `isSymbolOnly()` identifies non-alphanumeric text (`!/[\p{L}\p{N}]/u`).
   - Empirical Proof: `☆☆☆☆☆` and `★★★★★` are preserved as distinct blocks. Identical symbol blocks are deduplicated to exactly one instance.
3. **Decimal Separator Protection**:
   - `normalizeForComparison()` converts `.` to `'point'` and `,` to `'comma'` between digits.
   - Empirical Proof: `3.14` and `3,14` are kept distinct.
4. **Timestamp Upgrade Invariant**:
   - `hasRealTimestamps()` identifies non-zero timestamps (`/[1-9]/u`).
   - Empirical Proof: Real timestamps (`[04:15]`, `[10:00]`) upgrade placeholder timestamps (`[timestamp not provided]`, `[00:00]`). Real timestamps are NEVER overwritten by longer placeholder strings.
5. **Dropped Block Diagnostics**:
   - All dropped blocks emit structured diagnostic metrics to console:
     `[CombinerPass] Dropped duplicate block in sub-section { reason, droppedChars, keptChars }`
     `[CombinerPass] Sub-section merge dropped blocks { droppedCount }`

### 3.3 Vitest Runtime Execution & Proof
- **Command**: `pnpm --filter @hex-yt-intel/web exec vitest run lib/__tests__/pr442-group4-fixes.test.ts lib/__tests__/reduce-grounded-chunks.test.ts lib/__tests__/reduce-grounded-section-merge.test.ts`
- **Output**:
  ```text
  ✓ lib/__tests__/reduce-grounded-section-merge.test.ts (6 tests) 16ms
  ✓ lib/__tests__/reduce-grounded-chunks.test.ts (36 tests) 35ms
  ✓ lib/__tests__/pr442-group4-fixes.test.ts (36 tests) 26ms

  Test Files  3 passed (3)
  Tests       78 passed (78)
  Duration    862ms
  ```

### 3.4 Negative Control Falsification
- **Test**: Revert `isTokenSubsequence` token boundary match to naive `longer.includes(shorter)`.
- **Empirical Result**: Test `'does not drop $5 as a duplicate of $50'` immediately fails because `"Budget $50".includes("Budget $5")` evaluates to true, dropping the $5 block. Restoring `isTokenSubsequence` ensures 100% test pass.

---

## 4. Overall Review Verdict
**Status**: APPROVED (Decomposition proven clean; zero circular imports; hostile boundary invariants verified).
