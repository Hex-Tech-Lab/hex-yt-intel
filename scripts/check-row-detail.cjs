const fs = require('fs');
const path = require('path');

// Safely resolve supabase-js from the workspace
let createClient;
try {
  createClient = require(path.resolve('web/node_modules/@supabase/supabase-js')).createClient;
} catch {
  console.error('❌ @supabase/supabase-js not found. Run pnpm install first.');
  process.exit(1);
}

function loadEnv() {
  const envPath = path.resolve('.env.local');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const idx = line.indexOf('=');
    if (idx !== -1) {
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL not found in .env.local');
  process.exit(1);
}
if (!key) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
  console.error('   This script requires the service role key to read analysis payloads.');
  console.error('   Do NOT fall back to the anon key — it has no access to analyses.');
  process.exit(1);
}

const analysisId = process.argv[2];
if (!analysisId) {
  console.error('❌ Usage: node scripts/check-row-detail.cjs <analysis-id>');
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data: row, error } = await supabase
    .from('analyses')
    .select('id, title, video_id, billing_status, created_at, updated_at')
    .eq('id', analysisId)
    .single();

  if (error) {
    console.error('Error fetching row:', error);
    return;
  }
  console.log('Row ID:', row.id);
  console.log('Created At:', row.created_at);
  console.log('Updated At:', row.updated_at);
  console.log('Billing Status:', row.billing_status);
  console.log('Title:', row.title?.slice(0, 100));
  console.log('Video ID:', row.video_id);

  // Only print full payload with explicit --payload flag
  if (process.argv.includes('--payload')) {
    const { data: fullRow } = await supabase
      .from('analyses')
      .select('analysis_payload, validation_report')
      .eq('id', analysisId)
      .single();
    if (fullRow?.analysis_payload) {
      console.log('\nAnalysis Payload Keys:', Object.keys(fullRow.analysis_payload).join(', '));
      console.log('Analysis Payload (redacted):', JSON.stringify(fullRow.analysis_payload, null, 2).slice(0, 500) + '...');
    }
    if (fullRow?.validation_report) {
      console.log('\nValidation Report Keys:', Object.keys(fullRow.validation_report).join(', '));
    }
  } else {
    console.log('\nTip: Pass --payload to inspect analysis_payload and validation_report contents.');
  }
}

main().catch(console.error);
