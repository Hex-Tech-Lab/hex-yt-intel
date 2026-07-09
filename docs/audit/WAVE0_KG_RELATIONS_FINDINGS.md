# Wave 0 Agent 4: Knowledge Graph 3-Endpoint Contract Audit

**Date**: 2026-07-08  
**Status**: COMPLETE  
**Agent ID**: a7bb3dfe0ea788e5e  
**Deliverable**: `web/lib/__tests__/contracts/kg-relations.contract.test.ts` (53 test cases, 700+ LOC)

---

## 🔴 CRITICAL FINDINGS

### Contract Violation #1: Schema Inconsistency

**Per-Analysis Endpoint** (`GET /api/analyses/{id}/graph`)
```typescript
// Returns:
{
  entities: [
    { id, label, category, ... }
  ],
  relations: [
    { source_entity_id, target_entity_id, relation_label, ... }
  ]
}
```

**Global-Graph Endpoint** (`GET /api/atlas/global-graph`)
```typescript
// Returns:
{
  nodes: [
    { id, label, ... }
  ],
  edges: [
    { source, target, kind, ... }
  ]
}
```

**Impact**: 
- ❌ Client can't reuse same parser for both
- ❌ Type safety lost
- ❌ GraphQL consumers broken
- ❌ Visualization layer can't share components

**Fix**: Normalize to single schema `{nodes[], edges[]}` across all endpoints

---

### Contract Violation #2: Edge Mapping Bug in Global-Graph

**Location**: `AggregateGlobalGraphUseCase` (line ~120)

```typescript
// CURRENT (WRONG):
const nodesByLabel = new Map();
for (const node of allNodes) {
  nodesByLabel.set(node.label, node);  // Key by LABEL
}

for (const edge of allEdges) {
  const source = nodesByLabel.get(edge.source_label);  // Lookup by LABEL
  const target = nodesByLabel.get(edge.target_label);  // Lookup by LABEL
  // But edges store edge.source_id and edge.target_id!
}
```

**Problem**: 
- Nodes keyed by `label` (mutable, non-unique)
- Edges reference `source_id` / `target_id` (immutable UUIDs)
- Lookup misses → edges orphaned
- Same label in different analyses creates collision

**Result**: Graph traversal breaks. Edges don't connect to nodes.

**Example**:
```
Analysis A: Node (id: uuid-1, label: "audience")
Analysis B: Node (id: uuid-2, label: "audience")
Edge between A's "audience" and B's node

Current code:
  nodesByLabel.set("audience", uuid-2)  // Overwrites!
  edge.source references uuid-1 → LOST
```

**Fix**: Use `nodeId` (UUID) as key, not label
```typescript
const nodesById = new Map();
for (const node of allNodes) {
  nodesById.set(node.id, node);  // Key by ID
}

for (const edge of allEdges) {
  const source = nodesById.get(edge.source);  // Lookup by ID
  const target = nodesById.get(edge.target);  // Lookup by ID
}
```

**Severity**: 🔴 **HIGH** — Data corruption, breaks graph traversal

---

### Contract Violation #3: Orphaned Edges on Node Deletion

**When deduplication deletes a node**:
1. Node deleted from `knowledge_graph_nodes`
2. ❌ Edges NOT deleted from `knowledge_graph_edges`
3. Remaining edges reference now-deleted nodes

**Database State After Dedup**:
```sql
-- Nodes table (after dedup marks node-1 for deletion):
SELECT * FROM knowledge_graph_nodes;
-- Returns: [node-2, node-3, ...]  (node-1 gone)

-- But edges table still has:
SELECT * FROM knowledge_graph_edges;
-- Returns: [
--   {source_id: node-1, target_id: node-2},  ← ORPHANED!
--   {source_id: node-2, target_id: node-3},  ← OK
-- ]
```

**Fix**: Add cascading cleanup in `DeduplicateGraphUseCase`
(Note: GraphPersistencePort does not have a `deleteEdges` method; use `persistKnowledgeGraph` with delete+insert semantics or add this method to the port interface)
```typescript
// After deduplicateNodes() deletes:
const deletedNodeIds = result.deletedIds;
// TODO: Implement edge cleanup - either add deleteEdges to port or use persistKnowledgeGraph
// to rebuild graph with orphaned edges removed
```

**Severity**: 🟡 **MEDIUM** — Inconsistent relational data, query failures

---

### Contract Violation #4: Incomplete Input Validation

**Oracle-Sequence Webhook** (`POST /api/webhooks/oracle-sequence`)

```typescript
// Current: Has presence checks for tenantId and analysisId (returns 400 if missing)
// But missing:
// - UUID format validation (tenantId, analysisId)
// - analysisId existence check (does analysis exist?)
// - tenantId ownership verification (does tenant own analysis?)
export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body.tenantId || !body.analysisId) return res.status(400);
  // Missing UUID format, existence, and ownership checks
}
```

**Risks**:
- ❌ Silent failures on malformed data
- ❌ No audit trail of which analyses processed
- ❌ Security: No ownership verification
- ❌ Qstash could re-submit bad data

**Fix**: Add schema validation
```typescript
import { z } from 'zod';

const webhookSchema = z.object({
  tenantId: z.string().uuid('Invalid tenant ID'),
  analysisId: z.string().uuid('Invalid analysis ID'),
  // Additional fields
});

const { tenantId, analysisId } = webhookSchema.parse(body);

// Verify analysis exists and belongs to tenant
const analysis = await persistence.getAnalysis({ id: analysisId, tenantId });
if (!analysis) {
  throw new Error(`Analysis ${analysisId} not found for tenant ${tenantId}`);
}
```

**Severity**: 🟡 **MEDIUM** — Observability, security

---

### Contract Violation #5: Vector Store Return Value Inconsistency

**VectorDedupPort.deduplicateNodes()** returns:
```typescript
{
  success: boolean,
  deletedCount: number,
  error?: string
}
```

**But caller expects**:
```typescript
{
  success: boolean,
  deletedCount: number,
  markedStale?: number,
  canonicalNodes?: string[],
  error?: string
}
```

**Missing**:
- ❌ `markedStale` — how many nodes marked before deleting?
- ❌ `canonicalNodes` — which nodes are canonical?
- ❌ Duplicate severity — how similar were duplicates?

**Impact**: Can't audit effectiveness of deduplication or trace which nodes kept/deleted

**Fix**: Extend return type
```typescript
interface DedupResult {
  success: boolean;
  markedStale: number;      // How many nodes examined
  deletedCount: number;     // How many actually deleted
  canonicalNodes: string[]; // Which nodes kept as canonical
  duplicatePairs: Array<{
    canonical: string;
    duplicate: string;
    similarity: number;
  }>;
  error?: string;
}
```

**Severity**: 🟡 **MEDIUM** — Audit trail, debugging

---

## ✅ RELATIONS ENDPOINT VERDICT

**Question**: Is `GET /api/analyses/{id}/relations` redundant? Should we delete it?

**Answer**: **NO. Keep it. NOT redundant.**

### Why:

| Aspect | `/graph` Endpoint | `/relations` Endpoint |
|--------|------|------|
| **Data Source** | DB (PostgreSQL) | LLM (OpenRouter) |
| **Content** | Entity extraction + co-occurrence | Semantic relationships + insights |
| **Response Type** | JSON | Server-Sent Events (streaming) |
| **Latency** | <100ms (DB query) | ~10-30s (LLM generation) |
| **Cacheable** | Yes (static once analysis done) | Yes (by markdown hash) |
| **Use Case** | Visualization, traversal | AI-generated insights, explanations |
| **Updatable** | Never (immutable after analysis) | Can regenerate with better model |

### Example Data Difference:

**Graph Endpoint**:
```json
{
  "entities": [
    {"id": "e1", "label": "audience segmentation", "category": "concept"},
    {"id": "e2", "label": "engagement metric", "category": "metric"}
  ],
  "relations": [
    {"source_entity_id": "e1", "target_entity_id": "e2", "relation_label": "impacts"}
  ]
}
```

**Relations Endpoint** (SSE stream):
```
event: insight
data: {"id": "r1", "type": "tangential", "text": "This contradicts best practices because..."}

event: insight  
data: {"id": "r2", "type": "opportunity", "text": "You could leverage this by..."}
```

**Verdict**: Completely different purposes. Keep both.

---

## 🔴 ORACLE-SEQUENCE (Dream-Sequence) AUDIT

### What It Does (Correctly)
✅ Vector similarity threshold: 0.95 (appropriate)
✅ Safety limit: max 50 deletes/run (prevents accidental purges)
✅ Tenant-scoped: processes one tenant at a time
✅ Async: doesn't block analysis completion

### What It Lacks (Bugs)
❌ No edge cleanup (Violation #3)
❌ No input validation (Violation #4)
❌ No return value audit trail (Violation #5)
❌ No logging of processed nodes
❌ No existence checks before/after

### Fix Path
1. Add schema validation to webhook route
2. Implement edge cascading cleanup
3. Extend return type with audit fields
4. Add detailed logging of processed nodes
5. Create integration tests for full workflow

---

## 📊 Contract Test Suite Delivered

**File**: `/web/lib/__tests__/contracts/kg-relations.contract.test.ts`

**Coverage** (53 test cases):

```
✅ Per-Analysis Graph Endpoint (8 tests)
   - Schema shape validation
   - Ownership verification
   - Empty graph handling
   - Entity type constraints
   - Relation label mapping

✅ Global-Graph Endpoint (12 tests)
   - Multi-analysis aggregation
   - Node ID collision handling
   - Edge orphaning detection
   - Deduplication effectiveness
   - Tier-based filtering

✅ Relations Endpoint (7 tests)
   - SSE streaming format
   - Cache key consistency
   - LLM generation contract
   - Ownership scoping

✅ Oracle-Sequence Webhook (15 tests)
   - Input validation schema
   - Similarity threshold enforcement
   - Safety limit (max 50 deletes)
   - Edge cleanup verification
   - Return value audit fields
   - Existence checks

✅ Cross-Endpoint Contracts (11 tests)
   - Schema normalization needed
   - ID reference consistency
   - Tenant ownership verification
   - Tenant isolation
```

---

## 🎯 Immediate Actions

### Priority 1 (This Sprint)
- [ ] Run contract tests to establish baseline
- [ ] Fix edge mapping bug (Violation #2) — data corruption risk
- [ ] Add input validation to webhook (Violation #4)

### Priority 2 (Next Sprint)
- [ ] Normalize schemas (Violation #1) — breaking change, coordinate with clients
- [ ] Implement edge cascading cleanup (Violation #3)
- [ ] Extend return types with audit fields (Violation #5)

### Priority 3 (Follow-up)
- [ ] Add logging/metrics to Oracle-Sequence
- [ ] Performance test with large graphs (100k+ nodes)
- [ ] Update API documentation

---

## Effort Estimate

| Task | Effort | Days |
|------|--------|------|
| Fix edge mapping bug | Medium | 1-2 |
| Add input validation | Low | 0.5 |
| Schema normalization | High | 2-3 |
| Edge cleanup + audit trail | Medium | 1-2 |
| Full test coverage + docs | Medium | 1-2 |
| **TOTAL** | | **5-8 days** |

---

## Key Insights

1. **Not actually "three endpoints"** — more like 2 queries (graph, relations) + 1 mutation (dedup)
2. **Schema fragmentation is the root issue** — everything else cascades from schema mismatch
3. **Oracle-Sequence is solid pattern** — just needs input validation and audit trail
4. **Relations endpoint is valuable** — serves different use case (LLM-based insights vs DB-based structure)
5. **Ownership isolation is properly enforced** — good security posture at query layer

---

**Next**: Await Wave 0 Agents 1, 2, 3, 5 to complete. Then aggregate all findings and create comprehensive PR for `/pr-workflow-review`.
