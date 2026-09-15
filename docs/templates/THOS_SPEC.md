# THOS (Technical Handover Summary) Specification

Verbatim spec, as provided by the user (2026-09-08), for producing a Technical Handover Summary
document at end of session / on request. Saved here so it doesn't need to be re-pasted every time.

Naming convention for generated THOS files: `docs/history/THOS_<date>_<time>_<SHORT_DESCRIPTION>.md`
(NOT `HANDOVER_...` — see memory `feedback_handover_doc_naming_thos.md`).

---

## 1. Mandatory Operating Principles
1.1 Always think step-by-step before documenting
1.2 Always critique your summarization decisions before finalizing
1.3 Always verify with sample output until 95%+ confident; expand sample if needed or raise exception with specific problem + proposed solution

## 2. Verification Philosophy (Apply to all documentation)
- "Plan 10x, Verify 10x, Execute 1x" – Never skip verification steps
- "Verify, then trust, then act" – Never accept statements at face value
- Document what was verified, not just what was claimed

## 3. Objective
Create a complete, zero-ambiguity technical summary enabling seamless continuation by another LLM without any clarifying questions, troubleshooting loops, or loss of critical context across sessions.

## 4. Critical Anti-Pattern Warnings
⚠️ NEVER over-summarize these categories:
- Iterative development cycles (5–6+ iterations to reach solution)
- Productive knowledge cycles (design sessions, baseline creation, system design)
- Troubleshooting loops and their resolution paths
- Key decision inflection points
- Differential code snippets that made breakthroughs possible
- Multi-agent coordination logic and sequential dependencies
- The last 3–4 prompts of any session (session bridge content)
- Recurring housekeeping/reminder patterns

⚠️ **Session Bridge Preservation Rule**: The last 3–4 prompts and responses represent the critical bridge between sessions. These MUST be preserved nearly intact with minimal summarization to ensure seamless continuation. Treat this content as sacred context that prevents "starting from scratch" syndrome.

## 5. Required Structure

### 5.1 Header Format
```
TECHNICAL HANDOVER SUMMARY – [Project Name + Context]
Session Date: [Start Date – End Date or Single Date], [Start Time – End Time or Single Time]
Agents Involved: [Agent/Agents (LLM Model Used with Each)]
Project: [Project Name (brief description)]
Session Type: [Type of work – e.g., Emergency recovery, Feature development, Migration, Troubleshooting]
Status: [High-level status of major phases/components]
```

### 5.2 Executive Summary (2–3 sentences)
- Project name and core objective
- Current status and next immediate action
- Biggest blocker or breakthrough from this session

### 5.3 Technical Environment (Exact specifications)
- Tech stack with specific versions
- Development environment details (OS, IDE, tools with build numbers)
- Dependencies and package manager configuration
- Active branches, repository state, and uncommitted changes
- Multi-agent setup (if applicable)

### 5.4 Chronological Timeline (Reverse chronological – newest first)
For each major event, include:
- Date/time stamps
- Problem → Solution → Outcome → Current state
- 🔑 Key decisions with rationale
- Configuration changes (before/after)
- Failed approaches and why

## 6. Iterative Development Tracking
When a solution required 5–6+ iterations:
6.1 List iteration steps concisely
6.2 State the final outcome
6.3 Include differential code/config that enabled breakthrough
6.4 Tag as 🔑 KEY DECISION or 💡 BREAKTHROUGH

## 7. Troubleshooting Loop Documentation
When troubleshooting consumed multiple cycles:
7.1 Root cause category
7.2 Cycle count and wasted time/cost
7.3 "Stop and think" moments
7.4 Verification gaps
7.5 Breakthrough insight
7.6 Prevention measure

## 8. Knowledge Cycles & Productive Iterations

### 8.1 Purpose
Capture discrete work streams representing complete knowledge areas.

### 8.2 What qualifies
- Design reviews
- System design sessions
- Architecture decisions
- Investigation → insight → decision loops
- Tool/process creation

### 8.3 Do NOT include
- Troubleshooting loops
- Repetitive operations

### 8.4 Required Cycle Format
- Cycle Name (Duration)
- Trigger
- Objective
- Participants
- Phases
- Key artifacts
- Outcome
- Lifecycle status
- Integration status
- Why this matters

## 9. Recurring Patterns / Housekeeping Reminders
For recurring issues:
9.1 Pattern
9.2 Frequency
9.3 Core Issue
9.4 User's Frustration Statement
9.5 Attempted Solutions
9.6 Status
9.7 What would actually fix this

## 10. Current State Snapshot
- What works ✅
- What doesn't work ❌
- In-progress tasks
- Blocked items
- Technical debt

## 11. Context Preservation
- User working style
- Communication patterns
- Conventions
- Tools/workflows
- Automation scripts
- Multi-agent coordination patterns

## 12. Session Bridge Content (Last 3–4 Prompts)
⚠️ Preserve with minimal summarization:
12.1 User prompts
12.2 LLM responses
12.3 Code/commands
12.4 Unresolved questions

## 13. Critical Path Forward
For each of the next 3 priority actions:
13.1 Action description
13.2 Dependencies
13.3 Verification criteria
13.4 Edge cases
13.5 Complexity

## 14. Reference Index
- File paths
- Config locations
- API endpoints (no secrets)
- Documentation
- Prior solutions
- Commits / PRs

## 15. Intelligent Summarization Guidelines

### 15.1 Do NOT summarize
- Breakthrough code snippets
- Troubleshooting paths
- Key decisions
- Verification steps
- Session bridge content
- Multi-agent logic
- Failed approaches
- Knowledge cycles
- Recurring patterns

### 15.2 Can be summarized
- Repetitive success patterns
- Verbose explanations
- Tool output
- Previously documented context

## 16. How to Summarize Multi-Iteration Work
16.1 List attempts
16.2 State final outcome
16.3 Extract key differential
16.4 Tag importance

## 17. Formatting Requirements
- Use bullet points / lists
- Include real code & commands
- Use absolute paths
- Include versions
- Maintain consistent terminology
- Use emojis for tagging

## 18. Validation Checklist
- Header complete
- No ambiguity
- Versions included
- Problems show resolution
- File paths valid
- Commands usable
- Next steps actionable
- Session bridge preserved
- Iterations documented
- Loops documented
- Knowledge cycles included
- Recurring patterns captured
- Key decisions tagged
- Verification included
- Multi-agent logic preserved
- No lost insights

## 19. Output Format
Structured markdown, high density, high clarity, optimized for LLM readability.

## 20. Meta-Instruction for LLM Executing This Prompt
20.1 Think step-by-step
20.2 Critique summarization decisions
20.3 Identify knowledge cycles
20.4 Identify recurring issues
20.5 Validate completeness (≥95%)
