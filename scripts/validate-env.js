/**
 * Production Environment Validator
 * 
 * Ensures all required secrets are present before a production deployment.
 * In Preview/CI environments, it logs missing variables but allows the build to proceed.
 */

const requiredVars = [
  'DECODO_API_KEY', 
  'YOUTUBE_API_KEY', 
  'CLOUDFLARE_SECRET_TOKEN', 
  'NEXT_PUBLIC_WORKER_URL',
  'STREAM_HMAC_SECRET',
  'OPENROUTER_API_KEY'
];

const isCI = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true';
const isPreview = process.env.VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';
const isProduction = !isCI && !isPreview && (process.env.VERCEL_ENV === 'production' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'production');

const missing = requiredVars.filter(varName => !process.env[varName]);

if (missing.length > 0) {
  const msg = `Infrastructure configuration missing: ${missing.join(', ')}`;
  
  if (isProduction) {
    console.error(`❌ FATAL: ${msg}`);
    console.error('Production builds require all secrets to be configured in Vercel project settings.');
    process.exit(1);
  } else {
    console.warn(`⚠️ WARNING: ${msg}`);
    console.warn('Proceeding with build (Preview/CI fallback mode enabled).');
    process.exit(0);
  }
}

console.log('✅ Infrastructure Validation: All production secrets confirmed.');
process.exit(0);
