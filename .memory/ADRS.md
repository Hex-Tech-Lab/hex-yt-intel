# Architecture Decision Records

## Format
`[YYYY-MM-DD] [AgentID] [Status] [DECISION] Title. Rationale: ... Alternatives: ... Confirmed by user: yes/no`
Status: ACTIVE | SUPERSEDED | ✅

---
- [2026-06-18] [OCT2] [ACTIVE] [DECISION] Restore Decodo as primary transcript provider. Rationale: GCT1 reversed the agreed cascade (YouTube→Decodo→Placeholder), but YouTube requires residential proxy that isn't reliably configured. Decodo now has real API key. Alternatives: Keep YouTube first (GCT1 order), build YouTube Data API v3 tier. Confirmed by user: yes

