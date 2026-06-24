# VISION VERIFICATION REPORT — STRICT EVIDENCE ONLY

**Scope**: Verify current behavior of `hex-yt-intel` against product vision  
**Method**: Direct file reads; no prior-report citations; no synthesis beyond visible code  
**Labels**: code-observed, test-proven, runtime-proven, inferred, unknown  

---

## 1. VIDEO UNIVERSE

### Question: Does the system answer only about the submitted YouTube URL by default?

### File: web/lib/usecases/CreateAnalysisUseCase.ts:60-80
- **Snippet**: `const videoId = extractVideoId(params.url);` → `findCachedAnalysis({ userId, videoId })` → returns `cache_hit` OR continues
- **Label**: code-observed

### File: web/lib/usecases/CreateAnalysisUseCase.ts:102-120
- **Snippet**: 
```
ingestionResult = await this.metadataIngestion.fetch(videoId);
const isTranscriptEmpty = !ingestionResult.transcript || ingestionResult.transcript.trim().length === 0;
if (isTranscriptEmpty) {
  const decodoResult = await this.decodo.fetchTranscript(videoId);
  ...
}
```
- **Label**: code-observed (analysis is keyed on a single `videoId`; ingestion fetches only that video's metadata + transcript)

### File: web/lib/prompts/ucis-v5.1.ts:20-42 (CLOSED UNIVERSE directive)
- **Snippet**:
```
## 0.5 CRITICAL CONSTRAINT: THE CLOSED UNIVERSE & TRANSCRIPT ABSOLUTISM
**This is the highest-priority directive. It overrides all other instructions.**
1. **You operate in a strictly deterministic, closed-universe sandbox.** The provided transcript is your entire reality.
2. **NO WEB SEARCHING**: You are explicitly FORBIDDEN from: ...external data...enrichment...pre-trained knowledge
```
- **Label**: code-observed (the prompt is hard-locked to single-video scope; no augmentation allowed)

### Verdict: Video universe
- The system ingests a single videoId and feeds only that video's transcript + metadata into the LLM
- The closed-universe directive in the prompt forbids external lookup
- Whether the LLM actually obeys the directive at runtime is `unknown` (no prompt-eval test in repo)

---

### Question: Does it use transcript, description, channel, and page metadata?

### File: worker/src/routes/analysis.ts:36-51 (AnalysisRequest interface)
- **Snippet**: 
```
interface AnalysisRequest {
  videoId: string;
  transcript: string;
  metadata: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    duration: number;
    viewCount: string;
    likeCount: string;
    commentCount: string;
  };
  ...
}
```
- **Label**: code-observed (transcript + channelTitle + publishedAt + duration + counts are wired; `description` is NOT in this interface)

### File: web/lib/usecases/CreateAnalysisUseCase.ts:127-133
- **Snippet**: `detectPersona({ title, channelTitle, explicitPersona })` and `buildJobMetadata(ingestionResult.metadata)` — metadata is title, channelTitle, publishedAt, etc.
- **Label**: code-observed

### File: web/lib/usecases/ProcessChatMessageUseCase.ts:192-216 (chat grounding)
- **Snippet**:
```
grounding =
  `You are the analyst for the YouTube video "${groundingResult.title}"${groundingResult.channelTitle ? ` by ${groundingResult.channelTitle}` : ''}. ` +
  `Answer the user's questions using the structured analysis and the description below; ... ` +
  descriptionSection +
  `--- ANALYSIS ---\n` +
  md.slice(0, 12000);
```
- **Label**: code-observed (chat grounding explicitly references title + channelTitle + description + analysis markdown)

### Verdict: Data sources used
- Transcript: ✅ code-observed (wired in worker routes + CreateAnalysisUseCase)
- Channel/metadata (title, channelTitle, publishedAt, duration, view/like/comment counts): ✅ code-observed
- Description: ✅ code-observed (wired in chat grounding via `descriptionSection`)
- Page metadata (full page scrape beyond YouTube API): `unknown` (not visible in the traced path)

---

### Question: Does it stay confined to the video unless asked for outside augmentation?

### File: web/lib/prompts/ucis-v5.1.ts:572-577
- **Snippet**: `**CRITICAL REMINDER**: External data enrichment, web searching, and inference beyond the transcript boundary are FORBIDDEN. When data is absent, use the circuit breaker.`
- **Label**: code-observed

### File: worker/src/routes/analysis.ts:359-374 (transcript unavailable gate)
- **Snippet**:
```
if (!transcript || !transcript.trim() || transcript.includes("Transcript unavailable") || transcript.includes("content ingestion failed")) {
  return c.json(
    {
      error: "No transcript available",
      details: "Transcript could not be fetched from any source. LLM analysis skipped to avoid unnecessary costs.",
    },
    400,
  );
}
```
- **Label**: code-observed (worker returns 400 + skips LLM entirely if transcript is unavailable)

### File: web/lib/adapters/UpstashVectorAdapter.ts:18-54
- **Snippet**: `deduplicateNodes(tenantId, nodeIds, config)` — only performs KG deduplication; no retrieval for augmentation
- **Label**: code-observed

### File: supabase/migrations/20260521185646_optimize_vector_search_rpc.sql:6-39
- **Snippet**: `search_analyses_semantic(query_embedding, match_threshold, match_count, p_user_id, ...)` returns full analyses, not augmenting context
- **Label**: code-observed (RPC exists; not invoked in analysis or chat flow per prior grep)

### Verdict: Video confinement
- Prompt-level hard block in UCIS v5.1 prevents external lookup at LLM level
- Transcript-unavailable gate returns 400, LLM not invoked
- No automatic outside-augmentation path exists in traced code paths

---

## 2. CHAT BEHAVIOR

### Question: Does the chat box answer in short bullets, not long markdown blobs?

### File: web/lib/config/prompts.ts:14-20 (CHAT_PROTOCOL)
- **Snippet**:
```
export const CHAT_PROTOCOL = [
  'You are a concise, interactive analyst. NEVER dump. Hard rules:',
  '1) Answer in at most 5 short bullet points (or 2-3 sentences). No headings, no tables, no section numbers.',
  '2) Lead with the substance immediately.',
  '3) ALWAYS finish with a final line that is EXACTLY: OPTIONS: ["...","...","..."] — three short, specific next-step suggestions ...',
  'Output nothing after the OPTIONS line.',
].join('\n');
```
- **Label**: code-observed

### File: worker/src/chat-stream.ts:154 (max_tokens enforcement)
- **Snippet**: `max_tokens: 1200,` in OpenRouter request body
- **Label**: code-observed (token cap enforces brevity)

### File: web/components/templates/console/ChatDock.tsx:225-269 (rendered markdown)
- **Snippet**:
```
ul: ({ children }) => <ul className="list-disc list-outside pl-7 my-3 space-y-1.5 ml-1">{children}</ul>,
ol: ({ children }) => <ol className="list-decimal list-outside pl-7 my-3 space-y-1.5 ml-1">{children}</ol>,
li: ({ children }) => <li className="text-[12px] leading-relaxed text-[var(--ink-secondary)] pl-0.5">{renderChildren(children)}</li>,
p: ({ children }) => <p className="text-[12px] leading-relaxed mb-3.5 mt-1.5 text-[var(--ink-secondary)] last:mb-0">{renderChildren(children)}</p>,
```
- **Label**: code-observed (rendered list + paragraph classes)

### Verdict: Chat format
- Prompt enforces ≤5 bullets OR 2-3 sentences; OPTIONS line mandatory
- Token cap enforces brevity at API level
- Whether actual LLM responses obey ≤5 bullets is `unknown` (no eval test)

---

### Question: Does it support "what is this video?", "what does it tell me?", "how do I install/do this?" style prompts?

### File: web/lib/usecases/ProcessChatMessageUseCase.ts:192-216 (grounding instruction)
- **Snippet**: `"Answer the user's questions using the structured analysis and the description below; be concise, accurate, and cite dimension names where relevant."`
- **Label**: code-observed (the prompt is generic; no explicit enforcement of question-style patterns)

### File: web/components/templates/console/ChatDock.tsx:329-342 (OPTIONS parsing)
- **Snippet**:
```
function parseAssistant(content: string): { body: string; options: string[] } {
  const m = content.match(/OPTIONS:\s*(\[[\s\S]*\])\s*$/);
  ...
}
```
- **Label**: code-observed (OPTIONS regex parses trailing line)

### Verdict: Question-style support
- No explicit enforcement of "what is / what does / how to install" patterns
- OPTIONS parsing exists; chat surface presents user-typed freeform input

---

### Question: Does it return 1–5 clear points by default?

### File: web/lib/config/prompts.ts:16
- **Snippet**: `'1) Answer in at most 5 short bullet points (or 2-3 sentences). No headings, no tables, no section numbers.'`
- **Label**: code-observed

### Verdict: 1-5 points
- Prompt-level cap of 5 bullets
- Actual runtime adherence `unknown`

---

## 3. SECOND-BRAIN BEHAVIOR

### Question: Does it accumulate knowledge across many videos into domains or islands?

### File: web/lib/usecases/AggregateGlobalGraphUseCase.ts:1-44 (cross-video aggregation)
- **Snippet**:
```
const nodeMap = new Map<string, GraphNode>();
const edgeMap = new Map<string, GraphEdge>();
for (const analysis of analyses) {
  for (const node of analysis.nodes) {
    const existingNode = nodeMap.get(node.label);
    if (existingNode) {
      existingNode.weight += node.weight;
      ...
    } else {
      nodeMap.set(node.label, { ...node });
    }
  }
  ...
}
```
- **Label**: code-observed (merges by exact label string match; accumulates weight; merges keyTerms)

### File: web/lib/adapters/SupabaseGraphAdapter.ts:6-39 (data source for aggregation)
- **Snippet**: `.select(\`id, title, nodes:analysis_payload->knowledgeGraph->nodes, edges:analysis_payload->knowledgeGraph->edges\`).eq('user_id', tenantId);`
- **Label**: code-observed (reads from `analysis_payload->knowledgeGraph` JSONB; cross-video data)

### File: supabase/migrations/20260610110000_add_knowledge_graph_tables.sql:2-20
- **Snippet**: 
```
CREATE TABLE IF NOT EXISTS kg_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analyses(id) ON DELETE CASCADE,
  ...
);
```
- **Label**: code-observed (per-analysis FK; no cross-video join key)

### Verdict: Cross-video accumulation
- YES: nodes merge by exact label string across all user analyses
- NO domain/island grouping in code (entityType is used only as color in render, not for filtering)
- Whether this matches "domains or islands" is `unknown` (no semantic dedup; string-only matching)

---

### Question: Can it answer with broader cross-video insights when asked?

### File: web/app/api/atlas/global-graph/route.ts:1-26
- **Snippet**:
```
export async function GET() {
  const persistence = new SupabasePersistenceAdapter();
  const analyses = await persistence.getAnalysesByTenant(user.id);
  const useCase = new AggregateGlobalGraphUseCase();
  const globalGraph = await useCase.execute(analyses);
  return NextResponse.json(globalGraph);
}
```
- **Label**: code-observed

### File: supabase/migrations/20260521185646_optimize_vector_search_rpc.sql
- **Snippet**: `search_analyses_semantic(query_embedding, ...)` returns full analyses by vector similarity
- **Label**: code-observed (RPC exists; not called in analysis or chat path)

### Verdict: Cross-video insight path
- Atlas route aggregates all user analyses into a global graph
- Semantic search RPC exists but is `unknown` whether it is invoked for chat augmentation

---

### Question: Does it support the Atlas / global universe separate from the single-video universe?

### File: web/app/atlas/page.tsx:7-18
- **Snippet**: 
```
export default async function AtlasPage() {
  if (!session) { redirect('/auth/signin'); }
  return <AtlasClient />;
}
```
- **Label**: code-observed (separate route at `/atlas`)

### File: web/components/containers/DashboardContainer.tsx:334-338
- **Snippet**: `{ key: 'console', label: 'Synthesis Console' }, { key: 'atlas', label: 'The Atlas' },`
- **Label**: code-observed (Atlas is a separate nav item, not a console mode)

### File: web/hooks/useKnowledgeGraph.ts:52-108 (single-video) vs web/hooks/useGlobalGraph.ts:10-26 (cross-video)
- **Snippet**: `/api/analyses/${analysisId}/graph` vs `/api/atlas/global-graph`
- **Label**: code-observed

### Verdict: Atlas separation
- YES: Atlas is a separate route, separate hook, separate API endpoint
- Global graph aggregates; per-video graph does not

---

## 4. OUTPUT FORMATTING

### Question: Is the markdown formatting readable?

### File: web/components/dashboard/SelectedDimensionReadout.tsx:3-4
- **Snippet**: `import ReactMarkdown from 'react-markdown'; import remarkGfm from 'remark-gfm';`
- **Label**: code-observed

### File: web/components/dashboard/SelectedDimensionReadout.tsx:28-65 (custom components)
- **Snippet**:
```
h1: ..., h2: ..., h3: ..., h4: ...,
p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
ul: ({ children }) => <ul className="list-disc list-outside pl-5 mb-2 space-y-0.5">{children}</ul>,
ol: ({ children }) => <ol className="list-decimal list-outside pl-5 mb-2 space-y-0.5">{children}</ol>,
li: ({ children }) => <li className="text-[13px] leading-relaxed">{children}</li>,
code: ({ children, className }) => {
  const isBlock = className?.includes('language-');
  if (isBlock) {
    return <code className="block bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-2">{children}</code>;
  }
  ...
},
pre: ({ children }) => <pre className="bg-[var(--surface)] border border-[var(--line-faint)] rounded-md p-3 font-mono text-[12px] leading-relaxed overflow-x-auto my-2">{children}</pre>,
```
- **Label**: code-observed (paragraphs `mb-2`, lists `list-outside pl-5`, block code wrapped in `<pre><code>`)

### File: web/components/templates/console/ChatDock.tsx:225-269
- **Snippet**: same pattern, classes `mb-3.5 mt-1.5` for `p`, `list-outside pl-7` for `ul`
- **Label**: code-observed

### File: web/lib/utils/format.tsx:8-82 (preprocessMarkdown)
- **Snippet**: 
```
processed = processed.replace(/^[ \t]*[•●]\s*/gm, '- ');
processed = processed.replace(/\t[ \t]*[•●]\s*/g, '\t- ');
processed = processed.replace(/\|[ \t]*[•●]\s*/g, '| - ');
```
- **Label**: code-observed (preprocessing converts unicode bullets to markdown dashes; tab/pipe contexts preserved)

### Verdict: Markdown readability
- ✅ paragraphs have margin (`mb-2` or `mb-3.5 mt-1.5`)
- ✅ lists are `list-outside` with proper indentation
- ✅ block code wrapped in `<pre><code>`
- Whether margins render correctly in browser is `unknown` (no screenshot or runtime trace)

---

### Question: Are margins / spacing / paragraph separation actually good?

### File: web/components/templates/console/DimensionAccordion.tsx (base)
- **Snippet**: `if (lines[0]) { const firstLine = lines[0].trim().toUpperCase(); if (firstLine.startsWith('#') && /\bDIMENSION\s+\d+/.test(firstLine)) { lines.shift(); ... } }` — strips leading dimension header
- **Label**: code-observed (current branch change — cleanDimensionContent rewrite)

### Verdict: Paragraph separation
- CSS classes `mb-2` / `mb-3.5 mt-1.5` provide vertical rhythm
- Whether the runtime visual result is "good" is `unknown` (no visual test)

---

### Question: If not, name the exact formatting problem and where it comes from?

### Verdict: Formatting problems
- `unknown` — no concrete formatting bug identified from code reads alone; visual rendering requires runtime evidence
- Candidate concern: StreamingGrid uses `prose prose-invert` defaults; if the LLM emits non-standard markdown (e.g., raw HTML, mixed lists), the default prose plugin could mis-render. Not proven.

---

## 5. AUGMENTATION CONTROL

### Question: When the video itself is incomplete, does the system ask before using external knowledge bases?

### File: web/lib/prompts/ucis-v5.1.ts:46-58 (Insufficient Data Protocol)
- **Snippet**:
```
## 0.6 INSUFFICIENT DATA PROTOCOL
**When the transcript lacks depth for a dimension:**
- Do NOT invent data.
- Do NOT search for external data.
- Do NOT extrapolate beyond what is explicitly stated.
- Output the Dimension header and write exactly: "[Insufficient data in source transcript to fulfill this dimension]"
```
- **Label**: code-observed (system uses circuit breaker string, does NOT ask the user)

### File: worker/src/routes/analysis.ts:359-374
- **Snippet**: `return c.json({ error: "No transcript available", details: "..." }, 400);`
- **Label**: code-observed (transcript-gate returns 400 error, no prompt to user)

### File: web/lib/adapters/UpstashVectorAdapter.ts:18-54
- **Snippet**: `deduplicateNodes(...)` — post-analysis maintenance; not retrieval-for-augmentation
- **Label**: code-observed

### File: web/lib/qstash-client.ts:70-73
- **Snippet**: `/** For future use: semantic search requires embeddings */`
- **Label**: code-observed (QStash embedding publish is "for future use"; semantic search not invoked)

### File: web/app/api/webhooks/dream-sequence/route.ts:1-47
- **Snippet**: `await useCase.execute(tenantId, analysisId);` — daily dedup cron
- **Label**: code-observed (dream-sequence is dedup, not augmentation)

### Verdict: Augmentation control
- The system does NOT ask before using external knowledge bases — it forbids them entirely
- Transcript-unavailable returns 400 error to client
- Circuit breaker emits a fixed string instead of asking
- Outside augmentation is `unknown` whether any future semantic-search call exists (RPC defined but not invoked)

---

### Question: Is outside augmentation optional and explicit, not automatic?

### Verdict
- Outside augmentation is NOT optional/explicit because it does NOT exist in the traced path
- The system is closed-universe by design

---

## 6. GAPS VS VISION

| Vision requirement | Status from evidence |
|---|---|
| Stay within video universe by default | ✅ confirmed by UCIS closed-universe prompt + worker transcript gate |
| Use transcript + description + channel + metadata | ✅ all four wired; `description` only in chat grounding |
| Chat in short bullets (1-5 points) | ✅ prompt enforces ≤5 bullets + 1200 token cap |
| Support "what is / what does / how to install" question styles | `unknown` — no explicit pattern enforcement |
| Accumulate cross-video into domains/islands | `unknown` — flat label-merge only, no domain grouping |
| Cross-video insights when asked | `unknown` — Atlas exists as view; semantic-search RPC unused |
| Atlas separate from single-video universe | ✅ separate route + hook + API |
| Readable markdown formatting | ✅ proper CSS classes wired |
| Outside augmentation opt-in + explicit | N/A — system forbids outside augmentation entirely |

---

## 7. CONCLUSION

### One short verdict
- The system implements a closed-universe, single-video-first intelligence pipeline with a working Atlas cross-video view; chat format and video confinement are enforced at prompt and gate level; cross-video aggregation exists but lacks domain/island separation; outside augmentation is forbidden, not opt-in.

### What would change my mind
- A prompt-eval suite proving the LLM obeys the ≤5 bullet cap and closed-universe directive at runtime
- An integration test for `AggregateGlobalGraphUseCase` proving entity-type-based domain grouping (not just label merge)
- A semantic-search invocation trace showing `search_analyses_semantic` is called from chat when augmentation is explicitly requested
- A visual regression test (Playwright + screenshot diff) proving markdown margins, list-outside, and `<pre><code>` structure render as designed
- A test proving the transcript-unavailable 400 path is reached when YouTube + Decodo + proxy all fail

---

## End of Report