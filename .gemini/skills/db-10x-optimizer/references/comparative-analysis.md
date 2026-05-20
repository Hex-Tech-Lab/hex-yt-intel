# Code-to-Schema Comparative Analysis Guide

Performing a 10x audit requires looking through two lenses: the static database schema and the dynamic application code.

## 1. Context Ingestion Strategy

### Ingesting Schema
- Use `supabase list_tables --verbose` to get column details, primary keys, and foreign keys.
- Read `supabase/migrations/*.sql` to see the historical intent and current structure.
- If live access is limited, rely on the most recent migration files.

### Ingesting Codebase Interactions
- **Grep for SQL/Queries**: Search for `.from(`, `supabase.from(`, `SELECT`, `INSERT`, `UPDATE`, `DELETE`.
- **Map Data Models**: Locate TypeScript interfaces (e.g., `interface Analysis`, `UserSchema`) in `lib/types`, `lib/schemas`, or `store/`.
- **Analyze Route Logic**: Examine API route handlers (e.g., `app/api/**/*.ts`) to see which columns are actually being read or written.

## 2. Identifying Mismatches

| Type | What to Look For | Example |
|---|---|---|
| **Missing Columns** | Code attempts to write to a field that doesn't exist in SQL. | `insert({ model_used: 'claude-3' })` but column is missing. |
| **Naming Collisions** | Code uses one name, SQL uses another. | Code uses `markdown`, SQL uses `analysis_markdown`. |
| **Type Incompatibility** | Code treats a field as one type, SQL stores as another. | Code expects `number` for duration, SQL uses `text`. |
| **Integrity Risks** | Code assumes a field is NOT NULL, but SQL allows NULL. | Code reads `user.email` without checking for undefined. |

## 3. Performance Pattern Detection

- **The N+1 Scan**: Identify code that loops over an array and executes a `.single()` query for each item.
- **The Sequential Scan**: Identify queries filtered by non-indexed columns (e.g., `.eq('status', 'active')` where status has no index).
- **The Cache Missing Link**: Identify frequent composite queries (e.g., `video_id` + `user_id`) that lack a composite index.

## 4. Security Voids

- **RLS Bypasses**: Check if `SUPABASE_SERVICE_ROLE_KEY` is used in client-side code (Critical security risk).
- **Unauthorized Reads**: Check if sensitive fields (e.g., `hashed_password`, `internal_notes`) are leaked in `SELECT *` queries.
- **Missing Cascades**: Check for potential orphaned data when a user or parent record is deleted.
