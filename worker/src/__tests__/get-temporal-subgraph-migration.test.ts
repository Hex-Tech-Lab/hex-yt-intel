// Static guard for the get_temporal_subgraph fix: the final DISTINCT ON / ORDER BY must be
// qualified, or Postgres raises 42702 (ambiguous column) against the RETURNS TABLE OUT params.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const FIX_FILE = '20261013110000_fix_get_temporal_subgraph_ambiguous_columns.sql';

describe('get_temporal_subgraph ambiguity fix migration', () => {
  const sql = readFileSync(resolve(MIGRATIONS_DIR, FIX_FILE), 'utf8');

  it('qualifies anchor_id and depth in DISTINCT ON and ORDER BY with the CTE alias', () => {
    expect(sql).toContain('SELECT DISTINCT ON (subgraph.anchor_id) subgraph.*');
    expect(sql).toContain('ORDER BY subgraph.anchor_id, subgraph.depth ASC');
  });

  it('has no bare anchor_id or depth in the final DISTINCT ON / ORDER BY', () => {
    expect(sql).not.toMatch(/DISTINCT ON \(anchor_id\)/);
    expect(sql).not.toMatch(/ORDER BY anchor_id\b/);
    expect(sql).not.toMatch(/ORDER BY subgraph\.anchor_id, depth\b/);
  });

  it('keeps the signature, SECURITY DEFINER, empty search_path, and grants', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.get_temporal_subgraph(p_analysis_id UUID)');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_temporal_subgraph(UUID) FROM anon, authenticated, public;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_temporal_subgraph(UUID) TO service_role;');
  });

  it('sorts after the migration whose function body it supersedes (ADR 018 version ordering)', () => {
    const versions = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort();
    const original = versions.find((f) => f.startsWith('20261012180000_'));
    expect(original).toBeDefined();
    expect(versions.indexOf(FIX_FILE)).toBeGreaterThan(versions.indexOf(original!));
  });
});
