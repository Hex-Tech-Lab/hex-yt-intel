/**
 * Environment Variable Validation & Type-Safe Access
 * 
 * ZERO-FATAL POLICY: This module ensures the application ALWAYS boots in 
 * non-production environments (Preview/CI/Dev) by providing functional 
 * mocks for missing keys. Strict validation is enforced ONLY in production.
 */

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'OPENROUTER_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'UPSTASH_VECTOR_REST_URL',
  'UPSTASH_VECTOR_REST_TOKEN',
  'STREAM_HMAC_SECRET',
] as const;

const OPTIONAL_ENV_VARS = [
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_APP_VERSION',
  'NEXT_PUBLIC_APP_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDFLARE_WORKER_URL',
  'NEXT_PUBLIC_WORKER_URL',
  'SENTRY_AUTH_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'DECODO_API_KEY',
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];
type OptionalEnvVar = (typeof OPTIONAL_ENV_VARS)[number];
type EnvVar = RequiredEnvVar | OptionalEnvVar;

/** Functional mocks used to prevent crashes in preview/CI environments */
const MOCK_DEFAULTS: Partial<Record<EnvVar, string>> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://adnmbikaqnxivalqoild.supabase.co', // Default staging/prod URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'mock-anon-key-prevent-crash',
  OPENROUTER_API_KEY: 'sk-or-v1-mock-key-preview-only',
  STRIPE_SECRET_KEY: 'sk_test_mock_stripe_key',
  STRIPE_WEBHOOK_SECRET: 'whsec_mock_stripe_webhook',
  UPSTASH_VECTOR_REST_URL: 'https://rested-ferret-38816-eu1-vector.upstash.io',
  UPSTASH_VECTOR_REST_TOKEN: 'mock-vector-token',
  STREAM_HMAC_SECRET: 'dev-hmac-secret-123', // CRYSTAL CLEAR SYNC WITH WORKER
  NEXT_PUBLIC_WORKER_URL: 'https://yt-intel.hex-tech-lab.workers.dev',
  CLOUDFLARE_WORKER_URL: 'https://yt-intel.hex-tech-lab.workers.dev',
};

function isPlaceholder(value: string | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  return (
    normalized.includes('dummy') ||
    normalized.includes('placeholder') ||
    normalized.includes('stub') ||
    normalized.includes('ci-build') ||
    value === ''
  );
}

function validateEnvVar(
  name: EnvVar,
  required: boolean = false,
  allowMock: boolean = true
): string | undefined {
  const value = process.env[name];
  const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
  const isPreview = process.env.VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';
  const isProd = !isCI && !isPreview && 
    (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production');

  // 1. Valid Value Found
  if (value && !isPlaceholder(value)) return value;

  // 2. Production Lockdown (No Mocks Allowed)
  if (isProd && required) {
    if (!value || isPlaceholder(value)) {
      throw new Error(`[FATAL] Production misconfigured: Missing required env var ${name}`);
    }
    return value;
  }

  // 3. Zero-Fatal Fallback (Preview/CI/Dev)
  if (required || allowMock) {
    const mock = MOCK_DEFAULTS[name];
    if (mock) {
      if (isPreview || isCI) {
        console.warn(`[env-recovery] Using fallback for ${name} in ${isPreview ? 'Preview' : 'CI'}`);
      }
      return mock;
    }
  }

  if (required) {
     throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function validateEnvironment(): void {
  const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
  const isPreview = process.env.VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';
  const isProd = !isCI && !isPreview && 
    (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production');

  const report = {
    configured: [] as string[],
    missing: [] as string[],
    mocked: [] as string[],
  };

  for (const envVar of REQUIRED_ENV_VARS) {
    const val = process.env[envVar];
    if (val && !isPlaceholder(val)) {
      report.configured.push(envVar);
    } else if (!isProd && MOCK_DEFAULTS[envVar]) {
      report.mocked.push(envVar);
    } else {
      report.missing.push(envVar);
    }
  }

  console.log('─── Infrastructure Health Report ───');
  console.log(`Environment: ${isProd ? 'PRODUCTION (Strict)' : isPreview ? 'PREVIEW (Recoverable)' : 'DEVELOPMENT'}`);
  console.log(`Configured:  ${report.configured.length}/${REQUIRED_ENV_VARS.length}`);
  if (report.mocked.length > 0) console.warn(`Recovered:   ${report.mocked.join(', ')} (Using staging fallbacks)`);
  if (report.missing.length > 0) {
    const msg = `CRITICAL MISSING: ${report.missing.join(', ')}`;
    if (isProd) {
      console.error(`❌ ${msg}`);
      throw new Error(`Production validation failed: ${msg}`);
    } else {
      console.warn(`⚠️ ${msg}`);
    }
  }
  console.log('────────────────────────────────────');
}

/** Initialize and validate on module load (Server-side) */
if (typeof window === 'undefined') {
  validateEnvironment();
}

export const env = {
  get supabaseUrl(): string { return validateEnvVar('NEXT_PUBLIC_SUPABASE_URL', true)!; },
  get supabaseAnonKey(): string { return validateEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY', true)!; },
  get supabaseServiceRoleKey(): string | undefined { return validateEnvVar('SUPABASE_SERVICE_ROLE_KEY', false); },
  get sentryDsn(): string | undefined { return validateEnvVar('NEXT_PUBLIC_SENTRY_DSN', false); },
  get openrouterApiKey(): string { return validateEnvVar('OPENROUTER_API_KEY', true)!; },
  get cloudflareWorkerUrl(): string {
    return validateEnvVar('NEXT_PUBLIC_WORKER_URL', false) || 
           validateEnvVar('CLOUDFLARE_WORKER_URL', false) || 
           MOCK_DEFAULTS.CLOUDFLARE_WORKER_URL!;
  },
  get upstashRedisUrl(): string | undefined { return validateEnvVar('UPSTASH_REDIS_REST_URL', false); },
  get upstashRedisToken(): string | undefined { return validateEnvVar('UPSTASH_REDIS_REST_TOKEN', false); },
  get upstashVectorUrl(): string | undefined { return validateEnvVar('UPSTASH_VECTOR_REST_URL', false); },
  get upstashVectorToken(): string | undefined { return validateEnvVar('UPSTASH_VECTOR_REST_TOKEN', false); },
  get isDevelopment(): boolean { return process.env.NODE_ENV === 'development'; },
  get isProduction(): boolean { 
    const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
    const isPreview = process.env.VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';
    return !isCI && !isPreview && (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production');
  },
  get appUrl(): string | undefined { return validateEnvVar('NEXT_PUBLIC_APP_URL', false); },
  get qstashToken(): string | undefined { return validateEnvVar('QSTASH_TOKEN', false); },
  get qstashSigningKey(): string | undefined { return validateEnvVar('QSTASH_CURRENT_SIGNING_KEY', false); },
  get stripeSecretKey(): string { return validateEnvVar('STRIPE_SECRET_KEY', true)!; },
  get stripeWebhookSecret(): string { return validateEnvVar('STRIPE_WEBHOOK_SECRET', true)!; },
  get decodoApiKey(): string | undefined { return validateEnvVar('DECODO_API_KEY', false); },
  get streamHmacSecret(): string { return validateEnvVar('STREAM_HMAC_SECRET', true)!; },
};

export const clientEnv = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || MOCK_DEFAULTS.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || MOCK_DEFAULTS.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_WORKER_URL: process.env.NEXT_PUBLIC_WORKER_URL || MOCK_DEFAULTS.NEXT_PUBLIC_WORKER_URL,
};
