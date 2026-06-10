const requiredVars = ['DECODO_API_KEY', 'YOUTUBE_API_KEY', 'CLOUDFLARE_SECRET_TOKEN'];

const missing = requiredVars.filter(varName => !process.env[varName]);

if (missing.length > 0) {
  console.error(`❌ FATAL: Production environment missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('✅ Infrastructure Validation: All production secrets confirmed.');
