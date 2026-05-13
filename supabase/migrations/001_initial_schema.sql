-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Users table (authentication + tier management)
CREATE TABLE IF NOT EXISTS users (
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

-- Analyses table (core data: video metadata + UCIS v3.2 analysis + embedding)
CREATE TABLE IF NOT EXISTS analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT,
  channel_title TEXT,
  channel_id TEXT,
  published_at TIMESTAMP,
  duration_seconds INT,
  view_count BIGINT DEFAULT 0,
  like_count INT DEFAULT 0,
  comment_count INT DEFAULT 0,
  thumbnail_url TEXT,
  analysis_markdown TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_user_video UNIQUE(user_id, video_id)
);

-- Usage logs (track quota consumption for billing)
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('analysis', 'search', 'export', 'api_call')),
  tokens_used INT DEFAULT 0,
  cost_usd DECIMAL(10, 4) DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Stripe events (async payment notifications)
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  amount_cents INT,
  status TEXT CHECK (status IN ('success', 'failed', 'pending')),
  payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX IF NOT EXISTS idx_analyses_created ON analyses(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyses_embedding ON analyses USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_events_user_id ON stripe_events(user_id);

-- Enable RLS (Row Level Security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can read own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for analyses table
CREATE POLICY "Users can read own analyses" ON analyses
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create analyses" ON analyses
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analyses" ON analyses
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses" ON analyses
  FOR DELETE USING (auth.uid() = user_id);

-- RLS Policies for usage_logs table
CREATE POLICY "Users can read own usage logs" ON usage_logs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role writes usage logs" ON usage_logs
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- RLS Policies for stripe_events table (service role only)
CREATE POLICY "Service role can select stripe events" ON stripe_events
  FOR SELECT USING (auth.role() = 'service_role');

CREATE POLICY "Service role can insert stripe events" ON stripe_events
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can update stripe events" ON stripe_events
  FOR UPDATE USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can delete stripe events" ON stripe_events
  FOR DELETE USING (auth.role() = 'service_role');

-- Trigger function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at columns
CREATE TRIGGER trigger_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_analyses_updated_at
BEFORE UPDATE ON analyses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
