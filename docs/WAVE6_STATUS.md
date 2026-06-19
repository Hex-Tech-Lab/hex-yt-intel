# Wave 6: Refactor Monoliths + UI Enhancements

## Status
- Branch: wave6/refactor-monoliths-ui-enhancements
- Sink: OCT
- PR: pending

## Tasks
### OCT (UI Corrections)
- [ ] Fix excessive vertical spacing (gap-8 → gap-4)
- [ ] Move quota text to top of hero
- [ ] Add margin to central + right panel content
- [ ] Reduce border-radius on pills/cards (~7-8px)
- [ ] Add padding to accordion labels
- [ ] Fix INP issue: accordion button 494.8ms blocking

### AGY (Monolith Decomposition)
- [ ] SupabasePersistenceAdapter.ts (1205 LOC → 4 adapters)
- [ ] rules.ts (1134 LOC → config + engine)
- [ ] DashboardContainer.tsx (726 LOC → components)
- [ ] worker.ts (656 LOC → routes + middleware)
- [ ] stripe/webhook/route.ts (516 LOC → handlers)

