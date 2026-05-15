-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Enums for structured data
CREATE TYPE user_tier AS ENUM ('free', 'pro', 'startup', 'sme');
CREATE TYPE repo_type AS ENUM ('personal', 'team');
CREATE TYPE member_role AS ENUM ('owner', 'editor', 'viewer');

-- Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    google_id TEXT UNIQUE,
    tier user_tier DEFAULT 'free',
    stripe_customer_id TEXT UNIQUE,
    analyses_used INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Teams Table
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    member_count INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team Members Table
CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role member_role DEFAULT 'viewer',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

-- Analyses Table (includes pgvector 1536 for semantic search)
CREATE TABLE analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    channel_name TEXT,
    transcript TEXT,
    synthesis TEXT,
    synthesis_embedding vector(1536),
    repo_type repo_type DEFAULT 'personal',
    shared_token TEXT UNIQUE,
    shared_expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage Logs Table
CREATE TABLE usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Stripe Events Table (for webhook reconciliation)
CREATE TABLE stripe_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stripe_event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- Core RLS Policies
CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view own analyses" ON analyses FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view team analyses" ON analyses FOR SELECT USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
    AND repo_type = 'team'
);

-- Usage Logs and Stripe Events RLS
CREATE POLICY "Users can read own usage logs" ON usage_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role writes usage logs" ON usage_logs FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage stripe events" ON stripe_events FOR ALL USING (auth.role() = 'service_role');