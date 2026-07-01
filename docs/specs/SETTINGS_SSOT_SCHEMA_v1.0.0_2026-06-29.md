---
**Filename**: SETTINGS_SSOT_SCHEMA_v1.0.0_2026-06-29.md  
**Location**: `/docs/specs/`  
**Version**: 1.0.0  
**Build**: Schema (post-live, informational)  
**Timestamp**: 2026-06-29T00:00:00Z  
**Purpose**: Single-source-of-truth specification for all admin and user configuration constants

---

# SETTINGS & SINGLE-SOURCE-OF-TRUTH (SSOT) SCHEMA
**Version**: 1.0.0 · **Date**: 2026-06-29 · **Status**: SPEC (schema only — page is post-live)
**Principle**: Every value that *could* vary is defined **once**, in one typed source, and every engine/function/route reads it from that source. No magic number written 2/3/n times. Framed as an **admin settings model** (settings for *us*, not the user) + a **user settings model**, both governed by a **security matrix**.

> Why this exists: multi-point-of-truth differential is the root of repeated troubleshooting loops (e.g. `TOTAL_STREAMS=5` in code vs `chunk_index` up to 11 in live data; qa-intel matching a literal `'${TOTAL_DIMENSIONS}'`). One source kills that class of bug.

---

## 0. WHAT ALREADY EXISTS (partial SSOT — build on it, don't reinvent)

| Existing SSOT element | Location | Consumers (good) |
|---|---|---|
| `TOTAL_STREAMS`, `TOTAL_DIMENSIONS`, `STREAM_BUNDLES`, `DIMENSION_CONFIGS`, `ABORT_ON_PARTIAL_FAILURE` | `web/lib/config/synthesis.ts` | persist route, `useSSEStream`, `PromptBuilder`, stream-status-tracker, stream-delta-handler |
| Model cascade / prompt config (admin-tunable, DB-backed) | `app_settings` table + `web/lib/adapters/SettingsModelAdapter.ts` (60s cache) | bouncer / cascade |
| Admin identity | `ADMIN_EMAIL` env + `PostgresBillingAdapter.isValidAdminEmail` | traffic guard |

**The foundation is real.** Gaps = (a) scattered magic numbers NOT yet centralized, (b) worker reaches `../../../web/lib/config/synthesis` by relative path (cross-package coupling), (c) no formal admin/user settings *schema* or security matrix, (d) qa-intel duplicates the dimension count as a literal string.

---

## 1. THREE-LAYER SSOT MODEL

```
Layer 0 — COMPILE-TIME CONSTANTS (immutable per deploy)
  └ web/lib/config/*.ts  (synthesis.ts + NEW timeouts.ts, limits.ts, cache.ts)
        ↑ single import surface: @/lib/config
Layer 1 — ADMIN SETTINGS (runtime-tunable by us, DB-backed)
  └ app_settings table  ←read→ SettingsModelAdapter (extend to a generic SettingsAdapter)
Layer 2 — USER SETTINGS (per-user prefs/toggles)
  └ NEW user_settings table (RLS: owner-only)  ←read→ SettingsUserAdapter
```
Resolution order at read time: **Layer 2 (user) overrides Layer 1 (admin) overrides Layer 0 (default)** — but only for keys the security matrix marks as user-overridable.

---

## 2. CONSTANT CATALOG — migrate scattered literals into Layer 0

| Value | Current location(s) (magic) | Target SSOT home | Notes |
|---|---|---|---|
| Streams = 5 | `synthesis.ts` ✅ | keep | already SSOT |
| Dimensions = 11 | `synthesis.ts` ✅ | keep | qa-intel must import, not literal-string it |
| Vercel `maxDuration` 30 / 60 | chat:3, persist:3, analyses:6, chat/persist:3, messages:3 | `config/limits.ts` `EDGE_MAX_DURATION` | 5 routes — unify |
| LLM total timeout `120000` ×2 | `LLMCascade.ts:84,145` | `config/timeouts.ts` `LLM_STREAM_TIMEOUT_MS` | also unreachable vs ~58s CF budget → set 50000 |
| LLM handshake `15000` | `LLMCascade.ts:150` | `config/timeouts.ts` `LLM_HANDSHAKE_MS` | doc says 3s — reconcile |
| Chat cascade `50000` | `chat-stream.ts:141` | `config/timeouts.ts` `CHAT_STREAM_TIMEOUT_MS` | |
| Persist S2S `10000` | `PersistService.ts` | `config/timeouts.ts` `PERSIST_ATTEMPT_MS` | |
| `MAX_EDGE_PAYLOAD_BYTES = 100_000` | `analyses/[id]/route.ts:9` | `config/limits.ts` `MAX_EDGE_PAYLOAD_BYTES` | also the markdown reconstruction cap |
| Rate-limit TTL `90` | `RedisTrafficAdapter.ts:114` | `config/cache.ts` `RATE_LIMIT_TTL_S` | |
| Cache TTL `604800` / `7*24*60*60` | `UpstashCacheAdapter.ts:13`, relations route:12 | `config/cache.ts` `ANALYSIS_CACHE_TTL_S` | two copies of "7 days" |
| Settings cache TTL `60_000` | `SettingsModelAdapter.ts:21` | `config/cache.ts` `SETTINGS_CACHE_TTL_MS` | |
| Stream token TTL `120` | `stream-token.ts` | `config/timeouts.ts` `STREAM_TOKEN_TTL_S` | |
| Refusal window `20..400` | `LLMCascade.ts:233` | `config/llm.ts` `REFUSAL_MIN/MAX` | |
| Chunk grace `30000` | persist route | `config/timeouts.ts` `CHUNK_GRACE_MS` | reaper-related |
| Reaper staleness `5min` (proposed) | (new) | `config/timeouts.ts` `REAPER_STALE_MS` | |
| qa-intel `MAX_DEPTH = 15` | `architecture.ts:126` | `config/qa-intel.ts` | engine-local SSOT |

**Rule:** after migration, `grep` for each literal must return exactly **one** definition. Add a qa-intel rule "magic-number-outside-config" to enforce going forward.

---

## 3. SETTINGS SCHEMA (Layer 1 + 2) — typed shape

```ts
// web/lib/config/settings.schema.ts  (Zod — single source for both DB rows and API)
export const SettingScope = z.enum(['admin', 'user']);
export const SettingKey = z.enum([
  // admin (Layer 1)
  'model.cascade', 'model.refusalWindow', 'limits.maxEdgePayloadBytes',
  'limits.userMonthlyQuota', 'features.knowledgeGraph', 'features.chat',
  'timeouts.llmStreamMs', 'streams.total', 'dimensions.total',
  // user (Layer 2)
  'ui.theme', 'ui.density', 'ui.reducedMotion',
  'features.chatEnabled', 'features.autoAnalyze',
]);
export const SettingRow = z.object({
  key: SettingKey, scope: SettingScope,
  value: z.unknown(),                 // validated per-key by a value-schema map
  updated_by: z.string().uuid().nullable(),
  updated_at: z.string(),
});
```
- `app_settings` (exists) serves Layer 1; add `user_settings(user_id, key, value, updated_at)` with **RLS owner-only** for Layer 2.
- A `SETTING_VALUE_SCHEMAS: Record<SettingKey, ZodType>` map validates each value (prevents a bad admin value wedging the system).

---

## 4. SECURITY MATRIX (who may read / write each key)

| Key class | anon | authenticated (owner) | service_role / admin | RLS / enforcement |
|---|---|---|---|---|
| Layer 0 constants | read (compiled in) | read | n/a (deploy-time) | none — immutable |
| `model.*`, `timeouts.*`, `limits.*`, `streams.*`, `dimensions.*` (admin) | ✗ | ✗ | read+write | `app_settings` RLS-locked → service_role only (already correct) |
| `features.*` (admin gate) | ✗ | read (resolved) | read+write | admin writes; users read resolved flag |
| `ui.*`, user `features.*` | ✗ | read+write **own** | read | `user_settings` RLS `user_id = (select auth.uid())` |

**Tie-in to the security work:** this matrix is the same authority model as the DB hardening cluster (e.g. `reserve_analysis_quota` must be service_role-only) — the settings security matrix and the RLS/grants audit are one governance surface, not two.

---

## 5. IMPLEMENTATION DISCIPLINE (DDD-light + hexagonal-light, end-to-end)

- **Port**: `SettingsPort { getAdmin(key), getUser(userId,key), resolve(userId,key) }`.
- **Adapters**: extend `SettingsModelAdapter` → generic `SupabaseSettingsAdapter` (admin) + `SupabaseUserSettingsAdapter` (user). No business logic in adapters.
- **Use case**: `ResolveSettingUseCase` applies Layer 2→1→0 precedence + security-matrix check.
- **End-to-end rule**: when a constant moves into the SSOT, **every** consumer import is updated in the same change (port → adapter → use case → route/hook/worker), nothing left reading the old literal. The worker's `../../../web/lib/config` relative reach should become a shared package import or a generated copy at build (decouple the cross-package path).

---

## 6. SCOPE GUARDRAIL (per founder direction)
This is **not** new feature work or scope-slide. It is **debt-prevention**: collapsing multi-point-of-truth so a value changes in one place and propagates. Build the **schema + Layer-0 consolidation now** (low risk, mechanical); `user_settings` table + settings *page* are post-live. If any item here reads as scope-creep rather than truth-consolidation, flag it and it drops.
