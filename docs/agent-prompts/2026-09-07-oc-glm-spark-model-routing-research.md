# Agent Dispatch Prompt — GLM 5.3 / Spark Muse model-routing pricing research (fresh, not from memory)

**Target Agent**: OC (OpenCode, glm-5.3-flash)
**Effort Level**: low

This task does NOT touch the hex-yt-intel git repository — it is a pure
research task producing a markdown report. No PR, no gates.

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> Read `.memory/AGENT_LEDGER.md` (in `/home/kellyb_dev/projects/hex-yt-intel`)
> before starting, in case a sibling session is doing related research. Post
> `[IN_PROGRESS]` with intent as your first action; post `[DONE]`/`[BLOCKED]`
> with a real summary as your last action.

---

## 1. Context & Problem Statement

The user (Kelly, project owner of hex-yt-intel) wants a fresh comparison of
GLM 5.x (Zhipu/Z.ai) and "Spark Muse" (MiniMax, referred to in prior session
notes as "Muse Spark") pricing and capability tiers, for use in this
project's own agent model-routing decisions (which model tier to route which
kind of dispatched task to — see this repo's own CLAUDE.md "Model/task-fit
routing" table for the shape of the decision this feeds). A prior session
explicitly required this be re-researched FRESH via real lookups — do NOT
answer from training-data memory or reuse previously-pasted OpenRouter
pricing figures without re-verifying them against a live source, since
pricing/model lineups change monthly and stale numbers would misroute real
spend.

## 2. Contract & Implementation Directives

**Contract**: produce a markdown report at
`/home/kellyb_dev/projects/hex-yt-intel/docs/research/2026-09-model-routing-glm-spark-pricing.md`
containing a comparison table and a routing recommendation, with every
pricing/capability claim traceable to a real fetched source (URL + fetch
timestamp), not asserted from memory.

**Implementation approach**:
1. For GLM (Zhipu/Z.ai): fetch the current official pricing page(s) directly
   (e.g. `https://open.bigmodel.cn` / `https://docs.z.ai` / Zhipu's own
   developer pricing docs — find the real current URL, don't guess an old
   one) AND cross-check against OpenRouter's own live model listing for GLM
   variants (`https://openrouter.ai/models?q=glm` or
   `https://openrouter.ai/z-ai` — again, find the real current path). Record,
   for at least GLM 5, GLM 5.3, GLM 5.3-flash, GLM 5-turbo: input/output
   token price per million, context window, and any documented
   reasoning-effort/thinking-mode variants.
2. For "Spark Muse"/MiniMax: identify the real current product name and
   pricing page (the "Muse Spark"/"Spark Muse" naming in prior session notes
   may itself be stale or a nickname — verify the actual current MiniMax
   model family name and don't assume the old name is still accurate).
   Fetch its real current pricing the same way.
3. Use at least 2 independent sources per model family (e.g. the vendor's
   own page AND OpenRouter's listing, or the vendor's page AND a recent
   independent pricing-comparison article) — do not rely on a single page,
   per this project's own standing multi-source-verification practice.
4. If you have access to multiple distinct search/fetch tools, use more than
   one rather than a single tool for cross-checking, per that same practice.
5. Build a comparison table: model | provider | input $/M tokens | output
   $/M tokens | context window | notable capability differences | source URL
   + fetch date for each row.
6. End with a short, concrete recommendation for where each of these model
   tiers would fit into this repo's existing "Model/task-fit routing" table
   (CLAUDE.md) — e.g. "GLM 5.3-flash: fits the existing 'well-scoped, narrow
   investigation+fix' row; GLM 5.3 (non-flash): candidate for the 'multi-hop
   or long-horizon reasoning' row if X capability holds" — but flag clearly
   that this is a recommendation for the user to confirm, not a change you
   are making to CLAUDE.md yourself.
7. Do NOT edit CLAUDE.md or any other project file besides the new research
   doc. This is a research deliverable only.

## 3. Pre-PR Review Skills Decision Tree

Not applicable — docs-only research output, no code/PR.

## 4a. Verification & Quality Gates (local)

None applicable (no code). Self-check: every numeric claim in the final
report must have a citation (URL + date) next to it — if you cannot find a
real current source for a number, write "unverified, could not find a
current source" rather than inventing or reusing a remembered figure.

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA (what was stale/unknown) → Contract (what the report must contain) → the report itself (or its file path) → sources used → any numbers you could NOT verify → recommendation for CC to review before acting on it.

Save the report to `docs/research/2026-09-model-routing-glm-spark-pricing.md`
(create the `docs/research/` directory if it doesn't exist) and report its
path back. No commit/push needed — CC will review and decide whether to
commit it.
