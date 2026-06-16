const requiredVars = ['DECODO_API_KEY', 'YOUTUBE_API_KEY', 'CLOUDFLARE_SECRET_TOKEN', 'NEXT_PUBLIC_WORKER_URL'];

const isPreview = process.env.VERCEL_ENV === 'preview' || process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';

const missing = requiredVars.filter(varName => {
  if (varName === 'NEXT_PUBLIC_WORKER_URL' && isPreview) {
    return false;
  }
  return !process.env[varName];
});

if (missing.length > 0) {
  if (process.env.SKIP_ENV_VALIDATION === 'true') {
    console.warn(`⚠️ WARNING: Production environment missing: ${missing.join(', ')} (Bypassed via SKIP_ENV_VALIDATION)`);
    process.exit(0);
  }
  console.error(`❌ FATAL: Production environment missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('✅ Infrastructure Validation: All production secrets confirmed.');
