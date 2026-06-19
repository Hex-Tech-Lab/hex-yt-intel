# Sprint 1: Launch Blockers

**Branch:** `sprint-1/launch-blockers`
**Gate:** Manual review before merge

---

## Items

### Security (P0)
1. Fix `verifyResourceOwnership` SELECT * OOM risk
2. Remove mock HMAC secret from source
3. Decouple client signal from persist fetch
4. Restore quality engine as CI gate

### Frontend (P0-P1)
5. Add `@theme { --radius-*: 0px }` to globals.css
6. Add `color-scheme: dark` and `theme-color` meta to layout.tsx
7. Migrate inline styles (ChatDock, TopBar, Sidebar, AnalysisHero) → Tailwind

### Architecture (P2)
8. Split PersistencePort into focused interfaces
9. Fix Hexagonal boundary violations (6 services, 6 adapters)
10. Delete dead GraphRAGPort
