# UCIS Naming Fix — v5.1 → v5.3

## 1. RCA
The UCIS prompt file was named `ucis-v5.1.ts` but the internal version string and banner text both said v5.3. This caused inconsistency: the file name, exports, and imports all referenced v5.1 while the actual content was v5.3. The `settings.ts` import path also referenced `UCIS_V5_1_SYSTEM` from `ucis-v5.1`, diverging from `factory.ts` which already imported `UCIS_V5_3_SYSTEM` from `ucis-v5.3`.

## 2. Contract
- Rename file `ucis-v5.1.ts` → `ucis-v5.3.ts`
- Rename constant `UCIS_V5_1_SYSTEM` → `UCIS_V5_3_SYSTEM`
- Update all imports and references across the codebase
- Delete the old file
- Must pass `tsc --noEmit` and all tests

## 3. Fix
- Renamed `web/lib/prompts/ucis-v5.1.ts` → `web/lib/prompts/ucis-v5.3.ts` (file already existed with identical content — deleted the old `ucis-v5.1.ts` after updating all references)
- Updated `factory.ts` (line 77): `UCIS_V5_1_SYSTEM` → `UCIS_V5_3_SYSTEM`
- Updated `settings.ts` (lines 7, 81, 105): import and both usages → `UCIS_V5_3_SYSTEM` from `ucis-v5.3`
- Updated `PromptBuilder.ts` (worker) (lines 2, 32): import and fallback → `UCIS_V5_3_SYSTEM` from `ucis-v5.3`
- Updated `synthesis.ts` (lines 77, 97): comments referencing `ucis-v5.1.ts` → `ucis-v5.3.ts`
- Updated `generate-prompt-migration.js` (lines 4, 12): file path and constant name → `ucis-v5.3.ts`, `UCIS_V5_3_SYSTEM`
- Left historical RCA comments in `contract-auditor.ts` and `WorkerPromptConfigAdapter.ts` as-is (they describe historical bugs in v5.1)

## 4. Tangents
- The old `ucis-v5.1.ts` still existed with the same content as `ucis-v5.3.ts` — the rename was incomplete
- `settings.ts` had the import updated but still referenced `UCIS_V5_1_SYSTEM` in two places in the function body
- `factory.ts` already imported `UCIS_V5_3_SYSTEM` but still compared against `UCIS_V5_1_SYSTEM` — causing a type error (unused import + undefined reference)
- `generate-prompt-migration.js` would have broken if run (file path to deleted file) — updated to v5.3

## 5. Skills Run
- `ponytail` — minimal changes, no over-engineering

## 6. Gates
- `tsc --noEmit` (web): ✅ Passed
- `tsc --noEmit` (worker): ✅ Pre-existing test-file errors only; no new errors from UCIS changes
- `vitest run` (59 files, 973 tests): ✅ Passed

## 7. Files Changed
- `web/lib/prompts/ucis-v5.1.ts` — deleted
- `web/lib/prompts/factory.ts` — `UCIS_V5_1_SYSTEM` → `UCIS_V5_3_SYSTEM` (line 77)
- `web/lib/services/settings.ts` — import path + 2 body references updated (lines 7, 81, 105)
- `web/lib/validators/synthesis.ts` — 2 comment references updated (lines 77, 97)
- `web/scripts/generate-prompt-migration.js` — file path + constant name updated (lines 4, 12)
- `worker/src/services/PromptBuilder.ts` — import path + fallback reference updated (lines 2, 32)