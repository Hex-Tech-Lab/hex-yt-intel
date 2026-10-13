# Agent Dispatch Prompt — combiner dedupe follow-up (post-merge audit of #501)
> NO GREP, EVER. Never use grep/rg/git grep/Grep tool. Use code-review-graph (build-graph, semantic_search_nodes_tool, query_graph_tool). Sub-agents: graph only, no grep. If the graph lacks a node, report the empty query.
Worktree: /home/kellyb_dev/projects/hex-yt-intel-wt-combiner-fix2 (branch fix/combiner-dedupe-followup from origin/uat). Ledger: append [IN_PROGRESS] to .memory/AGENT_LEDGER.md first, [DONE] last (with agent tag AGY).
Context: post-merge audit found defects in web/lib/services/combiner-dedupe.ts and CombinerPass.ts. Read /home/kellyb_dev/projects/hex-yt-intel-wt-uat-audit/evidence/post-merge-uat/silent-failure-hunter.md, pr-test-analyzer.md, code-review.md first.
Tasks (numbered, literal; write a failing test FIRST for each, keep it failing without the fix = negative control):
1. combiner-dedupe.ts:44, :157-163, :266-270 — a repeated claim at two different REAL timestamps must keep BOTH mentions (ADR 022 per-mention seek). Only a placeholder timestamp may be replaced by a real one.
2. combiner-dedupe.ts:47 — keep the minus sign for "(-5%)" and the unicode minus "−5%"; they must not merge with "5%".
3. matchSubHeader — own-dimension lines like "3.2x growth..." or "1.5-fold ..." are NOT headers (require a title word after the number, not a unit/suffix). Add tests.
4. CombinerPass.ts:234 — identical-key intros differing only by symbols/timestamps must not drop the second.
5. combiner-dedupe.ts:252 — timestamp_upgrade must not overwrite a longer superset block.
6. Hedges ("(approximate)") must stay part of comparison text.
Out of scope: migrations, anything else. Surgical diff only.
Gates (run for real, save output to evidence/): cd web && NODE_OPTIONS=--max-old-space-size=6144 pnpm --config.verify-deps-before-run=false exec tsc --noEmit; vitest run lib/services; pnpm --config.verify-deps-before-run=false qa-intel:ci; skills: simplify, review-delta, runtime-check, verification-before-completion. Commit with trailer lines Co-Authored-By: Gemini AGY and push branch. Do NOT open a PR and do NOT merge; CC reviews next. Report: files changed, tests added, gate outputs, any grep use.
