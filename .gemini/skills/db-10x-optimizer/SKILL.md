---
name: db-10x-optimizer
description: 10x Database Optimizer: Advanced SQL schema audit, performance tuning, and code-alignment engine. Triggers when optimizing Supabase/PostgreSQL databases, fixing data mismatches, or preparing schemas for production scale. Performs deep comparative analysis between live SQL structure and application code logic.
---

# Db 10x Optimizer

## Overview
This skill transforms Gemini CLI into a high-tier database architect. It doesn't just look at SQL; it looks at how the *application* uses SQL. By bridging the gap between data contracts in code and constraints in the database, it ensures absolute integrity, sub-100ms performance, and production-grade security.

## Core Workflow

### 1. Context Synchronization
- **Ingest Schema**: Use `supabase list_tables --verbose` or read migration files.
- **Ingest Code**: Grep for `.from(`, `supabase.from(`, and model definitions (`interface`, `ZodSchema`).
- **Map Interactions**: Identify which columns are read/written in every route.

### 2. Comparative Audit
Execute a structured audit to find mismatches:
- **Contracts**: Does the code write to fields that don't exist?
- **Naming**: Are there naming collisions (e.g., `markdown` vs `analysis_markdown`)?
- **Types**: Are timestamps properly zoned (`timestamptz`)? Are UUIDs used where appropriate?

### 3. Performance Deep-Dive
Identify and eliminate bottlenecks using [optimizations.md](references/optimizations.md):
- **Index Strategy**: Create composite indexes for high-frequency cache lookups.
- **Foreign Keys**: Ensure all foreign keys are indexed to prevent sequential scans on JOINs.
- **Vector Search**: Implement HNSW indexes for `pgvector` columns.

### 4. Safety & Integrity
- **Relational Integrity**: Enforce `ON DELETE CASCADE` to prevent orphaned data.
- **Auth Linkage**: Securely link `public.users` to `auth.users`.
- **Concurrency**: Convert manual read-then-write logic into atomic Database Functions (RPC).
- **Security**: Audit RLS policies and ensure no sensitive data leaks.

## Analysis Framework

When triggered, follow this comparative logic:
1. **Identify**: List all discrepancies between schema and code.
2. **Optimize**: Propose SQL statements (DDL) and code refactors.
3. **Plan**: Provide a step-by-step implementation guide.
4. **Execute**: Apply migrations and update code.

## Reference Materials
- [Comparative Analysis Guide](references/comparative-analysis.md): How to find mismatches.
- [Optimization Patterns](references/optimizations.md): SQL snippets for performance and safety.
