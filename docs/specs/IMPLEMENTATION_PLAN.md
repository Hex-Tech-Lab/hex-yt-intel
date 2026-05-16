---
Filename: $file
Location: docs/specs/$file
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:11:06 EEST
Purpose: Architectural specification document
---
Filename: IMPLEMENTATION_PLAN.md
Location: /docs/specs/
Version: v1.5.0
Build: b947767
Timestamp: Saturday, 16 May 2026 at 17:13:51 EEST (GCW)
Purpose: IMPLEMENTATION PLAN
---

# hex-yt-intel Implementation Plan
**Complete Product (MVP Includes All Core Features)**  
**Status**: Ready to execute  
**Total Chunks**: 12  
**Estimated Duration**: 4-5 weeks  

---

## VERIFICATION PROTOCOL

After EACH chunk, BEFORE moving to the next:

1. ✅ **Type Checking**: `pnpm type-check` (0 errors)
2. ✅ **Testing**: `pnpm test` (all pass, coverage >=80%)
3. ✅ **Linting**: `pnpm lint` (0 warnings)
4. ✅ **Integration**: Verify chunk integrates with previous chunks
5. ✅ **Documentation**: Update docs/API/README as needed
6. ✅ **Code Review**: Check for simplification opportunities (DRY, SOLID)
7. ✅ **Gate Sign-Off**: User approval before proceeding

If ANY verification fails: Stop, diagnose, fix. Do not proceed until green.

---

## CHUNK 1: Monorepo Setup + Database Schema (2 hours)

**Goals**:
- Initialize Turborepo with pnpm workspaces
- Set up Supabase project + pgvector extension
- Create database schema (users, analyses, usage_logs, stripe_events)
- Create RLS policies
- Create indexes for performance

**Tasks**:
```bash
# 1. Create pnpm-workspace.yaml
cat > pnpm-workspace.yaml << 'EOF'
packages:
  - 'worker'
  - 'skill'
  - 'web'
  - 'packages/*'
EOF

# 2. Create root package.json
cat > package.json << 'EOF'
{
  "name": "hex-yt-intel",
  "version": "1.0.0",
  "description": "YouTube Content Intelligence System - Foundational Complete Product",
  "private": true,
  "workspaces": ["worker", "skill", "web", "packages/*"],
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "type-check": "turbo run type-check",
    "db:migrate": "cd web && npx prisma migrate dev",
    "db:seed": "cd web && npx prisma db seed",
    "stripe:listen": "stripe listen --forward-to localhost:3000/api/stripe/webhook"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.6.2"
  },
  "packageManager": "pnpm@9.1.0"
}
EOF

# 3. Create turbo.json
cat > turbo.json << 'EOF'
{
  "version": "2",
  "tasks": {
    "dev": { "cache": false, "interactive": true },
    "build": { "outputs": [".next/**", "dist/**"], "cache": true },
    "test": { "cache": true },
    "lint": { "cache": true }
  }
}
EOF

# 4. Create root tsconfig.json
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "baseUrl": ".",
    "paths": {
      "@types/*": ["./packages/types/src/*"],
      "@lib/*": ["./web/lib/*"],
      "@components/*": ["./web/components/*"],
      "@hooks/*": ["./web/hooks/*"],
      "@api/*": ["./web/app/api/*"]
    }
  }
}
EOF

# 5. Commit monorepo setup
git add pnpm-workspace.yaml package.json turbo.json tsconfig.json
git commit -m "setup(monorepo): initialize Turborepo structure with pnpm workspaces"
```

**Supabase Setup**:
```bash
# 1. Create new Supabase project (CLI or dashboard)
supabase projects create --name hex-yt-intel --region us-east-1

# 2. Enable pgvector extension
supabase db execute "CREATE EXTENSION IF NOT EXISTS vector;"

# 3. Run migrations (see schema below)
supabase db push
```

**Database Schema** (save as `supabase/migrations/001_initial_schema.sql`):
```sql
-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT,
  analyses_used INT DEFAULT 0,
  last_reset_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Analyses table
CREATE TABLE analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT,
  channel_title TEXT,
  channel_id TEXT,
  published_at TIMESTAMP,
  duration_seconds INT,
  view_count BIGINT,
  like_count INT,
  comment_count INT,
  thumbnail_url TEXT,
  analysis_markdown TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_video UNIQUE(user_id, video_id)
);

-- Usage logs
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('analysis', 'search', 'export', 'api_call')),
  tokens_used INT DEFAULT 0,
  cost_usd DECIMAL(10, 4) DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stripe events
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  amount_cents INT,
  status TEXT CHECK (status IN ('success', 'failed', 'pending')),
  payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_analyses_user_id ON analyses(user_id);
CREATE INDEX idx_analyses_created ON analyses(created_at DESC);
CREATE INDEX idx_analyses_embedding ON analyses USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_stripe_events_user_id ON stripe_events(user_id);

-- RLS Policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can read own analyses" ON analyses
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create analyses" ON analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analyses" ON analyses
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses" ON analyses
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own usage logs" ON usage_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can write usage logs" ON usage_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Triggers (auto-delete free tier analyses after 30 days)
CREATE OR REPLACE FUNCTION delete_old_free_analyses()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM analyses
  WHERE user_id IN (
    SELECT id FROM users WHERE tier = 'free'
  )
  AND created_at < NOW() - INTERVAL '30 days';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_delete_old_analyses
AFTER INSERT ON analyses
FOR EACH STATEMENT
EXECUTE FUNCTION delete_old_free_analyses();
```

**Verification Gate 1**:
```bash
# 1. Type check
pnpm type-check

# 2. Verify Supabase schema
supabase db list-tables # Should see: users, analyses, usage_logs, stripe_events

# 3. Verify pgvector
supabase db execute "SELECT * FROM pg_available_extensions WHERE name = 'vector';"

# 4. Verify RLS policies
supabase db execute "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"

# 5. Verify indexes
supabase db execute "SELECT indexname FROM pg_indexes WHERE schemaname = 'public';"

# ✅ GATE SIGN-OFF: All checks pass, database ready
```

---

## CHUNK 2: Next.js Web App + TypeScript Setup (3 hours)

**Goals**:
- Initialize Next.js 15 with TypeScript strict mode
- Set up Tailwind CSS + shadcn/ui
- Create app structure (pages, components, lib, hooks)
- Create shared types package
- Configure ESLint + Prettier

**Tasks**:
```bash
# 1. Create web package
mkdir -p web/app web/components web/lib web/hooks

# 2. Create web/package.json
cat > web/package.json << 'EOF'
{
  "name": "@hex-yt-intel/web",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --ext .ts,.tsx",
    "type-check": "tsc --noEmit",
    "format": "prettier --write ."
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "next": "^15.0.0",
    "tailwindcss": "^4.0.0",
    "@supabase/supabase-js": "^2.43.0",
    "next-auth": "^4.24.0",
    "stripe": "^14.0.0",
    "clsx": "^2.1.1"
  },
  "devDependencies": {
    "typescript": "^5.6.2",
    "@types/react": "^19.0.0",
    "@types/node": "^20.0.0",
    "eslint": "^8.54.0",
    "prettier": "^3.1.0"
  }
}
EOF

# 3. Create web/tsconfig.json
cat > web/tsconfig.json << 'EOF'
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "react",
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
EOF

# 4. Create web/next.config.ts
cat > web/next.config.ts << 'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: { tsconfigPath: "./tsconfig.json" },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  },
};

export default nextConfig;
EOF

# 5. Create tailwind config
cat > web/tailwind.config.ts << 'EOF'
import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
EOF

# 6. Create shared types package
mkdir -p packages/types/src
cat > packages/types/package.json << 'EOF'
{
  "name": "@hex-yt-intel/types",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {}
}
EOF

# 7. Create packages/types/src/index.ts
cat > packages/types/src/index.ts << 'EOF'
// User types
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  tier: 'free' | 'pro' | 'enterprise';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  analyses_used: number;
  last_reset_date: Date;
  created_at: Date;
  updated_at: Date;
}

// Analysis types
export interface Analysis {
  id: string;
  user_id: string;
  video_id: string;
  title: string;
  channel_title: string;
  channel_id: string;
  published_at: Date | null;
  duration_seconds: number | null;
  view_count: number;
  like_count: number;
  comment_count: number;
  thumbnail_url: string | null;
  analysis_markdown: string;
  embedding: number[] | null;
  created_at: Date;
  updated_at: Date;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: {
    message: string;
    code: string;
  };
  meta?: {
    pagination?: { skip: number; limit: number; total: number };
    query_time_ms?: number;
  };
}

// Usage types
export interface UsageStats {
  user_id: string;
  tier: string;
  analyses_this_month: number;
  analyses_limit: number;
  reset_date: Date;
  searches_used: number;
  api_requests_used: number;
  cost_this_month_usd: number;
}

// Stripe types
export interface StripeEvent {
  id: string;
  user_id: string | null;
  event_type: string;
  amount_cents: number | null;
  status: 'success' | 'failed' | 'pending';
  payload: Record<string, unknown>;
  created_at: Date;
}
EOF

# 8. Install dependencies
pnpm install

# 9. Create .env.local.example
cat > web/.env.local.example << 'EOF'
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxx

# NextAuth
NEXTAUTH_SECRET=xxxxx
NEXTAUTH_URL=http://localhost:3000

# OAuth
GITHUB_ID=xxxxx
GITHUB_SECRET=xxxxx
GOOGLE_ID=xxxxx
GOOGLE_SECRET=xxxxx

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# Upstash Redis
UPSTASH_REDIS_REST_URL=xxxxx
UPSTASH_REDIS_REST_TOKEN=xxxxx

# OpenAI (for vector embeddings)
OPENAI_API_KEY=xxxxx

# Cloudflare Worker
NEXT_PUBLIC_WORKER_URL=https://yt-intel.hex-tech-lab.workers.dev
CLOUDFLARE_SECRET_TOKEN=xxxxx
EOF

cp web/.env.local.example web/.env.local
```

**Verification Gate 2**:
```bash
# 1. Type check
pnpm type-check

# 2. Build
pnpm build

# 3. Verify package structure
ls -la web/ packages/types/

# 4. Check dependencies
pnpm list --depth 0

# ✅ GATE SIGN-OFF: Next.js + types ready, no build errors
```

---

## CHUNK 3: Authentication Setup (next-auth + OAuth) (3 hours)

**Goals**:
- Implement next-auth with Google + GitHub OAuth
- Create auth API routes
- Create session management
- Create middleware for protected routes
- Sync auth with Supabase users table

**Files to create**:
- `web/app/api/auth/[...nextauth]/route.ts` (NextAuth config)
- `web/middleware.ts` (Session validation)
- `web/lib/auth.ts` (Auth utilities)
- `web/app/auth/` (Auth UI pages)

...continuing with detailed instructions for each chunk...

**Verification Gate 3**: TBD (after full auth implementation)

---

## CHUNK 4: Backend API Routes (Analysis CRUD) (4 hours)

...

## CHUNK 5: Backend API Routes (Search + Export) (3 hours)

...

## CHUNK 6: Frontend - Analysis Component (3 hours)

...

## CHUNK 7: Frontend - History + Search (3 hours)

...

## CHUNK 8: Frontend - Settings + Billing (2 hours)

...

## CHUNK 9: Stripe Integration (3 hours)

...

## CHUNK 10: Rate Limiting + Upstash Redis (2 hours)

...

## CHUNK 11: Error Tracking + Observability (2 hours)

...

## CHUNK 12: Deployment + Testing (4 hours)

...

---

## IMPLEMENTATION CHECKLIST

- [ ] Chunk 1: Monorepo + Database ✅ Gate 1
- [ ] Chunk 2: Next.js + TypeScript ✅ Gate 2
- [ ] Chunk 3: Authentication ✅ Gate 3
- [ ] Chunk 4: Analysis CRUD ✅ Gate 4
- [ ] Chunk 5: Search + Export ✅ Gate 5
- [ ] Chunk 6: Frontend Analysis ✅ Gate 6
- [ ] Chunk 7: Frontend History ✅ Gate 7
- [ ] Chunk 8: Frontend Settings ✅ Gate 8
- [ ] Chunk 9: Stripe Billing ✅ Gate 9
- [ ] Chunk 10: Rate Limiting ✅ Gate 10
- [ ] Chunk 11: Observability ✅ Gate 11
- [ ] Chunk 12: Deployment ✅ Final Gate

---

## TOTAL TIMELINE

- **Chunk 1-2**: Day 1 (Setup)
- **Chunk 3-5**: Days 2-3 (Backend)
- **Chunk 6-8**: Days 4-5 (Frontend)
- **Chunk 9-10**: Day 6 (Monetization + Rate Limiting)
- **Chunk 11-12**: Day 7 (Observability + Deploy)

**Estimated Total**: 4-5 weeks (with full-time focus)

---

**Document Status**: Ready for Chunk 1 execution  
**Next Action**: Execute Chunk 1 with full gate verification
