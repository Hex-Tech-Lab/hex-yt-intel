# Wave 3: Branch Consolidation Strategy

## Current State Analysis (Post-PR #146)

**Main Branch**: f845da3 (2026-07-12)
- Latest production deployment with P0 fixes and incident resolution
- All critical tests passing (819/819)
- Security gates passed

## Active Follow-up Branches (Priority Order)

### P1: Security Hardening
**Branches**: claude/follow-up-error-logging, claude/follow-up-network-resilience
**Commits**: 6 total (may overlap)
**Focus**: 
- Dual-secret HMAC verification (fallback mechanism)
- Central error categorization utility
- Comprehensive error logging (search, analyses APIs)
- Chat persist endpoint resilience
- Worker persist HMAC alignment

**Rationale**: Security-critical after recent incident. Should be merged first to ensure production stability.

### P2: Performance Optimization
**Branch**: task/bundle-optimization-l3fnel
**Commits**: 14+
**Focus**:
- Bundle size reduction via aggressive lazy-loading (50% reduction target)
- Dynamic imports for visualization components
- Lazy-load RightPanelAccordion, AnalysisHero, metadata components
- Documentation/JSDoc expansion
- CodeRabbit review findings resolution
- Type-safety improvements

**Rationale**: Improves page load performance and user experience.

### P3: Documentation
**Branch**: claude/follow-up-docstring-coverage
**Commits**: 1
**Focus**: Comprehensive docstrings to hooks and adapters

**Rationale**: Improves code maintainability.

## Consolidation Strategy

1. **Conflict Resolution**: Analyze overlaps between error-logging and network-resilience
2. **Merge Order**:
   - P1 security branches (error-logging or network-resilience, skip duplicate)
   - P2 performance branch (bundle-optimization)
   - P3 documentation branch (docstring-coverage)
3. **Integration Testing**: 
   - Run quality-engine after each merge
   - Type-check after each merge
   - Build worker after security changes
4. **Stale Branch Cleanup**: Document branches to remove after consolidation
5. **Documentation**: Update CLAUDE.md with new branch policy

## Stale Branches to Archive

- claude/pr136-deepsource-cleanup (2026-07-10) - Pre-merge cleanup
- claude/wave7-search-topk (2026-07-10)
- claude/wave9-worker-decomp (2026-07-10)
- claude/wave9-rules-decomp (2026-07-09)
- claude/wave7-kg-edge-fix (2026-07-09)
- claude/wave7-persona-unification (2026-07-09)
- claude/wave9-dashboard-decomp (2026-07-09)
- claude/wave9-ui-spacing (2026-07-09)
- claude/wave7-digest-validation (2026-07-09)
- claude/wave9-adapt-persistence (2026-07-09)

Total: 10 branches to archive (document in cleanup commit)

## New Branch Policy (for CLAUDE.md update)

### Branch Naming Convention
- `claude/feature-<name>` - Single feature development
- `claude/wave-<n>-<scope>` - Wave-based consolidation work
- `task/<name>` - Non-wave task work
- `fix/<name>` - Critical hotfixes

### Branch Lifetime
- Feature branches: Delete after PR merge
- Follow-up branches: Consolidate within 2 days of merge into secondary consolidation PR
- Wave branches: Maintain until merged to main

### Consolidation Rule
- Post-merge follow-up work should be consolidated in a single Wave consolidation PR
- Prevents "branch explosion" after major merges
- Reduces review fatigue (one big PR vs. many small PRs)
