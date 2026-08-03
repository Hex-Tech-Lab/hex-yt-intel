const fs = require('fs');
const path = require('path');
const { createClient } = require(path.resolve('web/node_modules/@supabase/supabase-js'));

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
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(url, key);

async function main() {
  const { data: row, error } = await supabase
    .from('analyses')
    .select('id, title, video_id, billing_status, created_at, updated_at, analysis_payload, validation_report')
    .eq('id', '798873e2-2496-4ed2-9c14-9603c15fd5d7')
    .single();

  if (error) {
    console.error('Error fetching row:', error);
    return;
  }
  console.log('Row ID:', row.id);
  console.log('Created At:', row.created_at);
  console.log('Updated At:', row.updated_at);
  console.log('Billing Status:', row.billing_status);
  console.log('Validation Report Keys:', row.validation_report ? Object.keys(row.validation_report) : 'NULL');
  console.log('Validation Report Metadata:', row.validation_report ? row.validation_report.metadata : 'NULL');
  console.log('Analysis Payload Keys:', row.analysis_payload ? Object.keys(row.analysis_payload) : 'NULL');
  console.log('Analysis Payload Content:', JSON.stringify(row.analysis_payload, null, 2));
}

main().catch(console.error);
