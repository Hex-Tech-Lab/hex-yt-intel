CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    paddle_customer_id TEXT,
    paddle_subscription_id TEXT UNIQUE,
    plan_tier TEXT NOT NULL CHECK (plan_tier IN ('free', 'founder', 'pro')),
    status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'paused', 'trialing')),
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_paddle_sub_id ON user_subscriptions(paddle_subscription_id);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription" 
    ON user_subscriptions 
    FOR SELECT 
    USING (auth.uid() = user_id);
