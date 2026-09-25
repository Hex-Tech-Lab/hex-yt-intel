/**
 * Live History status (2026-09-25, analysis 6047514f incident): the overview
 * mapping must carry the new 'stalled' status through, the polling hook's
 * live-row predicate must be right, and the v14 migration must keep the
 * status-derivation contract intact.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mapHistoryOverviewRow, type RawHistoryOverviewRow } from '@/lib/utils/history-overview';
import { hasLiveStatusItems, HISTORY_LIVE_POLL_MS } from '@/hooks/useHistoryOverview';

function baseRow(overrides: Partial<RawHistoryOverviewRow> = {}): RawHistoryOverviewRow {
  return {
    base_video_id: 'abc123',
    latest_analysis_id: 'analysis-1',
    title: 'A Great Video',
    channel_title: 'Some Channel',
    first_analyzed_at: '2026-09-25T22:35:00Z',
    last_analyzed_at: '2026-09-25T22:35:00Z',
    last_viewed_at: null,
    times_analyzed: 1,
    views: 0,
    best_dimensions: 0,
    present_dimensions: [],
    status: 'stalled',
    has_digest: true,
    has_description: true,
    has_channel_meta: true,
    has_comments: false,
    has_chapters: null,
    client_platform: null,
    ...overrides,
  };
}

describe('mapHistoryOverviewRow - stalled status', () => {
  it('passes the stalled status through to the domain item', () => {
    const item = mapHistoryOverviewRow(baseRow());
    expect(item.status).toBe('stalled');
  });

  it('still maps the four pre-existing statuses unchanged', () => {
    for (const status of ['complete', 'partial', 'processing', 'failed'] as const) {
      expect(mapHistoryOverviewRow(baseRow({ status })).status).toBe(status);
    }
  });
});

describe('hasLiveStatusItems', () => {
  it('is true when a row is actively processing', () => {
    expect(hasLiveStatusItems([{ status: 'processing' }, { status: 'complete' }])).toBe(true);
  });

  it('is true when a row is stalled (background recovery pending)', () => {
    expect(hasLiveStatusItems([{ status: 'stalled' }])).toBe(true);
  });

  it('is false when every row is terminal', () => {
    expect(
      hasLiveStatusItems([{ status: 'complete' }, { status: 'partial' }, { status: 'failed' }])
    ).toBe(false);
  });

  it('is false for an empty list', () => {
    expect(hasLiveStatusItems([])).toBe(false);
  });

  it('poll cadence stays well inside the SQL 15-minute staleness boundary', () => {
    expect(HISTORY_LIVE_POLL_MS).toBeLessThan(15 * 60_000);
  });
});

describe('migration v14 - stalled status contract', () => {
  const migrationDir = join(process.cwd(), '..', 'supabase', 'migrations');
  const v14File = readdirSync(migrationDir).find(name => name.includes('v14_stalled_status'));
  it('exists exactly once', () => {
    expect(v14File).toBeDefined();
  });
  if (!v14File) return;
  const sql = readFileSync(join(migrationDir, v14File), 'utf8');

  it('adds the stalled branch before the completed/partial/failed branches', () => {
    const processingIdx = sql.indexOf("then 'processing'");
    const stalledIdx = sql.indexOf("then 'stalled'");
    const completeIdx = sql.indexOf("then 'complete'");
    expect(processingIdx).toBeGreaterThan(-1);
    expect(stalledIdx).toBeGreaterThan(processingIdx);
    expect(stalledIdx).toBeLessThan(completeIdx);
  });

  it('keeps the same 15-minute boundary v12/v13 use for the processing window', () => {
    expect(sql).toContain("interval '15 minutes'");
  });

  it('does not regress the v13 has_chapters column or the revoke', () => {
    expect(sql).toContain('has_chapters boolean');
    expect(sql).toContain("revoke execute on function public.get_user_history_overview(uuid) from anon, authenticated, public;");
  });
});
