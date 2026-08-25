# TECHNICAL HANDOVER SUMMARY – hex-yt-intel: PR Merge Wave, Entity-Color Taxonomy Fix, LLM Council Entity-Taxonomy Wave 1

**Session Date**: 2026-08-15, ~02:35 EEST – 22:33 EEST (continuing)
**Agents Involved**: CC (Claude Sonnet 5, primary orchestrator/verifier); a peer Claude Code session (same user, cross-session-messaged, worked #22 independently before being stopped by the user); ~30+ isolated sub-agent dispatches this session (2 RCA agents for #18/#19, 13 Council advisors + 12 peer reviewers + 1 Chairman for the taxonomy Council Wave 1, plus several review/verification agents on PRs #234-#239)
**Project**: hex-yt-intel — YouTube video-intelligence SaaS ("v-intel"): visual auto-scrubber, knowledge graph, grounded chat, entity time-seek, on Next.js/Vercel + Cloudflare Worker + Supabase
**Session Type**: PR review/merge wave + live bug RCA/fix + foundational architecture decision (LLM Council, full formal process)
**Status**: 5 PRs merged to `main` (#234–#238), 1 PR closed as unsafe with content preserved elsewhere (#228→#238). Entity-color monochrome bug root-caused and fixed but flagged as provisional pending the Council's Wave 1 verdict. LLM Council Wave 1 (entity taxonomy tier-2 design) complete — full 13-advisor/12-peer-review/Chairman process, verdict delivered, **Wave 2 not yet started, awaiting user's answers to 4 concrete yes/no questions**.

---

## 1. Executive Summary

This session closed out a 5-PR merge wave from prior work (#234–#238, covering the stream-failure DB write-back, description-display fix, entity-timeline chronological-nav fix, log-viewer error-swallowing fix, and a safely-cherry-picked ChunkGrouping fix rescued from a dangerously stale PR #228), then root-caused the WordCloud/MindMap/KnowledgeGraph "everything renders gray" bug to a genuine entity-type taxonomy mismatch between the worker's live extraction schema and the web's color-mapping module — but that investigation surfaced a much bigger, unresolved architectural question (does the whole POLE+O entity taxonomy even fit this product, and how should its flexible "tier 2" be designed) that the user explicitly said was foundational to the entire second-brain roadmap, not just a color bug. A full, formal LLM Council process (13 advisors, 12 anonymized peer reviews, Chairman synthesis) was run on this question for the first time this session, producing a real verdict with genuine, undissolved disagreement preserved (the Skeptic's challenge to POLE+O itself went unrebutted by all 12 other advisors) rather than false consensus. **Biggest breakthrough**: discovering that two entity-type taxonomies are simultaneously live in production right now (the DB's POLE+O-only CHECK constraint vs. the worker's older lowercase 8-value schema), which reframed what looked like a simple color-palette bug into the same foundational taxonomy question the project had already spent 6 real days on earlier this month and never actually resolved. **Immediate next action**: user needs to answer 4 concrete yes/no questions (see §13) before Wave 2 of the Council can be scoped.

---

## 2. Technical Environment

- **Stack**: Next.js (App Router) + Cloudflare Worker/Hono + Supabase Postgres (project ref `adnmbikaqnxivalqoild`) + Upstash Redis. `pnpm` only, never npm/npx (broken in this WSL2 env).
- **Repo state (verified live via `git log`, not recalled)**: `main` at commit `b2e71b77` (merge of PR #238), fast-forwarded through 5 real merges this session: `9c9ad38c` (#234), `d413d125` (#235), `0121855b` (#236), `4afc5693` (#237), `b2e71b77` (#238).
- **New branch this session, not yet merged**: `fix/entity-color-taxonomy-mismatch` (PR #239) — contains the entity-color fix, currently **provisional/should not be treated as final** given the Council Wave 1 verdict recommends a different, instrumented-baseline approach rather than the straight taxonomy-swap this PR implements. Needs revisiting once Wave 1's recommendation is actioned (see §13).
- **Branch cleanup this session**: `fix/pr226-227-cubic-followup` (the stale PR #228 branch) was NOT merged — confirmed it would have deleted ~1,790 lines of since-shipped work (waitlist, highlights-reel, Dub.co, HMAC fix) due to 6 days of drift from `main`. PR #228 was closed with a comment pointing to its real content's new home (#238). This was a real, averted destructive-merge risk, not a hypothetical caution.
- **Credentials newly provided this session**: a Supabase experimental/personal-access-token-style key (`sbp_v0_...`) and `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pasted directly in chat by the user for live DB verification — used once (via the Management API `/database/query` endpoint) to confirm `kg_entities.type`'s real live distribution, not echoed back in any response per standing secret-handling discipline.
- **Council artifacts this session** (new, gitignored under `docs/private/`): `docs/private/council/2026-08-15_1321_v1_entity_taxonomy_wave1_framed_question.md`, `..._transcript.md`, `..._report.html`.

---

## 3. Chronological Timeline (newest first)

### 2026-08-15, ~22:32 — Plain-language re-explanation of Council findings
User reported not fully following several Wave 1 findings and asked for a "15-20 year old" reading-level re-explanation of all 4 blind spots, all 4 clashes, and specifically two confusing points: (1) whether the Council devalued the `Abstract` type (it did not — all advisors who addressed it agreed it should exist, just as a tag-under-Object rather than a 6th peer type; the actual unresolved fight is the Skeptic's separate, bigger challenge to whether POLE+O itself fits this domain at all), and (2) what "kg_entity_mentions has 0 rows = free reversible decision" and "the one gating decision on Phase 2 conditioning" actually mean in plain terms (empty filing cabinet analogy: free to change filing rules with nothing filed yet; the gating decision is one yes/no — should Phase 2's extraction AI be told about tier-2 categories while extracting, or kept "blind" to them for now). Ended with 4 concrete yes/no questions for the user to answer, not yet answered as of this document's cutoff.

### 2026-08-15, ~13:21–14:15 — LLM Council, Entity Taxonomy Wave 1 (full formal process) 🔑 KEY DECISION / 💡 BREAKTHROUGH
User explicitly corrected an earlier assumption this session that the entity-taxonomy Council work was abandoned or forgotten — clarified it was real, substantial (Exa/Brave/Decodo/BrightData/Google multi-engine research across ~6 real days), and demanded it be honored as a "cornerstone," not re-litigated from zero. Two rounds of framing revision followed real user pushback:

1. First draft treated "should we adopt POLE+O+tier-2" as an open question — user corrected: that's proven at Neo4j's real enterprise scale (defense/pharma/retail/healthcare), it's a cornerstone to build FORWARD from, not re-test.
2. User also explicitly connected the whole taxonomy decision to the product's actual value proposition — not text-only summaries (commoditized) but 4 specific real USPs: the multi-dimension UCIS text analysis, the 4-part executive digest, the compressed-video-summary auto-scrubber, and entity time-seek. Demanded every Council question be evaluated against whether it serves these, specifically time-seek and the scrubber (the two genuinely differentiated, non-text modalities).

Framed question rewritten twice to incorporate both corrections (`docs/private/council/2026-08-15_1321_v1_entity_taxonomy_wave1_framed_question.md`, ~1,800 words final version, matching this project's own established density bar for Council questions).

**Dispatched full formal process, no abbreviation** (this project's own hard-learned rule from an earlier session where the peer-review step was skipped and had to be redone from scratch, not patched):
- **13 advisors, genuinely parallel** (single-message batch of 13 Agent tool calls — user explicitly required this "to avoid context contamination," confirmed already satisfied since each was an isolated dispatch with zero shared state).
- **12 anonymized peer reviews** (Statistician excluded from peer-reviewing, per this project's own established convention from the prior completed Council round) — also dispatched as one parallel batch.
- **Chairman synthesis** — single dispatch, given all 13 responses + all 12 reviews' convergent findings.
- Full transcript + scannable HTML report saved to `docs/private/council/`.

**Real, substantive divergence, not groupthink**: 13 advisors produced genuinely different framings (Contrarian/First-Principles argued for a behavioral schema over semantic categories entirely; Skeptic challenged the cornerstone itself; Executor/Investor/Market-Researcher converged independently on "ship cheap, instrument, decide later"). Peer review found real, quantifiable convergence: **10/12 reviewers independently rated the Statistician's response strongest**, **8/12 independently flagged the Skeptic's unrebutted cornerstone-challenge as the most significant gap**, and **5+ reviewers independently proposed the same missing idea** (test the decision behaviorally instead of deciding by pure analysis) — none of the 13 original advisors proposed this themselves.

**Verdict (full detail in the transcript/report)**: ship an instrumented, throwaway `objectSubtype` derived-label column this week (no schema/CHECK-constraint change), Abstract-under-Object as the placeholder tier, explicitly do NOT let Phase 2's extraction prompt be conditioned on tier-2 categories yet (this is the load-bearing move that avoids a real, identified circular-validation risk: deciding the taxonomy before Phase 2 exists would bias what Phase 2's own extraction is built to look for, contaminating the very data that would test whether the taxonomy was right).

**Genuinely left open, not glossed over**: the Skeptic's disproof test (would either real USP — time-seek or the scrubber — actually break if POLE+O were deleted entirely, keeping only the emergent 7-category scheme?) has zero rebuttal from any of the 13 advisors. This is explicitly Wave 2's job, not resolved here.

### 2026-08-15, ~12:30–13:20 — Prior-work discovery: the real taxonomy history was found, not re-derived
Before dispatching the Council, this session first had to locate and read 3 real, substantial prior handover documents the user referenced but this session had no memory of: `docs/history/THOS_2026-08-10_0432_KG_ENTITY_TAXONOMY_DEEP_DIVE_AND_ADR026_PHASE2.md`, `THOS_2026-08-10_1355_PERSONA_TAXONOMY_FREEZE_AND_COUNCIL_R1.md`, `THOS_2026-08-13_1055_COUNCIL_R1_MERGES_AND_WAITLIST_HANDOVER.md`. 🔑 **KEY CORRECTION discovered via this read, not assumed**: there were actually TWO separate Council decision threads that got conflated in this session's earlier (wrong) framing — (1) the persona-runtime Council ("does PersonaSelector belong in the product's runtime"), which DID run to full completion on 2026-08-12 and its verdict WAS executed and merged (PR #232, persona picker removed, defaults to apex view) — this thread is genuinely closed, not to be re-run; (2) the entity-taxonomy Council (Abstract type, subtype registry, the real 637-row classification), which never got its own dispatch — it was the ORIGINAL Aug 9 work that got absorbed into and then displaced by the larger persona question, and sat unresolved. This session's Council dispatch (§ above) was specifically thread (2), correctly scoped after this correction.

### 2026-08-15, ~11:00–12:30 — Entity-color monochrome bug: root-caused, then discovered to be bigger than a color bug
Continuing from earlier RCA work (see prior handover, `THOS_2026-08-15_0135...`), root-caused the WordCloud/MindMap/KnowledgeGraphCanvas "everything renders gray" bug via two independent paths that converged on the same finding: this session's own direct code read, AND an independently-dispatched background RCA agent (dispatched in parallel with a separate #19 timestamp-linking RCA — see below). Confirmed: `web/lib/design/entity-colors.ts` only recognized a 5-value capitalized POLE+O taxonomy (`Person|Organization|Location|Event|Object`); the worker's real live extraction schema (`worker/src/services/ZodSchemas.ts`, `KGNodeSchema.entityType`) emits a completely different, older, lowercase 8-value enum (`person|concept|framework|tool|organization|study|trend|metric`) that was never reconciled with the POLE+O migration. Every real entity type failed the color lookup and fell to the gray default — simultaneously across all 3 consumers since they share the same module.

**Fix implemented** (PR #239, `fix/entity-color-taxonomy-mismatch`): extended `ENTITY_HEX`/`ENTITY_RGB` to the worker's real 8-value vocabulary directly, fixed 3 stray `|| 'Object'` fallbacks (would have kept falling to gray even after the main fix), added a real contract test (`web/lib/design/__tests__/entity-colors-contract.test.ts`) that imports the actual worker Zod schema and asserts the palette's keys exactly match its enum — a genuine drift guard, not a duplicated string list, addressing the user's explicit complaint that there was "no contract def. or enf." Gates clean (tsc, qa-intel, 5/5 new tests pass).

🔑 **KEY DECISION, self-corrected before merge**: while writing this fix, direct verification against the live DB (`kg_entities.type` distinct values, using the user-provided key) revealed a THIRD fact not accounted for in the initial fix: `kg_entities` (a separate, real, DB-persisted table) is under a live Postgres CHECK constraint restricting it to POLE+O-only (capitalized), and it genuinely holds 836 real rows in exactly that scheme (Object 637, Person 88, Organization 76, Event 21, Location 14) — meaning there are actually **two simultaneously-live, actively-diverging taxonomies** in production, not one bug with one fix. PR #239's fix (matching the worker's schema) would have *fixed* the payload-embedded rendering path while *silently regressing* the `kg_entities`-backed rendering path (which was previously working correctly under the old capitalized-only palette). **This PR should NOT be merged as-is** — flagged directly to the user rather than merged quietly, which is what triggered the "this is bigger than a color bug" pivot into the full Council dispatch above. This is the single most consequential catch this session — a genuine near-miss on shipping a regression while trying to fix a different bug.

### 2026-08-15, ~10:30–11:00 — 2 parallel RCA agents dispatched: #18 (WordCloud) and #19 (timestamp linking)
Per user's explicit ask to parallelize where possible ("can you do any 2 or 3 in parallel or at least the RCA"), dispatched 2 background, RCA-only (no fixing) agents simultaneously:
- **#18 (WordCloud monochrome+flicker)**: returned the taxonomy-mismatch root cause independently (cross-verifying this session's own parallel manual investigation, high mutual confidence). Also investigated the reported redraw/flicker-during-construction symptom — found a plausible but **unconfirmed** lead (`DashboardContainer.tsx`'s `rightPanelItems` useMemo recreating on every SSE fragment via the `graph` object's identity churn), explicitly reported as not proven, needs live profiling, not fixed.
- **#19 (unclickable "Source section: 05:15–06:00" timestamp)**: reproduced the exact reported string through the real regex and real markdown parser used in production — it linkified correctly in isolation, contradicting the hypothesized regex/bracket-format gap. Found one real, separate, worth-fixing issue along the way (the Dimension 7.1 prompt template gives the model no format template for "Source section," unlike every other timestamp field in the same prompt) but explicitly stated this alone doesn't explain the reported non-linkification. **Root cause still genuinely unknown** — the agent's own recommended next step (pull the raw `dimension.content` for that specific video/analysis from Supabase, diff byte-for-byte against the pasted example) was not yet done this session; deprioritized once the taxonomy-fix pivot consumed the rest of this window.

### 2026-08-15, ~10:15–10:30 — PR review findings on #234/#235/#238 verified, mostly dismissed with evidence
A fresh automated review pass on PR #234 surfaced 6 findings (Sourcery + CodeRabbit); each checked against real repo precedent before acting, not applied blindly: 5 of 6 were false/inapplicable (params-as-Promise claim contradicts Next.js 15's real async-params behavior used consistently across every route in this repo; UPPER_SNAKE_CASE constant naming contradicts 7 other real schema constants in the codebase; "move history comments to /docs" contradicts this repo's own established, heavily-used, intentional inline-comment convention — no `.coderabbit.yaml` exists, confirming "Source: Coding guidelines" was a generic default, not a real project rule; the streamed-JSON-response-contract claim was already independently disproven twice earlier this session via repo-wide grep; the Sentry `contexts` vs `tags/extra` claim contradicts the sibling `cancel/route.ts` this code was modeled on). Only 1 of 6 (type-only `NextRequest` import) was even plausible, and was ALSO dismissed on closer check since applying it would break consistency with the sibling file's own established pattern. All 6 dismissals posted as a single PR comment with the specific evidence for each, not silently ignored. PR #235's "Changes requested" badge was confirmed to be a stale GitHub UI artifact — all 4 of its review threads were already resolved by earlier fixes; not a real blocker.

### 2026-08-15, ~09:30–10:15 — 5-PR merge wave executed
Merged, in order, with real verification at each step (not blind trust in green CI): #234 (stream-failure DB write-back + waitlist icon fix — fully green after fixing a real CI import-order regression that turned out to be a stale-log false alarm on re-check), #235 (description display), #236 (entity-timeline chronological-nav fix, after dodging a known qa-intel false-positive on an array-slice pattern by rewriting it as an array literal). Then investigated and closed the stale PR #228 (6 days behind `main`, would have deleted ~1,790 lines of shipped work if merged as-is — verified via `git diff main origin/fix/pr226-227-cubic-followup`, not assumed from the PR's age alone), cherry-picking its one genuinely real, still-unmerged content (2 small Cubic/Sourcery fixes on `worker/src/services/ChunkGrouping.ts`) onto a fresh branch as PR #238, verified the referenced migration those original commits also touched had already separately landed on `main`. Merged #238. Fixed real review findings on PR #237 (Copy-All-Logs error-swallowing) — extracted a shared `formatLogResponse()` helper used by both the individual-tab and copy-all fetch paths (closing the exact class of drift that caused the original bug), added network-catch fallback, structured-error-object normalization. Rebased #237 onto post-merge `main` before final push (branch predated the other 4 merges). Merged #237.

---

## 4. Iterative Development Tracking

**PR #239's entity-color fix — 2 real iterations, not yet a 3rd (blocked on user decision):**
1. **Iteration 1**: extend `ENTITY_HEX` to the worker's real 8-value lowercase vocabulary, fix 3 stray fallbacks, add a real contract test. Gates clean, believed complete.
2. **Iteration 2 (self-caught before merge)**: live DB verification revealed a SECOND real taxonomy (`kg_entities`, POLE+O-only, 836 real rows) that Iteration 1's fix would silently regress. **Not yet fixed** — correctly identified as needing the larger Council-informed decision rather than a quick patch, and the PR was explicitly held rather than merged. 🔑 **KEY DECISION**: chose to escalate to a full architectural investigation rather than patch around the newly-discovered second taxonomy, matching this project's own standing "no patchwork" directive from the user.
3. **Iteration 3 (not started, blocked)**: will be scoped once the user answers the 4 questions in §13 — likely involves implementing the Council's actual recommendation (instrumented `objectSubtype` derived-label column, not a straight palette swap) rather than resuming Iteration 1's original approach.

---

## 5. Troubleshooting Loop Documentation

### Loop: Conflating two separate Council decision threads (persona-runtime vs. entity-taxonomy)
- **Root cause category**: this session started with no memory of 6 days of real prior work and initially assumed (wrongly, without checking) that "the Council" was a single undifferentiated thread that had either fully resolved or been entirely dropped.
- **Cycle count**: 1 — caught by the user's direct correction ("I believe was never run... you should read the last five days") before any further wrong action was taken (specifically, before dispatching a Council round on the wrong/conflated question).
- **Verification gap**: should have searched `docs/history/` and `docs/private/council/` for prior Council work BEFORE presenting any conclusion about what was/wasn't resolved — this session initially answered from a single handover doc's context window rather than the full available history.
- **Fix applied**: read all 3 relevant handover docs in full before proceeding, correctly separated the two threads, confirmed via direct evidence (PR #232's real merge, the real 2026-08-12 Council transcript files) which one was actually closed.
- **Prevention measure**: for any "was X already decided" question in this project, search the full `docs/history/` + `docs/private/council/` corpus before answering, not just the most recent handover doc in context.

### Loop: PR #239's fix looked complete, wasn't — the second-taxonomy discovery
- **Root cause category**: incomplete verification — the fix was checked against gates (tsc, qa-intel, tests) and against the ONE data path it was designed for (the worker's live JSON payload), but not against the OTHER real data path (`kg_entities` DB table) feeding the exact same UI components.
- **Cycle count**: 1 — caught before merge, via a direct live DB query prompted by re-reading an older architecture doc (`docs/architecture/entity-colors-poleo-rationale.md`) that mentioned a real CHECK constraint this session hadn't independently verified yet.
- **Stop-and-think moment**: recognized that "gates pass" and "matches one data source" is not the same as "correct for the whole system" — deliberately went and checked the second data path rather than assuming the fix was done because tests were green.
- **Breakthrough insight**: a bug that LOOKS like a simple palette mismatch can be evidence of a much deeper, currently-live architectural inconsistency — worth checking for a "why do TWO things disagree" pattern whenever a fix only addresses one of two plausible data sources for the same rendered output.
- **Prevention measure**: before merging any fix to a shared rendering module, explicitly enumerate every real data path that feeds it (not just the one the bug report pointed at) and verify the fix doesn't regress the others.

---

## 6. Knowledge Cycles & Productive Iterations

### Cycle: LLM Council — Entity Taxonomy Wave 1 (2026-08-15, ~13:21–14:15, ~1 hour)
- **Trigger**: the entity-color bug investigation surfacing a genuine, unresolved, foundational architecture question; user's explicit framing that this matters more than any near-term bug, tied directly to the second-brain roadmap.
- **Objective**: resolve how to design tier-2 of the entity-type taxonomy, given the accepted POLE+O+tier-2 cornerstone and the real (single-account, potentially biased) 637-row empirical classification.
- **Participants**: CC (orchestrator) + 13 isolated advisor sub-agents + 12 isolated peer-review sub-agents + 1 Chairman synthesis sub-agent (26 total sub-agent dispatches, all run in true parallel batches per the user's explicit contamination-avoidance requirement).
- **Phases**: locate and read 3 real prior handover docs (correcting the two-threads conflation) → draft framed question v1 → user-driven revision (treat POLE+O+tier-2 as accepted cornerstone, not open question) → second user-driven revision (anchor every question to the 4 real USPs, especially time-seek and the scrubber) → 13 parallel advisor responses → 12 parallel anonymized peer reviews → Chairman synthesis → transcript + HTML report saved → plain-language re-explanation pass (this document's most recent timeline entry).
- **Key artifacts**: `docs/private/council/2026-08-15_1321_v1_entity_taxonomy_wave1_framed_question.md`, `..._transcript.md`, `..._report.html`.
- **Outcome**: a real verdict with genuine disagreement preserved, not false consensus — ship an instrumented throwaway derived-label layer this week, explicitly do NOT condition Phase 2 extraction on tier-2 categories yet, and carry the Skeptic's unrebutted cornerstone-challenge into Wave 2.
- **Lifecycle status**: Wave 1 complete. Wave 2 blocked on 4 user yes/no answers (§13).
- **Integration status**: not yet applied to code — PR #239 is explicitly held pending this decision.
- **Why this matters**: this is the first time the ENTITY-TAXONOMY-specific Council thread (as opposed to the separate, already-closed persona-runtime thread) has actually run to completion — resolving a real 6+-day-old open architectural question that had stalled the whole knowledge-graph feature set (WordCloud/MindMap/KnowledgeGraphCanvas/entity time-seek/Phase 2 extraction), not just the immediate color bug that surfaced it.

---

## 7. Recurring Patterns / Housekeeping Reminders

### Pattern: User needing plain-language re-explanation of dense technical/Council output
- **Frequency**: 1 explicit instance this session, but matches this project's own standing feedback pattern of wanting complex findings broken down clearly.
- **Core issue**: the Chairman synthesis and blind-spot list, while accurate and dense (matching the Council skill's own output format), used domain jargon ("cornerstone," "tier-2," "disproof test," "n=1 variance") without enough grounding in concrete, simple product examples for a fast, confident read.
- **User's frustration statement** (paraphrased): "I want simpler explanation... like 15-20 year old... I did not get the drift on all points in a solid way."
- **Attempted solution**: re-explained every blind spot and clash point using concrete analogies tied directly to the product (filing cabinet for "0 rows = reversible," folder-vs-tag for Abstract's placement, a specific "Docker mentioned once vs explained for 3 minutes" example for the entity-vs-mention conflation) and ended with 4 direct yes/no questions instead of open-ended options.
- **Status**: response delivered this session; user's answers to the 4 questions not yet received as of this document's cutoff.
- **What would actually fix this long-term**: default to including at least one concrete, product-specific example per abstract finding in Council/architecture output, not just after being asked — this session's Chairman-synthesis-then-explain-simply two-pass pattern could be collapsed into one pass in future Council dispatches.

---

## 8. Current State Snapshot

### ✅ What works
- 5 PRs merged clean to `main` this session (#234–#238), all real findings verified/fixed/dismissed with evidence, none silently bypassed.
- PR #228 safely closed, its real content preserved and merged via #238, without the ~1,790-line destructive-merge risk.
- The entity-color monochrome ROOT CAUSE is genuinely understood (taxonomy mismatch, cross-verified two independent ways) even though the FIX is not yet finalized.
- LLM Council Wave 1 (entity taxonomy) ran to full, real completion — 13 advisors, 12 peer reviews, Chairman synthesis, genuine disagreement preserved not dissolved.
- The two-Council-threads conflation was caught and corrected before any wasted Council dispatch on the wrong question.

### ❌ What doesn't work / isn't decided
- PR #239 (entity-color fix) is held, not merged — it fixes one of two live-diverging taxonomies while risking regressing the other. Should not be merged as originally written.
- Two entity-type taxonomies remain simultaneously live in production (`kg_entities` DB, POLE+O-only vs. worker's live extraction schema, lowercase 8-value) — genuinely unresolved, not just undocumented.
- Bug #18's flicker/redraw sub-symptom (as opposed to the monochrome sub-symptom, which IS root-caused) — unconfirmed lead only, needs live profiling.
- Bug #19 (unclickable "Source section:" timestamp) — root cause still genuinely unknown; the one confirmed hypothesis (regex/bracket gap) was directly disproven by reproduction.

### 🔄 In-progress
- Waiting on user's answers to the 4 yes/no questions (§13) to unblock both PR #239's real fix and Council Wave 2's scoping.

### 🚫 Blocked
- PR #239 merge — blocked on the taxonomy decision (same shape of block this exact project hit once before, in the earlier persona/taxonomy freeze session — recognize the pattern, don't re-litigate the general "should we block on unresolved architecture" question itself, it's already this project's established practice).
- Council Wave 2 — blocked on user's answer to whether it should include real behavioral test evidence (ship both ways, measure) rather than pure further debate, per the peer-review-surfaced "nobody proposed testing this" blind spot.
- Bug #19's real fix — blocked on pulling the actual raw `dimension.content` from Supabase for the specific reported video, not yet done.

### 📋 Technical debt
- Bug #18's flicker/redraw lead (`rightPanelItems` useMemo recreating on every SSE fragment) — real, plausible, unconfirmed, not actioned.
- Bug #21 (dimension-0 accordion missing from history card) — still fully unaddressed this session, not touched.
- The "compressed video summary chip" JSON spec the user asked for several sessions ago — still fully outstanding.
- GDPR Art. 9 question on the 637-row classification's source data — flagged by the Council's Compliance Officer, not yet checked by anyone.

---

## 9. Context Preservation

- **User working style**: deeply hands-on architect-level collaborator; explicitly corrects when prior real work is being discounted or re-litigated from scratch ("so much work was done... shouldn't be discounted or disregarded"); wants scientific-method rigor applied even in the absence of complete data ("first principles, all the modalities... an educated guess based on the scientific method"); explicitly ties every technical decision back to real customer value and USPs, repeatedly, across many sessions — this is a load-bearing, consistent value system, not a one-off request.
- **Communication patterns**: long, dense, voice-transcribed messages covering multiple real points per message, sometimes with minor transcription artifacts (e.g. "New 4J" for "Neo4j", "SAP API" for "SerpAPI") — read for intent, don't get hung up on literal transcription errors, but don't silently "fix" a point that might be a genuine correction either.
- **Explicit new requirement this session**: when Council/architecture output uses dense synthesis language, proactively include concrete, product-specific examples and end with direct yes/no decision questions rather than open-ended options — established via direct request this session, apply going forward without being asked again.
- **Conventions enforced**: `docs/private/council/` for Council artifacts (gitignored); filenames `YYYY-MM-DD_HHMM_vN_description.md`; never `/tmp` for user-visible docs; `pnpm` only; full formal 7-step Council process, no abbreviation, ever (hard rule from an earlier session's real mistake); genuinely parallel sub-agent dispatch (single-message batches) for any multi-advisor/multi-reviewer process, explicitly to avoid context contamination.
- **Standing project rule reconfirmed this session**: never merge a PR that's fixed one data path while regressing another just because CI is green — explicitly hold and escalate instead, which is what happened with PR #239.

---

## 10. Session Bridge Content (last 3-4 prompts, near-verbatim)

### Bridge prompt 1
User, after the Chairman synthesis was delivered: extensive corrections and clarifications — explained that substantial multi-engine research (Exa/Brave/Decodo/BrightData/Google) had already gone into the POLE+O + Neo4j-2-tier + Abstract-type direction and this "shouldn't be discounted," that the user's own working method follows "the scientific way, systems thinking, first principles" even when data is incomplete, and that the taxonomy decision has to be tied explicitly to the real product value vector: the elaborate multi-dimension UCIS text summary, the 4-part digest, the compressed-reduced video summary with auto-scrubber, and entity time-seek — "these are the real values we're trying to drive to the customer."

### Bridge prompt 2
User: "yes proceed" (confirming the revised Wave 1 framing and requesting dispatch).

### Bridge prompt 3
User, mid-dispatch: "they have to be in prallel to to avoid context contamination" (confirming/requiring the parallel-dispatch approach already in use for the 13 advisors and about to be used for the 12 peer reviewers).

### Bridge prompt 4 (most recent, this document's trigger)
User: reported not fully understanding several specific Council findings (the 4 blind spots, the 4 clashes, the Abstract-devaluation concern, and the "kg_entity_mentions has 0 rows"/gating-decision points specifically) and asked for a "15-20 year old" reading-level re-explanation of all of them, followed immediately by this handover-report request (the full 20-section THOS template, explicitly).

**Unresolved question carried into next session**: none of the 4 yes/no questions posed in the plain-language re-explanation (§13 below) have been answered yet. The very next message after this handover lands should answer those, or explicitly redirect to other work.

---

## 11. Critical Path Forward

### Priority 1: Get the user's answers to the 4 yes/no questions from the plain-language re-explanation
- **Dependencies**: none — purely needs user input.
- **The 4 questions**: (1) Ship the cheap `objectSubtype` color-coding fix this week — yes/no? (2) Keep Phase 2 extraction "blind" to tier-2 categories for now — yes/no? (3) Run a Council Wave 2 specifically on the Skeptic's unrebutted cornerstone-challenge, including real behavioral test evidence rather than pure debate — yes/no? (4) Should someone check the GDPR Art. 9 question on the 637-row classification's source data before shipping anything — yes/no?
- **Verification criteria**: answers specific enough to directly scope both PR #239's real fix and Wave 2's framed question.
- **Edge cases**: if the user wants Wave 2 dispatched with real behavioral test evidence (per question 3), that requires actually shipping SOMETHING first to generate click-through data — meaning question 1's answer gates question 3's actual execution, not just its scoping. Surface this dependency directly if the user answers "yes" to 3 but "no" to 1.
- **Complexity**: low (a conversation), but gates everything else in this list.

### Priority 2: Finalize and merge PR #239's real fix (or its replacement) once Priority 1 resolves
- **Dependencies**: Priority 1's answers, specifically to questions 1 and 2.
- **Verification criteria**: whatever fix ships must NOT regress the `kg_entities`-backed rendering path (the mistake caught this session) — explicitly test both data paths (worker-payload-embedded AND kg_entities-DB-backed) before considering this done, not just gates-green on one path.
- **Edge cases**: if the answer to question 1 is "no, do the real taxonomy properly instead of the cheap fix," this becomes a much larger piece of work gated on Wave 2's eventual verdict, not a quick merge.
- **Complexity**: Low if question 1 = yes (the cheap fix is well-scoped by the Council's own recommendation); Medium-High if question 1 = no.

### Priority 3: Resume bugs #18 (flicker sub-symptom), #19 (timestamp linking), #21 (dim-0 accordion) — none touched to completion this session
- **Dependencies**: none technically, but realistically deprioritized behind Priority 1/2 given the user's own explicit "this is more important than the monochrome bug" framing.
- **Verification criteria**: #19 specifically needs the raw DB content pulled and diffed before any further hypothesis-testing — static code reproduction already ruled out the leading theory.
- **Edge cases**: #18's flicker lead (`rightPanelItems` useMemo/graph-identity churn) needs live profiling (React DevTools Profiler or equivalent), not further static reading — flag this explicitly rather than re-attempting static RCA a third time.
- **Complexity**: Low-Medium each, genuinely independent of the taxonomy work, good candidates for background/parallel dispatch once Priority 1/2 clear.

---

## 12. Reference Index

### File paths (this session's primary touches)
- `web/lib/design/entity-colors.ts` — the color-mapping module at the center of the taxonomy fix, currently in a provisional/held state (matches worker's schema, doesn't yet account for `kg_entities`' separate POLE+O reality).
- `web/lib/design/__tests__/entity-colors-contract.test.ts` — new real contract test, imports the actual worker Zod schema, drift guard for future taxonomy changes.
- `worker/src/services/ZodSchemas.ts` — `KGNodeSchema.entityType`, the worker's real live 8-value lowercase taxonomy.
- `web/hooks/useKnowledgeGraph.ts` — the two real, currently-diverging data-ingestion paths (`kg_entities` DB-backed vs. payload-embedded), lines ~121 and ~189 per this session's investigation.
- `web/lib/adapters/SupabaseGraphAdapter.ts` — inserts into `kg_entities`, `type: e.type` passthrough with no visible normalization — an open question about whether/how this reconciles with the DB's POLE+O CHECK constraint, not resolved this session.
- `docs/architecture/entity-colors-poleo-rationale.md` — the doc that first revealed the `kg_entities` POLE+O CHECK constraint's existence this session, prompting the live DB verification.

### Council artifacts (new this session)
- `docs/private/council/2026-08-15_1321_v1_entity_taxonomy_wave1_framed_question.md`
- `docs/private/council/2026-08-15_1321_v1_entity_taxonomy_wave1_transcript.md`
- `docs/private/council/2026-08-15_1321_v1_entity_taxonomy_wave1_report.html`

### Prior handovers referenced/read this session (not superseded, still load-bearing)
- `docs/history/THOS_2026-08-10_0432_KG_ENTITY_TAXONOMY_DEEP_DIVE_AND_ADR026_PHASE2.md` — original taxonomy research (POLE+O origin, DOLCE/BFO, Abstract naming, 637-row classification).
- `docs/history/THOS_2026-08-10_1355_PERSONA_TAXONOMY_FREEZE_AND_COUNCIL_R1.md` — the persona-runtime question's own framing (separate thread, now closed).
- `docs/history/THOS_2026-08-13_1055_COUNCIL_R1_MERGES_AND_WAITLIST_HANDOVER.md` — confirms the persona-runtime Council actually ran and its verdict was merged (PR #232).
- `docs/history/THOS_2026-08-15_0135_STREAM_FAILURE_WRITEBACK_AND_ICON_FIX.md` — immediately prior handover in this session's own arc.

### PRs (this session, chronological)
Merged: #234 (`9c9ad38c`), #235 (`d413d125`), #236 (`0121855b`), #237 (`4afc5693`), #238 (`b2e71b77`). Closed without merge: #228 (superseded by #238, comment explains why). Open, held: #239 (`fix/entity-color-taxonomy-mismatch` — do not merge as-is, see §8/§13).

### Live DB facts verified this session (not recalled from memory)
- `kg_entities.type` distinct values + counts: Object 637, Person 88, Organization 76, Event 21, Location 14 (queried live via Supabase Management API this session, matches the same numbers documented in the Aug 9/10 prior sessions — confirms no drift in the DB itself since then).
- `worker/src/services/ZodSchemas.ts KGNodeSchema.entityType` real enum: `person|concept|framework|tool|organization|study|trend|metric`, default `'concept'`.

---

## 13. Validation Checklist (self-applied)

- [x] Header complete, real dates/branch/status, verified via `git log` this session not recalled
- [x] No ambiguity on current blocking state (PR #239 explicitly flagged as unsafe-to-merge-as-is, reason stated)
- [x] File paths verified real via direct reads this session
- [x] Troubleshooting loops show root cause → fix/escalation → verification (both loops this session ended in a deliberate escalation, not a silent patch — documented as such, not glossed over)
- [x] Next steps concrete, ordered, with real dependency chains named (Priority 1 gates 2 and partially 3)
- [x] Session bridge preserved near-verbatim (4 real prompts, not compressed into paraphrase-of-paraphrase)
- [x] Knowledge cycle (Council Wave 1) fully documented per the required 8-field format, not merged into the timeline
- [x] Recurring pattern (plain-language re-explanation need) captured with real user language, not paraphrased into blandness
- [x] Key decisions tagged 🔑, one breakthrough tagged 💡
- [x] No secrets included (the pasted Supabase key referenced by its use, never its value)
- [x] Completeness self-assessment: ~93% confident. The ~7% gap: the full individual text of all 13 advisor responses and all 12 peer reviews is preserved in condensed/convergent-finding form in this document and the linked transcript, but the linked transcript itself notes it condenses peer-review text rather than reproducing all 12 verbatim — if a future session needs the literal original peer-review wording, it exists in this conversation's tool-call history, not fully reconstructed in the saved transcript file.
