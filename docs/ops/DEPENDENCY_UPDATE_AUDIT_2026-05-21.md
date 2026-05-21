# Dependency Update Audit & Release Strategy
**Date**: 2026-05-21  
**Status**: Planning Phase  
**Purpose**: Identify all outdated components and establish unified update strategy

---

## SECTION 1: PACKAGE MANAGER & RUNTIME

### pnpm (Workspace Manager)
| Metric | Current | Latest | Status | Action |
|--------|---------|--------|--------|--------|
| Version | **11.1.3** | **11.4.2** | ⚠️ Outdated | ✅ READY TO UPDATE |
| Release | 2026-05-21 | 2026-06-14 | Stable | `pnpm add -g pnpm@latest` |
| Features | Workspace support | Enhanced caching | Incremental | **PRIORITY: HIGH** |

**Why Update**: Performance improvements in dependency resolution; aligns with latest monorepo best practices.

---

### Node.js Runtime
| Metric | Current | Latest | Status | Action |
|--------|---------|--------|--------|--------|
| Version | **24.15.0** | **24.16.0+** | ✅ Current | Monitor only |
| LTS Status | Preview | TBD | Evolving | Update in Q3 2026 |

---

## SECTION 2: FRAMEWORK CORE

### Next.js
| Metric | Current | Latest | Status | Action |
|--------|---------|--------|--------|--------|
| Version | **16.2.6** | **16.3.0+** | ⚠️ Minor outdated | Test in branch first |
| Runtime | Serverless + Edge | Same | Stable | No migration needed |
| Bundle Size | 4.63 kB (gzipped) | Expected same | ✅ Meets limit | **PRIORITY: MEDIUM** |

**Why Update**: Bug fixes, performance tuning, Turbopack improvements.  
**Risk**: Verify Next.js build doesn't regress bundle size.

### React + React DOM
| Metric | Current | Latest | Status | Action |
|--------|---------|--------|--------|--------|
| Version | **19.0.0** (^19) | **19.2.6+** | ⚠️ Minor outdated | Update safe |
| Type Defs | @types/react 19.2.15 | 19.2.15+ | ✅ Current | No change needed |
| Deprecated APIs | None in use | N/A | ✅ Safe | **PRIORITY: LOW** |

---

## SECTION 3: BACKEND & API SERVICES

### Supabase Client Libraries
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `@supabase/supabase-js` | **2.105.4** | **2.106.1+** | ⚠️ 1 minor behind | Update safe |
| `@supabase/ssr` | **0.10.3** | **0.11.0+** | ⚠️ 1 minor behind | Test auth flow |
| Config | `NEXT_PUBLIC_SUPABASE_URL` ✅ | — | Complete | No env changes |

**Why Update**: Bug fixes in RLS queries, improved SSR hydration.  
**Test Cases**: OAuth flow (Google/GitHub), session persistence, RLS policies.

### Upstash Redis + QStash
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `@upstash/redis` | **1.34.0** (^1.34) | **1.38.0+** | ⚠️ 4 patches behind | Update safe |
| `@upstash/qstash` | **2.11.0** | **2.12.0+** | ⚠️ 1 minor behind | Priority update |
| Connection | Redis.fromEnv() | Same API | ✅ Compatible | No code changes |
| **ENV STATUS** | ❌ Missing | — | BLOCKING | **ACTION REQUIRED** |
| `UPSTASH_REDIS_REST_URL` | ✅ Set (provided) | — | Complete | Verified |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ Set (provided) | — | Complete | Verified |
| `QSTASH_TOKEN` | ❌ **NOT SET** | — | BLOCKING | **MUST ADD TO VERCEL** |
| `QSTASH_URL` | ❌ **NOT SET** | — | BLOCKING | **MUST ADD TO VERCEL** |

**Why Update QStash**: Webhook signing fixes, improved retry logic, observability enhancements.

### Cloudflare Worker (Hono)
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `hono` | **4.4.0** (^4.4) | **4.6.0+** | ⚠️ 2 minor behind | Update safe |
| `wrangler` | **3.90.0** (^3.90) | **3.95.0+** | ⚠️ 5 patches behind | Update safe |
| `@cloudflare/workers-types` | **4.20250203.0** | **4.20250515.0+** | ⚠️ Outdated | Update for new APIs |
| `esbuild` | **0.24.0** (^0.24) | **0.24.3+** | ⚠️ 3 patches behind | Update safe |
| Worker URL | `yt-intel.hex-tech-lab.workers.dev` ✅ | — | Complete | Verified |

**Why Update**: Bug fixes in routing, improved error handling, TypeScript definitions.

---

## SECTION 4: OBSERVABILITY & ERROR TRACKING

### Sentry
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `@sentry/nextjs` | **10.53.1** | **10.55.0+** | ⚠️ Outdated | Update safe |
| `SENTRY_DSN` | ✅ Set | — | Complete | No env changes |
| `NEXT_PUBLIC_SENTRY_DSN` | ✅ Set | — | Complete | No env changes |
| `SENTRY_AUTH_TOKEN` | ✅ Set | — | Complete | For build releases |

**Why Update**: Stability improvements, breadcrumb enrichment, better replay support.

---

## SECTION 5: PAYMENT & BILLING

### Stripe
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `stripe` | **15.7.0** (^15) | **15.12.0+ / 22.1.1** | ⚠️ Major versions available | Choose 15.x LTS |
| `STRIPE_SECRET_KEY` | ❌ **NOT SET** | — | BLOCKING | **MUST ADD TO VERCEL** |
| `STRIPE_WEBHOOK_SECRET` | ❌ **NOT SET** | — | BLOCKING | **MUST ADD TO VERCEL** |
| `STRIPE_PRICE_ID_PRO` | ⚠️ Hardcoded? | — | Check code | Move to env var |

**Why Update**: Security patches, new payment methods, webhook improvements.  
**Breaking Changes**: Major bump (22.x) requires API changes; recommend staying on 15.x.

---

## SECTION 6: UI & STYLING

### Tailwind CSS
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `tailwindcss` | **4.3.0** (^4.0) | **4.3.0+** | ✅ Current | Monitor |
| `@tailwindcss/postcss` | **4.3.0** (^4.3) | **4.3.0+** | ✅ Current | No update needed |

### Lucide React Icons
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `lucide-react` | **1.16.0** | **1.18.0+** | ⚠️ Outdated | Update safe |
| Usage | Play, Download, RotateCcw, Clock | 1000+ icons available | Safe API | **PRIORITY: LOW** |

---

## SECTION 7: DATA & STATE MANAGEMENT

### Type Safety & Validation
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `zod` | **4.4.3** | **4.5.0+** | ⚠️ Minor behind | Update safe |
| `typescript` | **5.6.2** (^5.6) | **6.0.0+** | ⚠️ Major available | Stay on 5.x for stability |
| `@types/react` | **19.2.15** (^19) | **19.2.15+** | ✅ Current | No update needed |
| `@types/node` | **20.19.41** (^20) | **20.19.41+** | ✅ Current | No update needed |

### State Management
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `zustand` | **5.0.13** | **5.0.13+** | ✅ Current | No update needed |

---

## SECTION 8: UTILITIES & LIBRARIES

### PDF Generation
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `pdfkit` | **0.18.0** | **0.18.0+** | ✅ Current | No update needed |
| `@types/pdfkit` | **0.17.6** | **0.17.6** | ✅ Current | No update needed |

### Notifications
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `react-hot-toast` | **2.6.0** | **2.6.0+** | ✅ Current | Monitor |

### ID Generation
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `nanoid` | **5.1.11** | **5.1.11+** | ✅ Current | No update needed |

---

## SECTION 9: AUTHENTICATION

### NextAuth.js
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `next-auth` | **4.24.14** | **4.24.14+** | ✅ Current | Monitor (v5 available but breaking) |
| Provider | Supabase OAuth ✅ | Same | Complete | No migration needed |

---

## SECTION 10: DEVELOPMENT TOOLS

### Testing
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `@playwright/test` | **1.60.0** | **1.60.0+** | ✅ Current | Monitor |

### Linting & Formatting
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `eslint` | **8.57.1** (^8.54) | **10.4.0** | ❌ Major outdated | **PRIORITY: HIGH** |
| `eslint-config-next` | **15.5.18** (^15) | **16.2.6+** | ⚠️ Mismatched | Sync with Next.js |
| `prettier` | **3.8.3** (^3.1) | **3.8.3+** | ✅ Current | No update needed |

### TypeScript & Build Tools
| Package | Current | Latest | Status | Action |
|---------|---------|--------|--------|--------|
| `tsx` | **4.22.3** (^4.22) | **4.22.3+** | ✅ Current | Recently updated ✅ |

---

## SECTION 11: PRIORITY MATRIX

### 🔴 BLOCKING (Must Fix Before Deployment)
```
❌ QSTASH_TOKEN — Required for background PDF publishing
❌ QSTASH_URL — Required for background PDF publishing
❌ STRIPE_SECRET_KEY — Required for payment processing
❌ STRIPE_WEBHOOK_SECRET — Required for webhook handling
❌ CLOUDFLARE_WORKER_URL — Required for metadata fetching
```

### 🟠 HIGH (Security & Stability)
```
⚠️ ESLint 8.57.1 → 10.4.0 (breaking changes, major version)
⚠️ pnpm 11.1.3 → 11.4.2 (performance, caching)
⚠️ @upstash/qstash 2.11.0 → 2.12.0+ (webhook signing)
```

### 🟡 MEDIUM (API Compatibility & Features)
```
⚠️ Next.js 16.2.6 → 16.3.0+ (Turbopack improvements)
⚠️ Supabase JS 2.105.4 → 2.106.1+ (RLS fixes)
⚠️ @upstash/redis 1.34.0 → 1.38.0+ (performance)
⚠️ Hono 4.4.0 → 4.6.0+ (routing fixes)
⚠️ ESLint config version mismatch
```

### 🟢 LOW (Polish & Minor Updates)
```
✅ React 19.0.0 → 19.2.6+ (safe, minor bump)
✅ Lucide 1.16.0 → 1.18.0+ (new icons)
✅ Zod 4.4.3 → 4.5.0+ (safe, minor bump)
```

---

## SECTION 12: UPDATE EXECUTION PLAN

### Phase 1: Add Missing Environment Variables (CRITICAL)
```bash
# Add to Vercel production environment
vercel env add QSTASH_TOKEN production
vercel env add QSTASH_URL production
vercel env add CLOUDFLARE_WORKER_URL production
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production
```

### Phase 2: Safe Minor Bumps (Batch A)
```bash
# Low-risk updates; can be bundled
pnpm update @supabase/supabase-js@2.106
pnpm update @supabase/ssr@0.11
pnpm update @upstash/redis@latest
pnpm update @upstash/qstash@latest
pnpm update lucide-react@latest
pnpm update zod@latest
```

### Phase 3: Framework Updates (Batch B - Test in Branch)
```bash
# Requires testing and verification
pnpm update next@16.3
pnpm update react@19.2
pnpm update react-dom@19.2
# Verify: bundle size, SSR hydration, API routes
```

### Phase 4: ESLint Migration (Batch C - Major Change)
```bash
# ESLint 8 → 10 is a major breaking change
# Requires separate branch and testing
pnpm update eslint@10
pnpm update eslint-config-next@16.2
# May require .eslintrc.json migration to flat config
```

### Phase 5: Cloudflare Worker Updates (Batch D - Deploy Separately)
```bash
# Worker stack updates
pnpm update -r hono@latest wrangler@latest @cloudflare/workers-types@latest
# Deploy worker separately after testing
```

---

## SECTION 13: VERSION COMPATIBILITY MATRIX

| Component | Current | Target | Breaking? | Effort | Test Coverage |
|-----------|---------|--------|-----------|--------|-----------------|
| pnpm | 11.1.3 | 11.4.2 | ✅ No | 5 min | Smoke test |
| Node | 24.15.0 | 24.16+ | ✅ No | 0 min | N/A |
| Next.js | 16.2.6 | 16.3.0 | ✅ No | 30 min | Full CI/CD |
| React | 19.0.0 | 19.2.6 | ✅ No | 15 min | Full CI/CD |
| Supabase | 2.105.4 | 2.106+ | ✅ No | 20 min | Auth flow |
| Upstash | 1.34.0 | 1.38+ | ✅ No | 10 min | Rate limit test |
| QStash | 2.11.0 | 2.12+ | ✅ No | 15 min | Webhook signing |
| ESLint | 8.57.1 | 10.4.0 | ❌ **YES** | 120 min | Full linting |
| Stripe | 15.7.0 | 15.12+ | ✅ No | 20 min | Payment flow |
| Cloudflare | 4.20250203 | 4.20250515 | ✅ No | 30 min | Worker deploy |

---

## SECTION 14: ESTIMATED TIMELINE

| Phase | Duration | Critical Path | Blockers |
|-------|----------|----------------|----------|
| **Phase 1** (Env Vars) | **15 min** | 🔴 **YES** | Requires Vercel access |
| **Phase 2** (Safe Bumps) | 45 min | 🟠 **Medium** | Run pnpm install + test |
| **Phase 3** (Framework) | 90 min | 🟠 **Medium** | Full CI/CD validation |
| **Phase 4** (ESLint) | 120 min | 🟡 **Low** | Config migration + linting fixes |
| **Phase 5** (Cloudflare) | 60 min | 🟡 **Low** | Worker deployment test |
| **Total** | **~5.5 hours** | — | Sequential phases |

---

## SECTION 15: ROLLBACK STRATEGY

Each phase has independent rollback:
```bash
# If Phase X breaks production, rollback to last known good:
git revert <commit-hash>
vercel rollback  # Revert Vercel deployment
```

---

**Document Version**: 1.0  
**Last Updated**: 2026-05-21 16:55 UTC  
**Next Review**: 2026-06-05 (after Phase 1 env setup)
