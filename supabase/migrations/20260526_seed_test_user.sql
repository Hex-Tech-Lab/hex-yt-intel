-- Seed test user for development and E2E testing
-- User ID: da4381c6-f774-4c99-8f04-2c1c9e27d1fb
-- Email: kellybakri@gmail.com
-- Tier: free (3 analyses/month quota)

INSERT INTO public.users (
  id,
  email,
  tier,
  analyses_used,
  last_reset_date,
  created_at,
  updated_at
) VALUES (
  'da4381c6-f774-4c99-8f04-2c1c9e27d1fb',
  'kellybakri@gmail.com',
  'free',
  0,
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = 'kellybakri@gmail.com',
  tier = 'free',
  updated_at = NOW();

RAISE NOTICE 'Test user seeded: kellybakri@gmail.com (free tier, 0/3 analyses used)';
