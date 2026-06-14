# 10X AUDIT MASTER CHECKLIST — 2026-06-14

## CRITICAL & HIGH SEVERITY

| ID | Issue | Affected Components | Status | Delta & Side Effects |
|----|-------|---------------------|--------|----------------------|
| **C1** | `analysis_markdown NOT NULL` crash | `SupabasePersistenceAdapter.ts` | ✅ | Fixed with empty string stub. |
| **C2** | `persistAnalysis()` unimplemented | `SupabasePersistenceAdapter.ts` | ✅ | Full S2S implementation completed. |
| **C3** | BracketBuffer shape mismatch | `BracketBuffer.ts` | ✅ | Dual-track parser implemented. |
| **NEW-C1**| Quota Auth Bypass | Supabase Migrations | ✅ | `auth.uid()` check added to SQL functions. |
| **C4** | Worker 90s timeout vs 58s ADR | `LLMCascade.ts` | ✅ | Explained: Browser-to-Worker bypasses Vercel. |
| **H1** | Missing composite index | Database | ✅ | `idx_analyses_user_created` added. |
| **H2** | Missing `users.id` FK | Database | ✅ | Foreign key added (NOT VALID). |
| **H5** | `usage_logs` unbounded growth | Database | ✅ | Daily purge via `pg_cron` implemented. |
| **H6** | Version drift | Monorepo | ✅ | Aligned at 1.6.0. |
| **N14**| Haiku-only cascade (SPOF) | `cascade.ts` | ✅ | Centralized config with fallback route. |
| **N15**| Single-model SPOF | `cascade.ts` | ✅ | Added Sonnet 4.6 as emergency fallback. |
| **N16**| Export guard fallback | `export/route.ts` | 🟡 | Added guard; check if legacy fallback is optimal. |
| **N17**| Missing Dimensions in Reconstructor | `MarkdownReconstructor.ts` | ✅ | Added researcher/PM fields. |

## MEDIUM & LOW SEVERITY

| ID | Issue | Affected Components | Status | Delta & Side Effects |
|----|-------|---------------------|--------|----------------------|
| **M1** | Monolithic `env.ts` | `web/lib/env.ts` | ❌ | Still 386 LOC; needs decomposition. |
| **M2** | Lack of UseCase layer | `route.ts` | ✅ | `CreateAnalysisUseCase` implemented. |
| **M3** | Dead Rate-Limiter code | `traffic.ts` | ❌ | `checkRateLimit` still present. |
| **M4** | Empty 0-byte stubs | `auth.ts`, `graphql-client.ts` | ❌ | Files still exist. |
| **M5** | Worker body size limits | Worker endpoints | ❌ | Validation not enforced. |
| **M6** | `/chat-stream` audit | `chat-stream.ts` | ✅ | Audited June 12; HMAC verified. |
| **L2** | Snyk scans stale | Monorepo | ✅ | Resolved via package upgrades (June 10). |
| **L4** | Fragmented prompts | Monorepo | 🟡 | Centralization started in `cascade.ts`. |
| **N18**| Dynamic import in GET | `route.ts` | 🔴 | Still using `await import()` for Supabase. |
| **N19**| broad tracing includes | `next.config.ts` | 🔴 | Potentially bloating bundle. |

## NEW FINDINGS (FROM RECENT WORK)

| ID | Issue | Affected Components | Status | Delta & Side Effects |
|----|-------|---------------------|--------|----------------------|
| **NEW-1**| 11-stream parallel complexity | `ReasoningEngine.ts` | 🆕 | Increased state management overhead. |
| **NEW-2**| Atlas Renaming consistency | UI / Docs | 🆕 | Potential stale Wiki references. |
| **NEW-3**| QStash Cron reliability | Infrastructure | 🆕 | Dependency on external scheduler for KG. |
| **NEW-4**| KG Synthesis persist leak | `SupabasePersistenceAdapter`| 🆕 | Verify no duplicate entity insertion. |

