# Architecture Decision Records

## Format
`[YYYY-MM-DD] [AgentID] [Status] [DECISION] Title. Rationale: ... Alternatives: ... Confirmed by user: yes/no`
Status: ACTIVE | SUPERSEDED | ✅

---
- [2026-06-18] [OCT2] [ACTIVE] [DECISION] Restore Decodo as primary transcript provider. Rationale: GCT1 reversed the agreed cascade (YouTube→Decodo→Placeholder), but YouTube requires residential proxy that isn't reliably configured. Decodo now has real API key. Alternatives: Keep YouTube first (GCT1 order), build YouTube Data API v3 tier. Confirmed by user: yes
- [2026-06-19] [AGY3] [ACTIVE] [DECISION] Decompose 5 monoliths in Wave 6 using Ponytail guidelines. Rationale: Splitting SupabasePersistenceAdapter.ts (1206 LOC) into 4 adapters, rules.ts (1135 LOC) into config + engine, DashboardContainer.tsx (726 LOC) into clean UI sub-components, worker.ts (657 LOC) into routing + route files, and stripe/webhook/route.ts (517 LOC) into helper handlers. This reduces cognitive load and enforces strict single responsibility. Alternatives: Keep files as-is. Confirmed by user: no

