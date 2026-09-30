# Agent Dispatch Prompt — R3b step 1: Jev semantic boundary engine (pure) + Settings Registry keys

**Target Agent**: OC (`glm-preset/@preset/glm-53-flash-on-cheap`, CLAUDE.md "OC model standard")
**Effort Level**: medium

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.
>
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

## HARD RULES (read first)

1. Work ONLY in the worktree `/home/kellyb_dev/projects/hex-yt-intel-r3b` (branch `feat/r3b-jev-engine`). Home dir is `/home/kellyb_dev` (UNDERSCORE).
2. NEVER create scratch/debug test files (`zz-*`, `tmp-*`, `debug-*`). If a test fails twice for the same reason, STOP and report `[BLOCKED]` with the output — do not loop.
3. Do NOT apply any migration to the live database. Write the `.sql` file only. CC applies it (ADR 018).
4. Do NOT touch: `processing_jobs` (does not exist — do not create it), `prior_payload`, `stream-token.ts`, `projective-context*`, persist/finalize/reaper code, `synthesis.ts` bundles, the worker. That is step 2, pending a user decision.
5. No LLM/model calls, no network, no new npm dependency. Pure TypeScript only.
6. Commit when done (no push). Paste `git status --short` before committing: only the files listed in §2.

---

## 1. Context & Problem Statement

ADR 037 (`docs/private/ADR_037_JEV_SEMANTIC_CHUNKING_VARIANCE_BOUNDARIES_2026-09-29.md` — read it in full) replaces transcript truncation with semantic chunk boundaries placed where information density changes. User decisions (2026-09-30): **Option A (map-reduce)** is the target topology; the CDI spec is **locked**: sliding window N=100 words, `CDI = target terms / total words`, boundary candidate where `ΔCDI > τ`. No LLM-based boundary detection.

This step builds ONLY the pure, deterministic engine and its registry keys. Wiring into the pipeline (dynamic stream count, signing, finalize/reaper) is step 2 and is out of scope.

Registry pattern to copy: `supabase/migrations/20260911180911_remediation_quarantine_ttl_setting.sql` (insert into `setting_definitions` + seed `setting_values`, `on conflict do nothing`). Clamp/resolver pattern to copy: `resolvePriorPayloadMaxBytes` in `web/lib/config/prior-payload.ts`.

---

## 2. Contract & Implementation Directives

Do these steps IN ORDER.

**Step 1 — ledger `[IN_PROGRESS]`** (target files below).

**Step 2 — config: `web/lib/config/jev.ts`.** Export `JevConfig` (type), `JEV_DEFAULTS`, `JEV_BOUNDS` and `resolveJevConfig(raw: Record<string, unknown>): JevConfig`, which reads each key below from `raw` (keyed by the full registry key), falls back to the default when missing/non-finite/wrong type, and clamps numbers to `[min,max]`. Also enforce `minChunkTokens <= maxChunkTokens` (if violated, use defaults for both). These are the ONLY 14 tunables; the engine must read nothing else numeric:

| # | Registry key | Type | Default | Min | Max |
|---|---|---|---|---|---|
| 1 | `analysis.jev.enabled` | boolean | false | – | – |
| 2 | `analysis.jev.windowWords` | number | 100 | 20 | 1000 |
| 3 | `analysis.jev.windowStrideWords` | number | 100 | 10 | 1000 |
| 4 | `analysis.jev.deltaCdiThreshold` (τ) | number | 0.08 | 0 | 1 |
| 5 | `analysis.jev.fluffCdiThreshold` (θ_fluff) | number | 0.05 | 0 | 1 |
| 6 | `analysis.jev.minChunkTokens` | number | 1500 | 100 | 50000 |
| 7 | `analysis.jev.maxChunkTokens` | number | 6000 | 200 | 100000 |
| 8 | `analysis.jev.maxChunks` | number | 8 | 1 | 32 |
| 9 | `analysis.jev.acronymMinLength` | number | 2 | 2 | 6 |
| 10 | `analysis.jev.contentWordMinLength` | number | 4 | 1 | 12 |
| 11 | `analysis.jev.countAcronyms` | boolean | true | – | – |
| 12 | `analysis.jev.countProperNouns` | boolean | true | – | – |
| 13 | `analysis.jev.countNumbers` | boolean | true | – | – |
| 14 | `analysis.jev.countContentWords` | boolean | true | – | – |

"Tokens" = whitespace-separated words (no tokenizer exists; say so in a doc comment). Integers (2,3,6,7,8,9,10) are `Math.floor`ed.

**Step 3 — migration file** `supabase/migrations/20260930120000_jev_engine_settings.sql`: the 14 `setting_definitions` rows (tier `system`, owner_role `admin`, `validation` with min/max for numbers, a real description each) + the `setting_values` seed, same shape as the pattern file. Do NOT apply it.

**Step 4 — lexicon: `web/lib/jev/lexicon.ts`.** Export `STOPWORDS` and `FILLER_TERMS` (`ReadonlySet<string>`, lowercase): common English stopwords (~150) and filler ("um", "uh", "like", "basically", "literally", "actually", "yeah", "okay", "so", "right", plus sponsor words "sponsor", "sponsored", "promo", "discount", "subscribe"). These are data lists, not tunables.

**Step 5 — engine: `web/lib/jev/boundary-engine.ts`.** Pure functions, no imports except `./lexicon` and the `JevConfig` type:
- `tokenize(transcript: string): string[]` — split on whitespace, drop empties.
- `isTargetTerm(word, prevWord, cfg): boolean`. Strip leading/trailing punctuation first. Acronym: `/^[A-Z][A-Z0-9]*$/` with length ≥ `acronymMinLength` and at least 2 capitals. Number: `/^\d/`. Proper noun: first char uppercase AND `prevWord` exists AND prevWord does not end in `.?!`. Content word: lowercase form not in STOPWORDS or FILLER_TERMS, length ≥ `contentWordMinLength`, letters only. Each rule is gated by its `count*` flag. Filler terms are NEVER target terms.
- `computeWindows(words, cfg): { start: number; end: number; cdi: number }[]` — window t covers `[t*stride, min(t*stride+N, words.length))`; the last window may be shorter; stop once a window reaches the end. `cdi = targets / (end-start)`. Empty input → `[]`.
- `boundaryCandidates(windows, tau): number[]` — word indexes `windows[t].start` for every `t >= 1` where `Math.abs(windows[t].cdi - windows[t-1].cdi) > tau` (strict `>`). Window 0 is never a candidate.
- `chunkTranscript(transcript, cfg): JevChunk[]` where `JevChunk = { index: number; startWord: number; endWord: number /* exclusive */; text: string; wordCount: number; meanCdi: number; fluffRatio: number /* windows fully inside the chunk with cdi < fluffCdiThreshold ÷ such windows; 0 if none */; forcedCut: boolean }`. Algorithm: cursor = 0; while cursor < n: if `n - cursor <= maxChunkTokens` → final chunk to n. Else pick the cut `c` in `[cursor+minChunkTokens, cursor+maxChunkTokens]`: prefer the candidate in that range closest to `cursor+maxChunkTokens` (tie → smaller index), then SNAP it forward to the first sentence end at or after it (a word ending in `.`, `?` or `!`; cut goes AFTER that word) as long as the snapped cut stays `<= cursor+maxChunkTokens`; if no candidate snaps, take the LAST sentence end in range; if there is no sentence end in range (auto-captions often have no punctuation), cut at exactly `cursor+maxChunkTokens` and set `forcedCut: true`. If a remainder `< minChunkTokens` would be left after the cut, merge it into the current chunk instead ONLY if the merged size is `<= maxChunkTokens`; otherwise keep the short final chunk. After chunking, if `chunks.length > maxChunks`, merge the adjacent pair with the smallest combined word count, repeatedly, until `<= maxChunks` (merges may exceed `maxChunkTokens`; that is the documented exception). Re-number `index` 0..k-1. `text` = the words joined by a single space.

**Step 6 — tests** (put ALL in `web/lib/__tests__/`; that folder is in the vitest include glob):
- `jev-config.test.ts`: defaults when raw is `{}`; clamping above max / below min; non-finite and wrong-type fall back; min>max falls back to both defaults; floor of integers.
- `jev-boundary-engine.test.ts`, one `describe` per ADR 037 invariant, using a seeded PRNG (write a 5-line mulberry32 inside the test file — no new dependency) to build 200 synthetic transcripts mixing dense sentences (acronyms, numbers, capitalised names), filler sentences, and some punctuation-free spans:
  1. Determinism: same input + cfg → deep-equal output.
  2. Coverage: chunks are contiguous, first starts at 0, last ends at n, word counts sum to n, joined chunk words === tokenize(input).
  3. Bounds: every chunk `wordCount <= maxChunkTokens` unless the maxChunks merge happened; every chunk except the last `>= minChunkTokens`; input shorter than min → exactly 1 chunk.
  4. No sentence split: every non-final boundary with `forcedCut === false` lands right after a word ending `.?!`.
  5. Degenerate: `''` and whitespace-only → `[]`; no candidates (uniform text) → still chunks by size; all-filler text → still chunked, fluffRatio of each chunk === 1 when every window is fluff.
  6. Monotonic τ: for τ1 < τ2, `boundaryCandidates(w, τ2).length <= boundaryCandidates(w, τ1).length` (all 200 inputs, several τ pairs).
  Plus exact-value unit tests: `computeWindows` on 250 words with N=100,S=100 → windows `[0,100) [100,200) [200,250)`; with S=50 → starts `0,50,100,150,200`; a hand-built 3-window example where you compute ΔCDI by hand and assert the candidate set, including a ΔCDI exactly equal to τ (NOT a candidate); `isTargetTerm` table cases for each rule and each flag off.

**Step 7 — gates** (§4a), then run qa-intel AFTER `git add`. Fix new-code findings; do not baseline new code.

**Step 8 — negative controls** (report the failing output for each, then restore): (a) change `>` to `>=` in `boundaryCandidates` → the equal-to-τ test must fail; (b) remove the sentence-end snap → invariant 4 must fail; (c) make `computeWindows` stride `N-1` → the exact-window test must fail.

**Step 9 — commit** (no push): `feat(jev): R3b step 1 — pure semantic boundary engine + 14 registry keys (ADR 037)`. Files allowed: `web/lib/config/jev.ts`, `web/lib/jev/lexicon.ts`, `web/lib/jev/boundary-engine.ts`, `web/lib/__tests__/jev-config.test.ts`, `web/lib/__tests__/jev-boundary-engine.test.ts`, `supabase/migrations/20260930120000_jev_engine_settings.sql`, `.memory/AGENT_LEDGER.md`, `.qa-intel/baseline.json` (only if a PRE-EXISTING finding resurfaces — none expected, these are new files). `git restore web/test-results.json` before committing.

**Step 10 — ledger `[DONE]`** with a real summary.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Use `docs/agent-prompts/TEMPLATE.md` §3 verbatim (the newest list). Matching for this task: STEP 0 `build-graph`; ALWAYS set (`qa-intel` diff + full, `code-reviewer`, `simplify`, `review-delta`, `review-duplication`, `contract-auditor`); `supabase/migrations/**` → `supabase-postgres-best-practices`, `supabase`, `database-sentinel` (no functions are created, so the REVOKE sub-check is N/A — say so). If a skill is not invocable in OpenCode, write "not available in OC" — do not pretend it ran.

---

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

Scoped checklist for this task: (1) write the `chunkTranscript` contract as a doc comment before the code; (2) E2E = raw transcript string → `resolveJevConfig(registry raw)` → `chunkTranscript` → chunks that satisfy all 6 invariants; (3) tangents: note (do not fix) anything in `web/lib/prompts/factory.ts`'s transcript budget that step 2 must change.

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
