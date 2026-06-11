const fs = require('fs');
const path = require('path');

const v5Path = path.join(__dirname, '../lib/prompts/ucis-v5.ts');
const v51Path = path.join(__dirname, '../lib/prompts/ucis-v5.1.ts');

const v5File = fs.readFileSync(v5Path, 'utf8');
const v51File = fs.readFileSync(v51Path, 'utf8');

const extractString = (content, varName) => {
  const match = content.match(new RegExp(`export\\s+const\\s+${varName}\\s*=\\s*\`([\\s\\S]*?)\`\\s*;`));
  return match ? match[1] : '';
};

const v5Text = extractString(v5File, 'UCIS_V5_SYSTEM');
const v51Text = extractString(v51File, 'UCIS_V5_1_SYSTEM');

if (!v5Text || !v51Text) {
  console.error('Failed to extract prompt strings:', { v5Length: v5Text.length, v51Length: v51Text.length });
  process.exit(1);
}

const jsonObject = {
  "5.0": v5Text,
  "5.1": v51Text
};

const jsonStr = JSON.stringify(jsonObject);
// Escape single quotes for SQL insertion
const escapedJson = jsonStr.replace(/'/g, "''");

const sql = `-- Migration to store prompt_config in app_settings table
insert into public.app_settings (key, value)
values (
  'prompt_config',
  '${escapedJson}'::jsonb
)
on conflict (key) do update
set value = excluded.value;
`;

const migrationDir = path.join(__dirname, '../../supabase/migrations');
if (!fs.existsSync(migrationDir)) {
  fs.mkdirSync(migrationDir, { recursive: true });
}

fs.writeFileSync(path.join(migrationDir, '20260611142500_add_prompt_config.sql'), sql, 'utf8');
console.log('SQL Migration generated successfully at supabase/migrations/20260611142500_add_prompt_config.sql');
