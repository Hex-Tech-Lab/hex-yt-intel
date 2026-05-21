/**
 * Environment Variable Validation & Type-Safe Access
 *
 * This module validates all required environment variables at startup.
 * Throws an error if any required variables are missing.
 *
 * All access to environment variables should go through this file.
 */

const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'OPENROUTER_API_KEY',
  'NEXTAUTH_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

const OPTIONAL_ENV_VARS = [
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_APP_VERSION',
  'NEXT_PUBLIC_APP_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDFLARE_WORKER_URL',
  'SENTRY_AUTH_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];
type OptionalEnvVar = (typeof OPTIONAL_ENV_VARS)[number];
type EnvVar = RequiredEnvVar | OptionalEnvVar;

interface EnvironmentConfig {
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey?: string;
  };
  sentry: {
    dsn?: string;
    authToken?: string;
  };
  cloudflare: {
    workerUrl: string;
  };
  openrouter: {
    apiKey: string;
  };
  upstash: {
    redisUrl?: string;
    redisToken?: string;
  };
  app: {
    version: string;
    isDevelopment: boolean;
    isProduction: boolean;
    isPreview: boolean;
  };
}

/**
 * Detect if a value is a placeholder (build-time stub)
 */
function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  const normalized = value.toLowerCase();
  return (
    normalized.includes('dummy') ||
    normalized.includes('placeholder') ||
    normalized.includes('stub') ||
    normalized.includes('ci-build') ||
    value === ''
  );
}

/**
 * Validate a single environment variable
 */
function validateEnvVar(
  name: EnvVar,
  required: boolean = false,
  allowPlaceholder: boolean = false
): string | undefined {
  const value = process.env[name];

  if (required && !value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Please set this variable in your .env.local or deployment environment.`
    );
  }

  if (value && typeof value !== 'string') {
    throw new Error(`Environment variable ${name} must be a string, got ${typeof value}`);
  }

  // In production, reject placeholder values
  if (required && value && isPlaceholder(value) && !allowPlaceholder) {
    throw new Error(
      `Environment variable ${name} has a placeholder value in production.\n` +
      `Please set a real value in your deployment environment.`
    );
  }

  return value;
}

/**
 * Validate all environment variables at runtime
 */
function validateEnvironment(): void {
  const errors: string[] = [];

  // Detect environment context
  const isProduction =
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production' ||
    process.env.NODE_ENV === 'production';
  const isCIorPreview =
    process.env.GITHUB_ACTIONS === 'true' ||
    process.env.VERCEL_ENV === 'preview';

  // Allow placeholders in CI/Preview, but enforce strict validation in production
  const allowPlaceholder = isCIorPreview && !isProduction;

  // Check required variables (only in runtime, not build)
  for (const envVar of REQUIRED_ENV_VARS) {
    try {
      validateEnvVar(envVar, true, allowPlaceholder);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Missing ${envVar}`);
    }
  }

  // Check optional variables (no error, just log warnings)
  for (const envVar of OPTIONAL_ENV_VARS) {
    try {
      const value = validateEnvVar(envVar, false, allowPlaceholder);
      if (!value && isProduction) {
        console.warn(`Warning: Optional environment variable not set: ${envVar}`);
      }
    } catch (error) {
      console.warn(`Warning: ${error instanceof Error ? error.message : `Invalid ${envVar}`}`);
    }
  }

  // Throw if any required variables are missing or invalid in production
  if (errors.length > 0) {
    console.error('Environment validation failed:');
    errors.forEach(error => console.error(`  - ${error}`));
    throw new Error(`Environment validation failed with ${errors.length} error(s)`);
  }

  const envType = isProduction ? 'production' : isCIorPreview ? 'CI/Preview' : 'development';
  console.log(`✓ Environment variables validated successfully (${envType})`);
}

/**
 * Get the environment configuration
 */
export function getEnv(): EnvironmentConfig {
  return {
    supabase: {
      url: validateEnvVar('NEXT_PUBLIC_SUPABASE_URL', true)!,
      anonKey: validateEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY', true)!,
      serviceRoleKey: validateEnvVar('SUPABASE_SERVICE_ROLE_KEY', false),
    },
    sentry: {
      dsn: validateEnvVar('NEXT_PUBLIC_SENTRY_DSN', false),
      authToken: validateEnvVar('SENTRY_AUTH_TOKEN', false),
    },
    cloudflare: {
      workerUrl: validateEnvVar('CLOUDFLARE_WORKER_URL', false) ||
        'https://yt-intel.hex-tech-lab.workers.dev',
    },
    openrouter: {
      apiKey: validateEnvVar('OPENROUTER_API_KEY', true)!,
    },
    upstash: {
      redisUrl: validateEnvVar('UPSTASH_REDIS_REST_URL', false),
      redisToken: validateEnvVar('UPSTASH_REDIS_REST_TOKEN', false),
    },
    app: {
      version: validateEnvVar('NEXT_PUBLIC_APP_VERSION', false) || '1.0.0',
      isDevelopment: process.env.NODE_ENV === 'development',
      isProduction: process.env.NODE_ENV === 'production',
      isPreview: process.env.VERCEL_ENV === 'preview',
    },
  };
}

/**
 * Initialize and validate environment on module load
 */
if (typeof window === 'undefined') {
  // Server-side only
  validateEnvironment();
}

// Export individual getters for convenience
export const env = {
  get supabaseUrl(): string {
    return validateEnvVar('NEXT_PUBLIC_SUPABASE_URL', true)!;
  },
  get supabaseAnonKey(): string {
    return validateEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY', true)!;
  },
  get supabaseServiceRoleKey(): string | undefined {
    return validateEnvVar('SUPABASE_SERVICE_ROLE_KEY', false);
  },
  get sentryDsn(): string | undefined {
    return validateEnvVar('NEXT_PUBLIC_SENTRY_DSN', false);
  },
  get openrouterApiKey(): string {
    return validateEnvVar('OPENROUTER_API_KEY', true)!;
  },
  get cloudflareWorkerUrl(): string {
    return validateEnvVar('CLOUDFLARE_WORKER_URL', false) ||
      'https://yt-intel.hex-tech-lab.workers.dev';
  },
  get upstashRedisUrl(): string | undefined {
    return validateEnvVar('UPSTASH_REDIS_REST_URL', false);
  },
  get upstashRedisToken(): string | undefined {
    return validateEnvVar('UPSTASH_REDIS_REST_TOKEN', false);
  },
  get isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development';
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },
  get appUrl(): string | undefined {
    return validateEnvVar('NEXT_PUBLIC_APP_URL', false);
  },
  get qstashToken(): string | undefined {
    return validateEnvVar('QSTASH_TOKEN', false);
  },
  get qstashSigningKey(): string | undefined {
    return validateEnvVar('QSTASH_CURRENT_SIGNING_KEY', false);
  },
  get nextAuthSecret(): string {
    return validateEnvVar('NEXTAUTH_SECRET', true)!;
  },
  get stripeSecretKey(): string {
    return validateEnvVar('STRIPE_SECRET_KEY', true)!;
  },
  get stripeWebhookSecret(): string {
    return validateEnvVar('STRIPE_WEBHOOK_SECRET', true)!;
  },
};