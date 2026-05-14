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
] as const;

const OPTIONAL_ENV_VARS = [
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_APP_VERSION',
  'OPENROUTER_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CLOUDFLARE_WORKER_URL',
  'SENTRY_AUTH_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
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
    apiKey?: string;
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
 * Validate a single environment variable
 */
function validateEnvVar(name: EnvVar, required: boolean = false): string | undefined {
  const value = process.env[name];

  if (required && !value) {
    // During Vercel build, provide default values instead of throwing
    if (process.env.VERCEL === 'true') {
      return `[build-time-placeholder-${name}]`;
    }
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `Please set this variable in your .env.local or deployment environment.`
    );
  }

  if (value && typeof value !== 'string') {
    throw new Error(`Environment variable ${name} must be a string, got ${typeof value}`);
  }

  return value;
}

/**
 * Validate all environment variables
 */
function validateEnvironment(): void {
  // During Vercel build (next build), skip strict validation
  // Required vars will have placeholder values from validateEnvVar
  if (process.env.VERCEL === 'true') {
    console.log('Running in Vercel build environment - using placeholder values');
    return;
  }

  const errors: string[] = [];

  // Check required variables (only in runtime, not build)
  for (const envVar of REQUIRED_ENV_VARS) {
    try {
      validateEnvVar(envVar, true);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Missing ${envVar}`);
    }
  }

  // Check optional variables (no error, just log warnings)
  for (const envVar of OPTIONAL_ENV_VARS) {
    try {
      const value = validateEnvVar(envVar, false);
      if (!value && process.env.NODE_ENV === 'production') {
        console.warn(`Warning: Optional environment variable not set: ${envVar}`);
      }
    } catch (error) {
      console.warn(`Warning: ${error instanceof Error ? error.message : `Invalid ${envVar}`}`);
    }
  }

  // Throw if any required variables are missing
  if (errors.length > 0) {
    console.error('Environment validation failed:');
    errors.forEach(error => console.error(`  - ${error}`));
    throw new Error(`Environment validation failed with ${errors.length} error(s)`);
  }

  console.log('✓ Environment variables validated successfully');
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
      apiKey: validateEnvVar('OPENROUTER_API_KEY', false),
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
  get openrouterApiKey(): string | undefined {
    return validateEnvVar('OPENROUTER_API_KEY', false);
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
};
