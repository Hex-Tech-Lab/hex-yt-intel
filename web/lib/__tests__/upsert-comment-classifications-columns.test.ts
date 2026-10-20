/**
 * Live-caught 2026-10-01 (Sentry HEX-YT-INTEL-5Y, PGRST204): the adapter wrote an
 * `author` column comment_classifications never had, so every cochran persist
 * 500'd. Route tests mock the adapter, so only this test sees the real row shape:
 * every written key must be a column some migration actually creates.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

const upsert = vi.fn(() => ({ select: () => Promise.resolve({ data: [{ id: 'x' }], error: null }) }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServiceClient: () => ({ from: () => ({ upsert }) }) }));

import { SupabaseAuxRemediationAdapter } from '@/lib/adapters/SupabaseAuxRemediationAdapter';

function migratedColumns(table: string): Set<string> {
  const dir = join(__dirname, '../../../supabase/migrations');
  const cols = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const create = sql.match(new RegExp(`create table (?:if not exists )?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
    if (create) for (const m of create[1].matchAll(/^\s+([a-z_]+)\s+[a-z]/gim)) cols.add(m[1].toLowerCase());
    for (const m of sql.matchAll(new RegExp(`alter table (?:public\\.)?${table}[\\s\\S]*?;`, 'gi'))) {
      for (const c of m[0].matchAll(/add column (?:if not exists )?([a-z_]+)/gi)) cols.add(c[1].toLowerCase());
    }
  }
  return cols;
}

describe('upsertCommentClassifications row shape', () => {
  it('writes only columns that exist in comment_classifications', async () => {
    await SupabaseAuxRemediationAdapter.upsertCommentClassifications('run-1', [{
      commentExternalId: 'c1', commentText: 't', likeCount: 1, publishedAt: '2026-01-01T00:00:00Z', author: 'someone',
      sentiment: 'positive', commentType: 'praise', painPoint: 0, questionAsked: 0, intensity: 1,
      sentimentConfidence: 0.9, lowConfidence: false, modelUsed: 'm',
    }]);
    const rows = (upsert.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
    const columns = migratedColumns('comment_classifications');
    expect(columns.size).toBeGreaterThan(5);
    expect(Object.keys(rows[0]).filter((k) => !columns.has(k))).toEqual([]);
  });
});
