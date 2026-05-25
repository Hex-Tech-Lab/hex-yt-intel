const { execSync } = require('child_process');

const requiredVars = ['DECODO_API_KEY', 'YOUTUBE_API_KEY', 'CLOUDFLARE_SECRET_TOKEN'];

try {
  const envOutput = execSync('vercel env list').toString();

  requiredVars.forEach(varName => {
    if (!envOutput.includes(varName)) {
      console.error(`❌ FATAL: Production environment missing: ${varName}`);
      process.exit(1);
    }
  });
  console.log('✅ Infrastructure Validation: All production secrets confirmed.');
} catch (e) {
  console.error('❌ Failed to validate environment:', e.message);
  process.exit(1);
}
