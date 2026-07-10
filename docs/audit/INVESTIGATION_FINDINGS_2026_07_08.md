# Investigation Findings: Webhook & Route Discovery

**Date**: 2026-07-08  
**Status**: COMPLETE FOR THESE ITEMS  

---

## ✅ Oracle-Sequence Webhook (SOLVED)

**Route**: `POST /api/webhooks/oracle-sequence`  
**Trigger**: QStash-scheduled task after analysis completion  
**Purpose**: Knowledge Graph Deduplication

**Implementation**:
```
Worker Flow:
  1. Analysis completes → KG nodes extracted
  2. QStash schedules dream-sequence webhook
  3. Webhook fetches graph from DB
  4. Identifies duplicate nodes via vector similarity
  5. Marks stale in Upstash vector store
  6. Deduplicates with 0.95 similarity threshold
  7. Deletes up to 50 duplicates per run (safety limit)
```

**Use Case**: Prevent the second brain (ATLAS) from accumulating duplicate concepts when the same ideas appear across multiple analyses.

**Reference**: DeduplicateGraphUseCase.ts (line 22-25)

**Architecture Pattern**: 
- Async post-analysis enrichment (no blocking)
- Safety thresholds to prevent accidental data loss
- Tenant-scoped deduplication (multi-tenant aware)

---

## ✅ PDF Route vs Export Route (SOLVED)

### Route 1: `/api/pdf` (POST)
**Purpose**: Generic markdown-to-PDF converter  
**Input**: Raw markdown string in request body  
**Output**: PDF binary stream  
**Tier Gating**: None  
**Auth**: Basic (user must be authenticated)  
**Use Case**: Quick PDF generation for any markdown content  

**Implementation**:
```typescript
Body: { markdown, title?, videoId?, fileName? }
Returns: PDF binary with streaming chunks
Formatting: Simple (title + metadata + text content)
```

### Route 2: `/api/analyses/[id]/export` (GET)
**Purpose**: Analysis-specific PDF export (with tier restrictions)  
**Input**: URL params `?format=pdf&scope=summary|full`  
**Output**: PDF binary (summary or full report)  
**Tier Gating**: YES
  - Free/Standard: Summary only
  - Pro/Enterprise: Full report (all 11 dimensions)
**Auth**: Required + ownership check  
**Use Case**: User-facing "Download Analysis" button  

**Implementation**:
```typescript
Query: /analyses/{id}/export?scope=full
Validates: Ownership, tier permissions, markdown presence
Returns: Either summary PDF or full PDF based on scope
Error Handling: 402 if free user requests full report
```

**Pattern**: The export route is the proper public API; `/api/pdf` is a utility endpoint.

---

## ⏳ STILL PENDING INVESTIGATION

### 1. Relations Endpoint vs Knowledge Graph
**Locations**:
- `GET /api/analyses/[id]/relations`
- `GET /api/analyses/[id]/graph`

**Question**: Do these return the same data or different representations?

### 2. Transcript Ephemeral Store
**Question**: Purpose, retention policy, access patterns?

### 3. QStash Background Jobs Beyond Core
**Identified So Far**:
- dream-sequence (deduplication)
- reaper (stuck analysis cleanup)
- embed (vector indexing)
- validate (webhook validation)

**Question**: Are there others?

### 4. Dimension Reordering Workflow (#34)
**Question**: How does persona-based dimension sequencing work in practice?

### 5. Time-Seek UI Integration
**Question**: How do timestamp markers integrate with dimension links?

---

## KEY ARCHITECTURAL PATTERNS DISCOVERED

### Pattern 1: Async Post-Analysis Enrichment
```
Analysis Complete → QStash Scheduler → Background Webhook
Benefits:
  - Non-blocking (analysis marked complete immediately)
  - Fault-isolated (enrichment failure ≠ analysis failure)
  - Scalable (distributed via QStash)
```

### Pattern 2: Tier-Gated Features at Route Level
```
GET /api/analyses/[id]/export?scope=full
  → Check user tier
  → If free: 402 Payment Required (with upgrade flag)
  → If pro/enterprise: Generate full report
Benefits:
  - Single source of truth for permissions
  - Clear error messaging to client
  - DRY (no duplicate checks in UI/business logic)
```

### Pattern 3: Dual API Design
```
/api/pdf → Utility (generic converter)
/api/analyses/[id]/export → Public API (business feature)
Benefits:
  - Separation of concerns
  - Reusability (export uses PDF route internally)
  - Clear contract boundaries
```

---

## RECOMMENDATIONS FOR NEXT WAVE

1. **Complete Relations/Graph investigation** - Determine if they're redundant or complementary
2. **Document Ephemeral Store contract** - Define retention SLA and access patterns
3. **Map all QStash jobs** - Create visual dependency graph of post-analysis workflows
4. **Test time-seek UI** - Verify timestamp links work with dimension markers
5. **Add deduplication metrics** - Track how many duplicates are found/deleted per day

---

**Next Step**: Continue with relations endpoint and ephemeral store investigation before stabilization test phase.
