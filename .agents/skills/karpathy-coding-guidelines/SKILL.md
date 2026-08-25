---
name: karpathy-coding-guidelines
description: Core behavioral coding guidelines inspired by Andrej Karpathy, tailored for Hexagonal Lite and Domain-Driven Design (DDD-Lite) architectures.
when_to_use: writing, refactoring, reviewing, or designing code across the workspace to eliminate common LLM mistakes, prevent architectural erosion, and ensure surgical, goal-driven execution
---

# Karpathy Coding Guidelines (Hex-Lite & DDD-Lite Enforced)

Behavioral engineering guidelines to eliminate common LLM coding pitfalls (unsolicited refactoring, speculative abstraction, hidden assumptions, drift) while strictly enforcing **Hex-Lite + DDD-Lite** boundaries and **Separation of Concerns (SoC)**.

---

## The 4 Core Tenets

### 1. Think Before Coding
**Surface assumptions early. Map blast radius before writing code. Never assume silently.**

- State your assumptions explicitly before implementation. If requirements are ambiguous, clarify rather than guessing.
- Consult `.memory/AGENT_LEDGER.md` and `.memory/ADRS.md` to guarantee zero cross-agent file collisions and align with recorded decisions.
- If multiple interpretations exist, present tradeoffs clearly — do not pick silently.
- Push back with empirical evidence if a simpler or more robust approach exists.

### 2. Simplicity First (Hex-Lite & DDD-Lite Enforced)
**Build the minimum viable logic. Zero speculative abstractions or unused indirections.**

- **Do not invent premature abstractions**: No generic wrapper layers, unused config flags, speculative flexibility, or helper utilities for single-use code.
- **Simplicity ≠ Architecture Abandonment**: Never bypass established architectural boundaries in the name of simplicity.
  - **Ports (`/lib/ports`)**: Abstract interfaces defining application contracts.
  - **Adapters (`/lib/adapters`)**: Concrete infrastructure implementations (Supabase, Upstash, external APIs).
  - **Use Cases / Application Services (`/lib/usecases`)**: Pure business workflow orchestrators.
  - **Domain Services (`/services`, `worker/src/services`)**: Core domain logic and LLM cascades.
  - **Route Handlers (`app/api/**/route.ts`)**: Ultra-thin HTTP/SSE request dispatchers with early-return guard patterns.
- If 50 lines of clean, well-bounded code can solve the problem, do not write 200 lines.

### 3. Surgical Diffs
**Touch ONLY what is strictly required to solve the task. Clean up only your own changes.**

- Zero drive-by formatting, unsolicited cleanup of adjacent code, or cosmetic refactoring.
- Match existing repository patterns and conventions exactly.
- Keep diffs isolated to minimal LOC to prevent merge conflicts across concurrent agent checkouts.
- Do not modify contracts or exports without updating all dependent call sites and verifying type safety.

### 4. Goal-Driven Verification
**Define empirical pass criteria. Loop until verified; never stop at "it looks right".**

- Establish objective, measurable success criteria before applying mutations.
- Execute negative-control checks where applicable (confirm reproduction of bug before applying fix).
- Run the required verification gate stack:
  - Strict TypeScript type-check: `pnpm --filter @hex-yt-intel/web type-check`
  - ESLint verification: `pnpm --filter @hex-yt-intel/web lint`
  - Vitest unit test suite: `pnpm --filter @hex-yt-intel/web exec vitest run`
  - Quality Intelligence Engine: `qa-intel:baseline` / `qa-intel --ci --compare`
- Ensure a zero exit status code across all gates before closing out tasks in `.memory/AGENT_LEDGER.md`.
