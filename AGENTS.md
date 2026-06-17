# hex-yt-intel: Agent Reference (v1.8.0)

**Monorepo**: pnpm workspace | **Node**: 24.16.0 | **TS**: 6.0.3 strict | **ESM**

---

## 1. BUILD / LINT / TEST COMMANDS

All commands run from repo root via `pnpm --filter`:

| Task | Command |
|---|---|
| Dev (web) | `pnpm --filter @hex-yt-intel/web dev` |
| Dev (worker) | `pnpm --filter youtube-intelligence-worker dev` |
| Build (web) | `pnpm --filter @hex-yt-intel/web build` |
| Build (worker) | `pnpm --filter youtube-intelligence-worker build` |
| Type-check (web) | `pnpm --filter @hex-yt-intel/web type-check` |
| Lint (web) | `pnpm --filter @hex-yt-intel/web lint` |
| Format (web) | `pnpm --filter @hex-yt-intel/web format` |
| All Playwright tests | `pnpm --filter @hex-yt-intel/web test` |
| **Single Playwright test** | `pnpm --filter @hex-yt-intel/web exec playwright test tests/production-verification.spec.ts` |
| **Single Playwright by name** | `pnpm --filter @hex-yt-intel/web exec playwright test -g "test name"` |
| Single vitest file | `pnpm --filter @hex-yt-intel/web exec vitest run lib/__tests__/rate-limit-sliding-window.test.ts` |
| Preflight | `pnpm --filter @hex-yt-intel/web preflight` |

> Pre-commit: run `type-check` + `lint` + `test` (Playwright requires `pnpm dev` running or `DEPLOYMENT_URL` set).

---

## 2. CODE STYLE GUIDELINES

### Imports (order — grouped with blank lines)
1. Framework / lib (`react`, `next/server`, Zustand, `@sentry/nextjs`)
2. Third-party (`zod`, `@supabase/ssr`, `d3`)
3. Internal `@/` aliases (`@/lib/ports`, `@/store/`, `@/hooks/`)
4. Types: `import type { ... }` separate from value imports
- Named exports only. No `export default` for components or functions.
- Barrel files: `@/lib/ports` re-exports all ports (`export * from './AuthPort'`).

### Naming
- **Components**: PascalCase, function declarations (`export function VideoCard(...)`)
- **Hooks**: camelCase with `use` prefix (`useSSEStream`, `useAnalysisStore`)
- **Zustand stores**: camelCase with `use` prefix + `Store` suffix
- **Ports/Adapters**: PascalCase + `Port`/`Adapter` suffix (`AuthPort`, `SupabaseAuthAdapter`)
- **UseCases**: PascalCase + `UseCase` suffix (`CreateAnalysisUseCase`)
- **Zod schemas**: PascalCase + `Schema` suffix (`AnalysisCreateSchema`)
- **Files**: PascalCase for components, kebab-case for utilities
- **Constants**: `UPPER_SNAKE_CASE`

### Types & Interfaces
- `interface` for public contracts; `type` for unions/utility types
- Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noImplicitReturns`
- `@/*` path aliases — never use relative imports for cross-directory references
- Prefer Zod `safeParse` at API boundaries over ad-hoc validation

### Error Handling
- Universal catch pattern: `error instanceof Error ? error.message : String(error)`
- Use case returns discriminated union: `{ type: 'cache_hit' | 'processing' | 'error', ... }`
- API routes use early-return guard pattern: `if (!identity) return NextResponse.json(..., { status: 401 })`
- Sentry: `Sentry.captureException(error, { contexts: { ... } })` in every catch block
- Settlement guard: `hasSettled` boolean to prevent double-settlement in streaming code
- Log with structured tags: `console.error('[analyses]', { message, url })`

### File Structure
```
web/
  app/api/<name>/route.ts    — Next.js App Router API routes
  lib/
    ports/                    — Abstract interfaces (hexagonal ports)
    adapters/                 — Concrete implementations
    usecases/                 — Business orchestration
    services/                 — Domain services
    types/                    — Zod schemas + TS types
  store/                      — Zustand stores
  hooks/                      — React hooks
  components/                 — UI components (atomic design)
  tests/                      — Playwright E2E tests
worker/
  src/
    ports/
    services/
    worker.ts                 — Hono app entry
```

---

## 3. ARCHITECTURAL RULES (from CLAUDE.md)

- **Law #1**: Pre-query cache hit — always check `analyses` table by `video_id` + `user_id` before processing
- **Law #2**: Dual timeouts — 3s connection / 25s (Vercel) or 90s (Worker) streaming
- **Law #3**: All routes MUST stream responses to extend connection lifetime
- **Law #4**: Hybrid Edge — Vercel ~8s (auth/quota) → CF Worker ~58s (LLM) → S2S `/persist` (HMAC)
- **Frozen stack**: pnpm only, Tailwind + shadcn/ui only, Node 24.16.0 LTS

---

## 4. PR REVIEW CONFIDENCE DEGREE

Minimum gate: **Cubic + CodeRabbit + Snyk + DeepSource + CI/CD + qa-intel**
Local gates (must pass): `tsc --noEmit`, `lint`, `qa-intel`

Confidence = weighted sum of passing tools, re-normalized when tools timeout.

| Tool | Weight | Wait Limit |
|---|---|---|
| Cubic | 30 | 3 min |
| CodeRabbit | 20 | 15 min (free tier may timeout) |
| Snyk | 15 | 3 min |
| DeepSource | 15 | 5 min |
| CI/CD Pipeline | 10 | 5 min |
| Vercel | 5 | 5 min |
| CodeQL | 5 | 5 min |

**Penalties**: CodeRabbit timeout -15, FAILURE with findings -20, unaddressed P0 -100.
**Decision**: ≥85 → merge, 60-84 → human review, <60 → fix & repeat.

---

## 5. SHARED COMMUNICATION PROTOCOL

**Before starting any task**:
1. Read `.memory/AGENT_LEDGER.md` to avoid conflicting with active agents
2. Append `[IN_PROGRESS]` line with intent, target files, and timestamp
3. When done, update to `[DONE]`

**Orchestrator "Sink" pattern**: For multi-stage workflows, the lead agent logs `[SINK: Workflow Name]`. Sibling agents log sub-tasks but only the Sink merges/closes.

---

## 5. ESLint & FORMATTING

- ESLint 8.x (`web/.eslintrc.json`) — extends `next/core-web-vitals` + `@typescript-eslint/recommended`
  - `@typescript-eslint/no-unused-vars`: warn
  - `@typescript-eslint/no-explicit-any`: off
- Prettier 3.8 (no config — defaults) — run via `pnpm --filter @hex-yt-intel/web format`
- No Biome, no Prettier config file — defaults apply

---

## 6. TESTING

- **Primary**: Playwright 1.60 — `web/tests/` (E2E, Chromium only, full parallel)
- **Secondary**: Vitest 4.x — `web/lib/__tests__/` (unit tests, no dedicated config yet)
- Playwright config auto-boots `pnpm dev` locally, skips when `DEPLOYMENT_URL` is set
- Test helper: `vitest run` works via tsconfig defaults
