# QA-INTEL ENGINE — PROMISE vs REALITY ASSESSMENT
**Version**: 1.0.0 · **Date**: 2026-06-29 · **HEAD**: df60965
**Question answered**: Is qa-intel a real AST engine that delivers what it claims, enough to lean on it and reduce dependence on free-tier PR-review bots?

---

## VERDICT: Real engine, overclaimed marketing, fixable trust gaps.

**Confidence rating: 7/10 as a static analyzer; 3/10 as currently *gated* (false-green risk).**
It is genuinely an AST engine — not theater — but (a) the "4DST / multiple real-time live sources" framing is **false**, and (b) its CI integration currently manufactures green checks. Fix (b) and it becomes a trustworthy first-line gate that meaningfully reduces bot dependence.

---

## WHAT IT ACTUALLY IS (verified by reading the code)

| Claim | Reality | Evidence |
|---|---|---|
| Real AST engine | ✅ TRUE | `QualityEngine.analyze` parses via ts-morph, builds a real **import dependency graph** (`buildGraph`, L106-131), supports rule `scope: file\|neighbors\|graph`, injects `ctx.graph` for graph-aware rules. `SourceRegistry` = in-memory AST cache. Bounded-concurrency worker pool (L37-73). |
| 42 calibrated rules | ✅ TRUE | `rules/index.ts`: architecture 11 + security 9 + streaming 7 + persistence 5 + ui 10. Each consumes a real `SourceFile` AST. |
| Calibrated against benchmarks | ✅ TRUE (offline) | SmellyCode++ + SARD/Juliet + CRBench + Big-Vul/Devign ingesters; `.qa-intel/calibration-results.json` present. |
| Self-analysis suppression | ✅ TRUE | `QualityEngine.ts:31-34` filters its own rule files to avoid FP feedback loops. |
| **"4DST engine / multiple real-time live sources"** | ❌ **FALSE / overclaimed** | There are **no live or real-time data sources** during a scan. The only external fetches are `calibration/fetch-smellycode.sh` (figshare dataset) and `SardCalibrationIngester` — both **explicitly labelled** `CALIBRATION-ONLY and do not affect live runtime/PR scans`. It is a **single-source, offline-calibrated static analyzer**. No HTTP, no Sentry/Supabase/Vercel live feeds wired into the analysis pass. |

**Bottom line:** the engine is real and useful. The "4D / live multi-source" branding describes an aspiration, not the shipped code. Trust the AST analysis; discount the "live sources" claim until/unless real feeds are wired in.

---

## TRUST GAPS (these are why "green" can lie — fix permanently)

1. **`exit(0)` on ts-morph load failure** (`verify-quality-engine.ts:189-191`) → if the parser fails to load (pnpm strict/unhoisted), the gate passes green having scanned **nothing**. PR #98's bullet claimed `exit(1)` but the live code still exits 0. → **must be `exit(1)`.**
2. **`high` is non-blocking; only a (non-existent) `critical` tier blocks** → a full scan with **61 high findings exits 0**. "0 blocking findings" in PR #98 was true by *threshold*, not by cleanliness. → **treat `high` as blocking** (or introduce + map a `critical` tier).
3. **Per-rule / per-file errors are swallowed** (`QualityEngine.ts:59-65` `console.error`+continue) → a rule that throws on every file yields **zero findings** and the run still exits 0. Findings silently lost. → **count failures; fail the run if any rule errors.**
4. **Implicit `--ci`** (`ci-cd.yml:112` runs without `--ci`) → blocking depends on the runner exporting `CI`. → **pass `--ci` explicitly.**
5. **A dead rule (SSOT bug):** `rules/streaming.ts:30` (and dup `StreamingRuleEngine.ts:30`) do `text.includes('All ${TOTAL_DIMENSIONS} dimensions must be present')` — `${TOTAL_DIMENSIONS}` is inside **single quotes**, a literal string, never the interpolated number → **the rule can never match.** It should import `TOTAL_DIMENSIONS` from `@/lib/config/synthesis` and build the string. (Micro-instance of both the fabricated-green AND single-source-of-truth problems.)
6. **Duplicate dead modules:** `*RuleEngine.ts` (Streaming/Security/Architecture/UI/Persistence) duplicate the lowercase rule files; `index.ts` only exports the lowercase set → the `*RuleEngine.ts` copies are dead weight carrying the same bugs.
7. **No line numbers in findings** — findings carry `file` but not `line`, so triage is file-level. Useful as a heat-map; not precise. (Enhancement, not a trust bug.)
8. **FP profile:** over-fires "Path Traversal" on static `app/**/page.tsx` (4/5 are FPs) — add a static-route skip.

---

## WHAT MAKES IT THE TRUSTED GATE (do these → confidence 7→9, lean off bots)

- Fixes 1-4 above (exit codes + blocking severity + explicit `--ci` + error surfacing) — **this is the "fabricated greens" permanent remediation.** After this, a green qa-intel run is a real signal.
- Fix 5-6 (dead rule + dup modules) so rule count = effective rule count.
- Add `line` to `Finding` (ts-morph `node.getStartLineNumber()`), wire one real live source if "4DST" is to mean anything (e.g. post-merge Sentry issue counts feeding a "regression risk" rule) — optional, but would partially honor the branding.

**Net:** qa-intel can credibly be the first of the 4 checks (qa-intel → type-check → lint → security), absorbing the deterministic findings so CodeRabbit/cubic/Sourcery only see what's left — **but only after the false-green fixes.** Today, leaning on it as-is would itself be a fabricated-green.
