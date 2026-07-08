# Wave 3-4 Parallel Execution Plan
## UI Fixes + Knowledge Loop Implementation (Parallel)

**Date**: 2026-07-08  
**Execution Mode**: Parallel waves with 5 agents each  
**Coordination**: Via .memory/AGENT_LEDGER.md  
**Tool Limits**: Checked upfront (PR source limits, review limits)

---

## Wave 3: UI/Rendering Fixes (Font, Anchors, Word Cloud)
**Duration**: ~6-8 hours  
**Agents**: 5 (one per component + QA)  
**Outcome**: Single PR with coordinated UI fixes  

### Issues to Fix
1. **Mind Map Connectors** - Anchoring not at node endpoints
2. **Knowledge Graph Font** - Too large/bold, no proportionality
3. **Word Cloud Proportionality** - All words similar size despite frequency diff (63 vs 44)

### Agent Assignments
- Agent 1: Mind Map connector anchoring fix
- Agent 2: Knowledge Graph font sizing (proportional + selective bold)
- Agent 3: Word Cloud frequency scaling
- Agent 4: Integration testing + visual regression
- Agent 5: QA + PR coordination

---

## Wave 4: Knowledge Loop Implementation (Capture → Wiki → Grounding)
**Duration**: ~8-10 hours  
**Agents**: 5 (one per layer + QA)  
**Outcome**: Single PR with end-to-end knowledge loop  

### Layers to Implement
1. **Question Capture** - Store `/raw/{userId}/questions/{timestamp}.md`
2. **Wiki Builder** - Monthly Claude skill aggregating themes
3. **History Injection** - Load user's topic-relevant Q/As before chat
4. **Adaptive OPTIONS** - Personalized follow-ups based on journey
5. **Integration** - Wire into chat grounding

### Agent Assignments
- Agent 1: Question capture endpoint + schema
- Agent 2: Wiki builder skill (monthly aggregation)
- Agent 3: History injection into grounding context
- Agent 4: Adaptive OPTIONS generation
- Agent 5: Integration testing + PR coordination

---

## Tool Limit Review (Pre-PR)
- **CodeRabbit**: ~5-10 min wait if rate limited, can re-trigger after
- **DeepSource**: JavaScript analyzer, check for blocking issues
- **Codacy**: 0 new issues acceptance
- **PR Source Limit**: Verify <150K bifs before submitting
- **GitHub Actions**: Standard 7-stage pipeline

---

## Parallel Execution Timeline

```
Start (T=0)
├─ Wave 3: UI Fixes
│  ├─ Agent 1: Mind Map anchoring (T=0-2h)
│  ├─ Agent 2: KG font sizing (T=0-2h)
│  ├─ Agent 3: Word Cloud scaling (T=0-2h)
│  ├─ Agent 4: Integration tests (T=2-4h)
│  ├─ Agent 5: PR review + submit (T=4-6h)
│  └─ PR #129 Created (T=6h)
│
├─ Wave 4: Knowledge Loop
│  ├─ Agent 1: Question capture (T=0-2h)
│  ├─ Agent 2: Wiki builder skill (T=0-3h)
│  ├─ Agent 3: History injection (T=2-4h)
│  ├─ Agent 4: OPTIONS adaptation (T=3-5h)
│  ├─ Agent 5: Integration + tests (T=5-7h)
│  └─ PR #130 Created (T=8h)
│
└─ Both PRs Submitted by T=8h
   ├─ CI runs in parallel
   ├─ Wave 1 review (code review tools)
   ├─ Wave 2 review (tests + deployment)
   └─ Both merge by T=16h if green
```

---

## PR Grouping Strategy

**PR #129 (Wave 3)**: UI Rendering Fixes
- Scope: web/components/templates/ + web/lib/visualization/
- Test: Visual regression + screenshot comparison
- Risk: Low (visual only, no data model changes)

**PR #130 (Wave 4)**: Knowledge Loop Implementation
- Scope: web/lib/usecases/ + web/app/api/chat/ + worker/
- Test: Capture → Wiki build → Grounding injection
- Risk: Medium (data model changes, requires careful testing)

---

## Coordination Method
1. Read `.memory/AGENT_LEDGER.md` before starting
2. Log `[IN_PROGRESS]` with target files + timestamp
3. Coordinate cross-wave dependencies via ledger
4. Update to `[DONE]` when complete
5. Orchestrator (me) verifies + submits PRs

