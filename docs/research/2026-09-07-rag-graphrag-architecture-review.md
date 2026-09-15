# RAG / GraphRAG Architecture Review — 2026-09-07

Source: 4 Medium articles surfaced in user's digest email, fetched via Exa
`web_search_exa` (WebFetch and Exa `web_fetch_exa` were both denied by session
permission mode — don't-ask/auto-deny; search-mode Exa returned full highlight
text instead, sufficient for this review). Cross-referenced against
hex-yt-intel's actual knowledge-graph and RAG surfaces: `useKnowledgeGraph.ts`
client TF-IDF fallback (ADR 023), `kg_entities`/`kg_relations` tables, and the
`code-review-graph` MCP tool mandated in CLAUDE.md §"MCP Tools: code-review-graph".

## 1. "Cutting GraphRAG Token Costs by 90% in Production" — Alexander Shereshevsky (Graph Praxis)
URL: https://medium.com/graph-praxis/cutting-graphrag-token-costs-by-90-in-production-5885b3ffaef0

**Core numbers:**
| Metric | Standard GraphRAG | Optimized | Reduction |
|---|---|---|---|
| Indexing tokens (per 1K docs) | ~2.5M | ~230K | 90.7% |
| Avg query tokens (simple) | ~2,800 | ~450 | 84% |
| Avg query tokens (complex) | ~12,000 | ~2,400 | 80% |
| Monthly API cost (est.) | $14,200 | $1,680 | 88% |
| Multi-hop accuracy (HotpotQA) | 74.9% | 81.2% | +8.4% |
| Multi-hop accuracy (2Wiki) | 48.3% | 77.6% | +60.7% |

**Four techniques, in order of leverage:**
1. **Schema-guided extraction** (highest leverage): constrain the LLM's entity/relation extraction to a bounded schema instead of open-ended "find all entities/relationships." Open-ended extraction on a paragraph returns 15–30 noisy triplets (dates, generic concepts); schema-guided returns 3–8 high-quality ones — a 70–80% token reduction *and* a cleaner graph. This is the single biggest lever (drove the reported 90%+ indexing-cost cut).
2. **Dual-perception community detection**: standard Leiden algorithm is purely topological and has "exponentially many near-optimal partitions" on knowledge graphs — noisy communities → unfocused summaries → query-time map-reduce has to scan more of them → more tokens. Better community assignment = fewer, more relevant summaries pulled at query time.
3. **Four-level knowledge tree** (L1 fact lookup → L2 relational → L3/L4 thematic): route queries to the cheapest level that can answer them. ~40% of their production queries resolve at L1/L2 without ever touching expensive community summaries — nearly halves average query-time tokens.
4. **Agentic query decomposition with reflection + hard token budgets**: complex multi-hop queries get decomposed into 3–5 focused sub-queries (200–500 tokens each) instead of stuffing an 8–16K token context window. Reflection loop must justify requesting more budget rather than speculatively over-retrieving.

**Applicability to hex-yt-intel:** ADR 023 already found `kg_relations` empty across the *entire* database and some complete analyses have zero knowledge-graph data anywhere. That symptom — sparse/absent graph output — is exactly what open-ended, unconstrained extraction produces per this article (noisy, inconsistent triplet yield). If/when the KG generation step in the LLM cascade is revisited, schema-guided extraction (bounded entity/relation types, not "find all entities") is the highest-leverage single change and would likely also fix some of the sparsity ADR 023 flagged as a "root cause not yet confirmed" — worth adding as a candidate root cause, not just an effect-timing bug.

## 2. "Production-Grade OKF + Graphify Setup, Not Just a Demo" — Udaykiran Estari (Data Science Collective)
URL: https://medium.com/data-science-collective/production-grade-okf-graphify-setup-not-just-a-demo-aecf54c08153

Not RAG for product data — this is about **code knowledge graphs for AI coding agents** (Graphify: tree-sitter AST parser building `graph.json`/`graph.html`/`GRAPH_REPORT.md`, MCP-server-exposed; OKF: Google Cloud's markdown+YAML-frontmatter knowledge-bundle spec, June 2026 v0.1). Directly relevant to our own tooling, since CLAUDE.md mandates the `code-review-graph` MCP tool as the **first** resort for exploring this codebase, with the claim "The graph auto-updates on file changes (via hooks)."

**Core finding — the failure mode is silent staleness, not wrongness:** a real reported case had a code-graph summary file 2 weeks stale on `origin/main` while every update hook reported success and nothing crashed — an agent reasoning over it gave "confidently wrong answers." Root causes cited: hardcoded file-extension allowlists in update hooks silently skip files outside the list; MCP servers cache the graph at process startup with no hot-reload (a fresh `graph.json` on disk ≠ fresh graph in the agent's working memory until the MCP process restarts); multiple output artifacts (`graph.json`, `graph.html`, report) can desync from each other with no built-in cross-check.

**What a production-grade setup requires (their checklist):**
- Treat graph freshness as an *observable* property — log rebuild success/failure with a timestamp, don't trust hook exit codes alone.
- Cross-check all graph artifacts' timestamps against `git log -1` — a one-line CI check catches multi-week staleness before an agent trusts it.
- Explicitly restart/hot-reload the MCP server after regeneration — never assume it live-picks-up a new graph file.
- Below ~500 files, the whole pipeline is "ceremony, not engineering" — measure before adopting.
- Companion piece (same author, "The Graph That Lied for Three Weeks") frames incremental graph updates as a cache-coherence problem: content-hash + explicit dependency refs in frontmatter, reverse-dependency invalidation, fail-closed tombstoning (only evict a node if its file is confirmed gone, not merely unresolved), and a forced full rebuild every 3–5 incremental updates or on a weekly cron — their tooling's own docs implicitly admit incremental update is a short-TTL cache, not a source of truth.

**Applicability to hex-yt-intel — action item, not just FYI:** we have never verified that our `code-review-graph` MCP's "auto-updates on file changes via hooks" claim actually holds under the failure modes this article documents (stale artifact silently served, hook silently no-op on certain file types, cached graph outliving a regeneration). Given CLAUDE.md instructs every agent to trust this graph *before* Grep/Glob/Read, an undetected staleness incident here would be worse than in a tool we already know to double-check. Recommend: (a) confirm what freshness signal (if any) the graph tool exposes today, (b) if none, add a cheap check — e.g. compare graph's last-build timestamp to `git log -1` — before merges, consistent with our existing "graph rebuild, don't report staleness" feedback memory (`feedback_graph_rebuild_and_full_select_list.md`), which already assumes rebuilding is enough; this article argues rebuilding without a freshness *check* is not sufficient on its own.

## 3. "How to Automate Online Fact-Checking with LLMs and AI Agents" (and the related Bright Data SERP-API build)
Digest URL (Part 1, thin): https://tinkerd.medium.com/how-to-automate-online-fact-checking-with-llms-and-ai-agents-e8465c039ba2 — Part 1 is a short series intro with no architecture detail yet. The substantive pattern is in the companion piece it's evidently drawing on (Prithwish Nath, Bright Data SERP API): a **3-stage Perceive → Reason → Act pipeline**:

1. **Perceive**: `shouldDecompose()` — an LLM call decides whether a claim needs splitting into sub-claims; each (sub-)claim gets a targeted search via Bright Data's SERP API (`brd_json=1` for structured results, proxy-rotated to avoid CAPTCHAs/geo-blocks); results are stripped to organic titles/descriptions/links/knowledge-graph facts/People-Also-Ask, discarding fluff.
2. **Reason**: a separate LLM call is given *only* the claim + cleaned evidence (explicitly sandboxed — "no outside knowledge, no hallucinating") and returns a structured verdict (True/False/Partially-True) with a 0–100 confidence score and justification, enforced via `generateObject()` + Zod schema.
3. **Act**: typed output (`actions_taken`, `status`, `timestamp`) so the verdict can be chained into downstream automation without rewriting the pipeline.

Google's earlier ADK version of the same idea uses a 3-agent `SequentialAgent` (Claim Extraction → Evidence Search via Google Search tool → Fact-Check judge) with the same sandboxing discipline: the judge only sees the evidence summary, never falls back to model priors.

**Applicability to hex-yt-intel:** this is architecturally the closest external pattern to our own **ADR 008 Chat Grounding Security Gate** (refuse rather than answer from general knowledge when there's no usable analysis) — same "sandbox the model to only the retrieved evidence, structured verdict, explicit confidence" discipline. If a future citation-verification or claim-checking feature on chat answers is ever considered, this Perceive→Reason→Act shape with Decodo (our existing paywall-capable search, per `reference_decodo_search_via_curl.md`) standing in for Bright Data's SERP API is a directly reusable pattern — not something to build from scratch.

## 4. "Forget JSON — These 4 Data Formats Made My APIs 5x Faster"
Actual article at the pasted URL: https://medium.com/@maahisoft20/... = "Text vs Binary: How Dropping JSON Squeezed 5x More Throughput From Our APIs" (The Thread Whisperer). Four formats compared: **Protobuf, MessagePack, Avro, FlatBuffers** (a closely related sibling article by a different author benchmarks Protobuf/FlatBuffers/MessagePack/CBOR — numbers below are from the actual pasted-URL article).

| Format | Size (5K records, 8 fields) | Serialize | Deserialize |
|---|---|---|---|
| JSON | 1.8 MB | 142 ms | 98 ms |
| MessagePack | 1.1 MB | 61 ms | 44 ms |
| Protobuf | 680 KB | 38 ms | 29 ms |
| Avro | 590 KB | 35 ms | 31 ms |
| FlatBuffers | 720 KB | 28 ms | ~2 ms (zero-copy, no deserialize step) |

Guidance: JSON stays at public/human-facing edges (debuggability); binary formats go on internal machine-to-machine hot paths. Protobuf for typed internal RPC/gRPC, MessagePack for a near-zero-migration compact win on existing JSON shapes (WebSocket/Redis), Avro where schema evolves alongside a stream (their Kafka consumer-lag example: 40s → 4s under peak load after switching from JSON), FlatBuffers for genuinely latency-critical zero-copy reads.

**Applicability to hex-yt-intel:** low priority, no current evidence of a serialization bottleneck in our stack. We're SSE/JSON over Cloudflare Worker ↔ Vercel ↔ browser (Law #2/#3 in CLAUDE.md — streaming architecture), and Law #2's own history shows our real latency incidents have been LLM-generation-time and timeout-config issues, not payload-format CPU cost. Not actionable now; worth a second look only if profiling ever shows JSON parse/stringify as a measurable hot-path cost (e.g. very large `analysis_payload` blobs — see ADR 017's Zod-bundle-size issue, which is a different but adjacent cost: client bundle size, not wire serialization speed).

## 5. Cross-check against our own existing ADRs (this is what the user actually asked for)

We already have two live architecture decisions squarely in this space. Both hold up well against the new material — with one confirmed-safe design detail and one concrete unimplemented lever surfaced.

### 5.1 ADR 026 — Grounded Entity Extraction (chunk-first, schema-constrained) — Status: 🔍 Proposed, Phase 1 landed
`docs/private/ADR_026_GROUNDED_ENTITY_EXTRACTION_2026-08-09.md`. Decision: chunk transcript into ~60-90s windows aligned to caption-segment boundaries, extract entities per-chunk (never batch chunks into one call) via exact-substring + embedding match, pipeline-assigned (not LLM-self-reported) timestamp grounding. Modeled directly on Neo4j's confirmed chunk→extract→prune→resolve pipeline.

**New evidence found this pass, all corroborating:**
- **AEVS (MDPI, 2026-03-09)** — anchor-constrained extraction with provenance tracking is now peer-reviewed and benchmarked (up to +0.412 F1 over unconstrained baselines on REBEL). Its core mechanism — ground every triplet element to source-text anchors *before* generation, verify by reconstruction, skip LLM-verification entirely when all three elements restore cleanly — is a stronger, published version of exactly what ADR 026 §4.3 already proposes doing ourselves (a post-hoc check "beyond Neo4j's own confirmed baseline"). We're not behind the research; we're independently on the same track one step ahead of Neo4j's own shipped baseline.
- **LREC 2026 schema-constrained evaluation workshop** confirms the *actual bottleneck* is relation/triple-level accuracy, not entity detection (entity F1 74-84% across models, triple F1 collapses to 4-40%) — "missed and hallucinated triples substantially outnumber entity-level errors." Directly actionable for ADR 026 Phase 2: budget more scrutiny/verification on the relation-extraction half of the pipeline than the entity half, since that's confirmed to be where the errors concentrate industry-wide, not just in our own prior ungrounded implementation.
- **TRACE-KG (arXiv 2604.03496)** offers a third path we hadn't scoped: schema *induced* from the corpus rather than fixed upfront (avoids both free-form's fragmentation and fixed-ontology's maintenance cost) — outperforms plain GraphRAG and AutoSchemaKG on retention accuracy vs. leakage tradeoff. Not a reason to change ADR 026's decision (our schema is small/product-specific enough that induction overhead isn't worth it), but worth knowing this middle path exists if the entity taxonomy (ADR 027 mentions Tier2 palette/taxonomy work) ever needs to scale beyond a hand-maintained ontology.
- **Shereshevsky's "schema-guided extraction" number (90%+ token reduction, 70-80% fewer noisy triplets)** is the most directly actionable new data point: ADR 026 Phase 2 (per-chunk extraction pipeline stage) is not yet built. When it is, this confirms schema-guided (bounded entity/relation types) over free-form extraction is not just "more correct" but also the single highest-leverage cost lever available — worth citing in the Phase 2 implementation PR as the token-budget justification.

**No change recommended to ADR 026's decision** — new evidence confirms the chosen direction and adds one Phase-2 implementation detail (weight verification effort toward relations, not entities) plus one long-term option (schema induction) worth a footnote, not a redesign.

### 5.2 ADR 028 — Temporal Knowledge Graph via SQLGraph (Postgres recursive CTE) — Status: ✅ Decided, Phase 1 blocked on sign-off
`docs/private/ADR_028_TEMPORAL_KG_SQLGRAPH_SIMHASH_SSOT_HIGHLIGHTS_2026-08-25.md`. Decision: model highlights/chat-grounding as a graph traversal (Theme→Claim→TemporalNode) using a recursive CTE over `kg_entities`/`kg_entity_temporal_edges` in existing Supabase Postgres, explicitly rejecting Apache AGE (unavailable on managed Supabase) and Neo4j (260-580× more expensive per GB, unjustified at current scale). Hard caps: maxDepth=6, maxNodes=24, cycle guard via `visited` array, `LIMIT` on final result.

**New evidence found this pass — this is the strongest possible validation of a specific technical design choice:**
- **Three independent 2026 benchmarks** (Markaicode Neo4j-vs-Postgres, Pedro Alonso's GraphRAG-vs-vector-Postgres, Jaesol Shin's 8-engine GraphDB benchmark) all converge on the same finding: **recursive CTE wins decisively for bounded, shallow (1-3 hop) neighborhood-expansion/reachability traversal — the exact shape ADR 028 uses** (Theme→Claim→TemporalNode is a fixed 2-3 hop path, depth-capped at 6, not unbounded pathfinding). Alonso's numbers: 1-hop 0.4ms, 2-hop 0.5ms, 3-hop 43.7ms on Postgres vs. 2.9/2.3/171.5ms on Neo4j — Postgres ~4x faster on exactly this query shape. Jaesol Shin's benchmark explicitly recommends "RCTE flat tables" as first choice for "LightRAG/GraphRAG retrieval (1-2 hop)" workloads, which is precisely ADR 028's use case.
- **Critical caveat, independently confirmed by the same three sources, and already correctly handled by ADR 028**: RCTE catastrophically degrades on *unbounded/variable-length* traversal or shortest-path queries (Neo4j wins there by 80-135x) because PostgreSQL's recursive CTE has no automatic visited-set tracking and no LIMIT push-down — without an explicit cycle guard, cardinality explodes before the final LIMIT is even applied. **ADR 028's SQL (§4.4) already implements the exact mitigation this research confirms is necessary**: an explicit `visited` array cycle guard (`target.id != ALL(gw.visited)`), a hard `depth < $3` cap, and a final `LIMIT $5` — this is not incidental, it is precisely the pattern the benchmarks say separates safe RCTE usage from the "recursive CTE blew up in production" failure mode. No change needed; this is confirmation that Phase 1's SQL design is already correct, not a gap to fix.
- **PostgreSQL 19's upcoming SQL/PGQ** (beta mid-2026) is worth a forward-looking footnote only: it's a syntax rewriter over the same relational-join execution model (no variable-length-path support yet), so it would not currently supersede ADR 028's raw recursive CTE approach, and migrating to it isn't a real option until Postgres 19 is what Supabase runs and variable-length patterns land — not actionable now, worth revisiting when Supabase's Postgres version catches up.
- **Reinforces ADR 028 §3.2's own reasoning almost verbatim**: Alonso's explicit conclusion — "for plain neighborhood expansion to feed RAG, the recursive CTE in the database you already run is hard to beat," reserve a dedicated graph engine for "pathfinding, link analysis, or graph algorithms" — is the same conclusion ADR 028 already reached independently via TechRAG's ROE reimplementation. Two independent lines of evidence (our own prior research, and this new external benchmark data) now agree.

**No change recommended to ADR 028's decision.** If anything, cite Alonso's and Jaesol Shin's 2026 benchmark numbers directly in the ADR's §3.2 "Why Not Apache AGE or Neo4j" table as additional independent confirmation beyond TechRAG alone — strengthens the record for anyone revisiting this decision later, especially before any Phase 5 (Atlas cross-video, potentially deeper/wider traversal) reconsideration of Neo4j.

## 6. Bottom line for the concurrent session

Both of hex-yt-intel's live GraphRAG/KG architecture decisions (ADR 026, ADR 028) are **independently validated, not contradicted**, by everything surfaced in this research pass — including peer-reviewed 2026 papers and three separate production benchmarks published after both ADRs were written. Nothing here should trigger a re-litigation of either decision. The concrete, actionable items are:

1. When ADR 026 Phase 2 (per-chunk extraction) is implemented, cite the 90%+ token-reduction number and the "relations are the real bottleneck, not entities" finding to shape where verification effort goes.
2. When ADR 028 Phase 1 ships, add the two new 2026 benchmark citations to §3.2 as further evidence beyond TechRAG.
3. Separately (not an ADR item): our own `code-review-graph` MCP tool — which CLAUDE.md instructs every agent to trust before Grep/Glob/Read — has an unverified freshness-guarantee claim ("auto-updates on file changes via hooks"). The Graphify/OKF article's core finding (silent staleness with hooks reporting success) is a real risk class worth a cheap check (compare graph rebuild timestamp to `git log -1`) even though it's not the same tool.

## Session note on tooling
This session's permission mode (`don't ask`) auto-denied `WebFetch` and Exa's `web_fetch_exa` (direct-URL fetch) outright — not a website-side block, a local tool-permission denial. `web_search_exa` (search-mode, same MCP) was *not* blocked and returned full article content via its highlights field, so it was used as the fallback for all 4 URLs. Per the user's explicit correction mid-session: WebFetch must never be tried first going forward — reach for Decodo/Exa/Bright Data/SerpAPI first, consistent with `feedback_multi_engine_research_mandatory.md`.
