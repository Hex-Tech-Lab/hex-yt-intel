const requiredVars = ['DECODO_API_KEY', 'YOUTUBE_API_KEY', 'CLOUDFLARE_SECRET_TOKEN'];

const missing = requiredVars.filter(varName => !process.env[varName]);

if (missing.length > 0) {
  console.error(`❌ FATAL: Production environment missing: ${missing.join(', ')}`);
  if (process.env.IS_FORK === 'true') {
    console.warn(`⚠️ Warning: Missing production secrets in fork PR CI/CD pipeline. Allowing build/tests to proceed.`);
    process.exit(0);
  }
  process.exit(1);
}

console.log('✅ Infrastructure Validation: All production secrets confirmed.');
