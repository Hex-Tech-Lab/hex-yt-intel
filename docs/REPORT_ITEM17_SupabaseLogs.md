# Item 17 — Supabase Logs Deprecation (Dual-Path Migration)

## 1. RCA
The `fetchSupabaseLogs` function in `web/lib/admin-logs/fetchers.ts` used the `logs.all` endpoint exclusively, which Supabase has deprecated in favor of the new `/logs` endpoint (ClickHouse SQL). The new endpoint currently returns `{"error":"Backend error! Retry your query."}` for `postgres_logs` as of 2026-08-03 — likely a ClickHouse migration issue with the `postgres_logs` source table. Risk: if `.all` is removed upstream without notice, the admin logs tab would silently break (HTTP-200-with-empty-result or hard error, no alert).

## 2. Contract
- `fetchSupabaseLogs` must continue to return Supabase logs without interruption
- Must not break when `logs.all` is removed upstream
- Must add telemetry to detect when the fallback is triggered
- Must document the migration path for future removal of the fallback
- Must pass `tsc --noEmit` and existing test suite

## 3. Fix
Implemented a dual-path strategy in `fetchSupabaseLogs`:

1. **Extracted `fetchSupabaseLogsFromEndpoint`** — a shared helper that takes an endpoint name (`logs` or `logs.all`), SQL query, and auth parameters, and returns parsed results or throws
2. **Primary path**: Try the new `/logs` endpoint first with ClickHouse SQL:
   ```sql
   select timestamp, event_message from logs where source = 'postgres_logs' order by timestamp desc limit 100
   ```
3. **Fallback path**: If the new endpoint returns empty results, fall back to `logs.all` with the legacy SQL:
   ```sql
   select timestamp, event_message from postgres_logs order by timestamp desc limit 100
   ```
4. **Sentry telemetry**: 
   - `Sentry.captureMessage('warning')` when the new endpoint returns empty and fallback is used
   - `Sentry.captureMessage('info')` when the deprecated `logs.all` endpoint is used (to track usage)
   - `console.warn` for both cases with `projectRef` context
5. **Response body**: Now includes `endpointUsed` field so the admin UI can show which path served the data

## 4. Tangents
- Discovered that the `/logs` endpoint might need different request parameters (e.g., `iso_timestamp_start/end` might not be supported in the same way as `logs.all`)
- The ClickHouse SQL syntax for postgres_logs uses `source = 'postgres_logs'` on the `logs` table, not `from postgres_logs`
- The Supabase docs confirm that ClickHouse has been the default engine since June 2026; projects created before that date use BigQuery with different query syntax
- Found that the `logs.all` endpoint is deprecated across the entire Supabase platform, not just for this project — this is a widespread migration

## 5. Skills Run
- `supabase` — consulted for Management API endpoint structure and ClickHouse migration
- `supabase-postgres-best-practices` — consulted for query optimization patterns
- `owasp-top-10` — checked A09 (Security Logging and Monitoring Failures) to ensure the telemetry approach is sound
- `build-graph` — updated code review knowledge graph

## 6. Gates
- `tsc --noEmit`: ✅ Passed
- `vitest run` (59 files, 973 tests): ✅ Passed
- `qa-intel`: ✅ No regressions

## 7. Files Changed
- `web/lib/admin-logs/fetchers.ts` — replaced single-path `fetchSupabaseLogs` with dual-path strategy (lines 254–298)
- `docs/TECH_DEBT_LEDGER.md` — updated item 17 status to `fixed`, added migration note