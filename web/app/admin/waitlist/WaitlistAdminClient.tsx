'use client';

import { useEffect, useMemo, useState } from 'react';
import { Banner, Spinner, Badge } from '@astryxdesign/core';

interface WaitlistRow {
  id: string;
  email: string;
  source: string;
  created_at: string;
}

type SortKey = 'newest' | 'oldest' | 'email_asc';

function fmt(ts: string): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Admin "Waitlist" tab -- who signed up for the waitlist, when, and via
 * which source. Mirrors UsersAdminClient.tsx's structure (search/sort/
 * table/totals footer) since it's a sibling admin-list feature.
 */
export function WaitlistAdminClient() {
  const [signups, setSignups] = useState<WaitlistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('newest');

  useEffect(() => {
    fetch('/api/admin/waitlist')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { signups: WaitlistRow[] }) => setSignups(data.signups))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const visibleSignups = useMemo(() => {
    if (!signups) return null;
    const q = search.trim().toLowerCase();
    const filtered = q ? signups.filter((s) => s.email.toLowerCase().includes(q)) : signups;
    const sorted = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'newest': return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'oldest': return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case 'email_asc': return a.email.localeCompare(b.email);
        default: return 0;
      }
    });
    return sorted;
  }, [signups, search, sortKey]);

  if (error) {
    return (
      <div className="p-4">
        <Banner status="error" title={`Failed to load waitlist signups: ${error}`} />
      </div>
    );
  }

  if (!signups || !visibleSignups) {
    return (
      <div className="p-4 flex items-center gap-2 text-xs font-mono text-[var(--ink-muted)]">
        <Spinner size="sm" />
        <span>Loading waitlist signups…</span>
      </div>
    );
  }

  const uniqueEmails = new Set(signups.map((s) => s.email.toLowerCase())).size;

  return (
    <div className="flex flex-col gap-3 font-mono text-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--ink-main)]">
          Waitlist Signups ({visibleSignups.length}{visibleSignups.length !== signups.length ? ` of ${signups.length}` : ''})
        </h2>
        <p className="text-[10px] text-[var(--ink-muted)]">Email, source, signup time</p>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="waitlist-admin-search" className="sr-only">Search signups by email</label>
        <input
          id="waitlist-admin-search"
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email…"
          className="flex-1 rounded-lg border border-[var(--border-muted)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink-main)] placeholder:text-[var(--ink-muted)] outline-none focus:border-[var(--accent)]"
        />
        <label htmlFor="waitlist-admin-sort" className="sr-only">Sort signups</label>
        <select
          id="waitlist-admin-sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-[var(--border-muted)] bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--ink-main)] outline-none focus:border-[var(--accent)]"
        >
          <option value="newest">Sort: newest signup</option>
          <option value="oldest">Sort: oldest signup</option>
          <option value="email_asc">Sort: email (A → Z)</option>
        </select>
      </div>

      <div className="rounded-xl border border-[var(--border-muted)] overflow-x-auto">
        <table className="w-full text-left min-w-max">
          <thead>
            <tr className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
              <th scope="col" className="px-3 py-2 text-center">#</th>
              <th scope="col" className="px-3 py-2">Email</th>
              <th scope="col" className="px-3 py-2">Source</th>
              <th scope="col" className="px-3 py-2">Signed up</th>
            </tr>
          </thead>
          <tbody>
            {visibleSignups.map((s, idx) => (
              <tr
                key={s.id}
                className={`border-t border-[var(--border-muted)]${idx % 2 === 0 ? ' bg-[var(--surface-muted)]' : ''}`}
              >
                <td className="px-3 py-2 text-center font-medium text-[var(--ink-muted)]">{idx + 1}</td>
                <td className="px-3 py-2 font-semibold text-[var(--ink-main)]">{s.email}</td>
                <td className="px-3 py-2"><Badge variant="neutral" label={s.source} /></td>
                <td className="px-3 py-2">{fmt(s.created_at)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--border-muted)] bg-[var(--surface)] font-bold text-[11px] text-[var(--ink-main)]">
              <td className="px-3 py-2">—</td>
              <th scope="row" className="px-3 py-2 text-left font-bold">Total ({signups.length} signups, {uniqueEmails} unique emails)</th>
              <td className="px-3 py-2">—</td>
              <td className="px-3 py-2">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
