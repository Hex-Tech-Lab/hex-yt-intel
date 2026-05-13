# Supabase Setup Guide

This document describes how to set up Supabase for hex-yt-intel development and production.

## Prerequisites

- Supabase account (free or paid): https://supabase.com
- `supabase-cli` installed: `npm install -g supabase`
- PostgreSQL 15+ (for local development)

## Development Setup

### 1. Create Supabase Project

Via Supabase Dashboard (https://supabase.com/dashboard):
1. Click "New Project"
2. Name: `hex-yt-intel`
3. Password: Generate strong password
4. Region: Choose closest to your location (e.g., us-east-1)
5. Create

### 2. Enable pgvector Extension

In Supabase Dashboard:
1. Navigate to Extensions (SQL Editor → Extensions)
2. Search for "vector"
3. Click Install on `pgvector`

### 3. Get Credentials

In Supabase Project Settings → API:
- Copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- Copy **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Copy **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

### 4. Create .env.local

```bash
cp web/.env.local.example web/.env.local
# Edit web/.env.local and paste Supabase credentials
```

### 5. Apply Database Migrations

```bash
cd /path/to/hex-yt-intel

# Login to Supabase CLI
supabase login

# Link to your project
supabase link --project-ref xxxxx

# Push migrations to Supabase
supabase db push

# Verify migration
supabase db execute "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"
```

Expected output:
```
users
analyses
usage_logs
stripe_events
```

### 6. Verify Extensions

```bash
supabase db execute "SELECT * FROM pg_available_extensions WHERE name = 'vector';"
```

Expected output: `vector` extension available

### 7. Verify RLS

```bash
supabase db execute "SELECT tablename FROM information_schema.role_table_grants WHERE table_schema='public';"
```

## Production Setup

### 1. Create Production Project

On Supabase:
1. Create new project: `hex-yt-intel-prod`
2. Enable pgvector extension
3. Get credentials

### 2. Deploy Migrations

Same as development:
```bash
supabase link --project-ref xxxxx-prod
supabase db push
```

### 3. Configure Auth Providers

In Supabase Dashboard → Authentication → Providers:

**Google OAuth**:
1. Google Cloud Console: Create OAuth 2.0 credentials (Web application)
2. Authorized redirect URIs: `https://xxxxx.supabase.co/auth/v1/callback`
3. Copy Client ID and Secret → Supabase Google provider

**GitHub OAuth**:
1. GitHub Settings → Developer settings → OAuth Apps → New OAuth App
2. Authorization callback URL: `https://xxxxx.supabase.co/auth/v1/callback`
3. Copy Client ID and Secret → Supabase GitHub provider

### 4. Enable Email Auth

Supabase → Authentication → Email:
- Enable Email/Password auth
- Disable "Confirm email" for development

### 5. Configure CORS

Supabase Dashboard → Project Settings → API → CORS:
```
http://localhost:3000
http://localhost:3001
https://xxxxx.vercel.app
```

## Verification Checklist

- [ ] pgvector extension installed
- [ ] 4 tables created (users, analyses, usage_logs, stripe_events)
- [ ] RLS policies active (SELECT, INSERT, UPDATE, DELETE)
- [ ] Indexes created (pgvector, user_id, created_at)
- [ ] Triggers configured (cleanup, updated_at)
- [ ] Auth providers configured (Google, GitHub)
- [ ] CORS configured for all environments

## Local Development Commands

```bash
# List tables
supabase db list-tables

# Execute SQL
supabase db execute "SELECT * FROM users;"

# Push migrations
supabase db push

# Pull remote changes
supabase db pull

# Reset local database
supabase db reset

# View logs
supabase functions logs
```

## Troubleshooting

### pgvector not available
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### RLS blocking inserts
Check RLS policies in Supabase Dashboard → Authentication → Policies

### Connection errors
Verify:
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`
- Supabase project is not paused (free tier auto-pauses after 1 week of inactivity)

## References

- Supabase Docs: https://supabase.com/docs
- pgvector: https://github.com/pgvector/pgvector
- RLS: https://supabase.com/docs/guides/auth/row-level-security
