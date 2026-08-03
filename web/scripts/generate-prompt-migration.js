const fs = require('fs');
const path = require('path');

const v51Path = path.join(__dirname, '../lib/prompts/ucis-v5.3.ts');
const v51File = fs.readFileSync(v51Path, 'utf8');

const extractString = (content, varName) => {
  const match = content.match(new RegExp(`export\\s+const\\s+${varName}\\s*=\\s*\`([\\s\\S]*?)\`\\s*;`));
  return match ? match[1] : '';
};

const v51Text = extractString(v51File, 'UCIS_V5_3_SYSTEM');

if (!v51Text) {
  console.error('Failed to extract prompt strings:', { v51Length: v51Text ? v51Text.length : 0 });
  process.exit(1);
}

const jsonObject = {
  "latest": "5.1",
  "history": [
    {
      "version": "5.1",
      "timestamp": "2026-06-11T14:25:00Z",
      "author": "Kelly Bakri with Antigravity",
      "description": "Initial active UCIS v5.1 prompt configuration"
    }
  ],
  "versions": {
    "5.1": v51Text
  }
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

const targetPath = path.join(migrationDir, '20260611142500_add_prompt_config.sql');
if (fs.existsSync(targetPath)) {
  console.error('Error: Migration file already exists at supabase/migrations/20260611142500_add_prompt_config.sql. Blocked write to prevent state overwrite.');
  process.exit(1);
}

fs.writeFileSync(targetPath, sql, 'utf8');
console.log('SQL Migration generated successfully at supabase/migrations/20260611142500_add_prompt_config.sql');
