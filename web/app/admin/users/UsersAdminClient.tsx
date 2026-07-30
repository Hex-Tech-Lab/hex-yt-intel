'use client';

import { Fragment, useEffect, useState } from 'react';

interface UserActivityRow {
  id: string;
  email: string | null;
  name: string | null;
  tier: string | null;
  role: string | null;
  created_at: string;
  analyses_count: number;
  last_analysis_at: string | null;
  last_session_at: string | null;
  last_session_ip: string | null;
  last_session_user_agent: string | null;
}

interface UserSession {
  id: string;
  created_at: string;
  not_after: string | null;
  ip: string | null;
  user_agent: string | null;
}

interface UserAnalysis {
  id: string;
  video_id: string;
  title: string | null;
  channel_title: string | null;
  billing_status: string | null;
  created_at: string;
}

interface UserDownload {
  id: string;
  action: string;
  metadata: { analysisId?: string; format?: string } | null;
  created_at: string;
}

interface UserDetail {
  sessions: UserSession[];
  analyses: UserAnalysis[];
  downloads: UserDownload[];
}

function fmt(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Admin "Users" tab: who signed up, what they analyzed, what they
 * downloaded, and their session IPs. Built 2026-07-30 after an unexplained
 * pre-launch login had no standing way to answer those questions -- see
 * docs/for_sharing/Login-Investigation-Sattam-Majumdar.md for the
 * investigation that motivated this.
 */
export function UsersAdminClient() {
  const [users, setUsers] = useState<UserActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, UserDetail>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/admin/users')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { users: UserActivityRow[] }) => setUsers(data.users))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const toggleExpand = (userId: string) => {
    if (expandedId === userId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(userId);
    if (detail[userId] || detailLoading === userId) return;
    setDetailLoading(userId);
    fetch(`/api/admin/users/${userId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`);
        return res.json();
      })
      .then((data: UserDetail) => setDetail((prev) => ({ ...prev, [userId]: data })))
      .catch((err) => setDetailError((prev) => ({ ...prev, [userId]: err instanceof Error ? err.message : String(err) })))
      .finally(() => setDetailLoading(null));
  };

  if (error) {
    return <div className="p-4 rounded-xl bg-[var(--surface)] border border-[var(--warn)] text-[var(--warn)] text-xs font-mono">Failed to load users: {error}</div>;
  }

  if (!users) {
    return <div className="p-4 text-xs font-mono text-[var(--ink-muted)]">Loading users…</div>;
  }

  return (
    <div className="flex flex-col gap-3 font-mono text-xs">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[var(--ink-main)]">User Activity ({users.length})</h2>
        <p className="text-[10px] text-[var(--ink-muted)]">Signup, sessions (IP/UA), videos analyzed, reports downloaded</p>
      </div>

      <div className="rounded-xl border border-[var(--border-muted)] overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Signed up</th>
              <th className="px-3 py-2">Analyses</th>
              <th className="px-3 py-2">Last session</th>
              <th className="px-3 py-2">Last IP</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr
                  onClick={() => toggleExpand(u.id)}
                  className="border-t border-[var(--border-muted)] hover:bg-[rgb(26_31_43_/_0.4)] cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-[var(--ink-main)]">{u.name || u.email || u.id}</div>
                    <div className="text-[10px] text-[var(--ink-muted)]">{u.email}</div>
                  </td>
                  <td className="px-3 py-2 capitalize">{u.tier || '—'}</td>
                  <td className="px-3 py-2">{fmt(u.created_at)}</td>
                  <td className="px-3 py-2">{u.analyses_count}</td>
                  <td className="px-3 py-2">{fmt(u.last_session_at)}</td>
                  <td className="px-3 py-2">{u.last_session_ip || '—'}</td>
                  <td className="px-3 py-2 text-[var(--accent)]">{expandedId === u.id ? '▾' : '▸'}</td>
                </tr>
                {expandedId === u.id && (
                  <tr className="border-t border-[var(--border-muted)] bg-[rgb(11_14_20_/_0.5)]">
                    <td colSpan={7} className="px-3 py-3">
                      {detailLoading === u.id && <div className="text-[var(--ink-muted)]">Loading…</div>}
                      {detailError[u.id] && <div className="text-[var(--warn)]">{detailError[u.id]}</div>}
                      {detail[u.id] && (() => {
                        const d = detail[u.id]!;
                        return (
                        <div className="flex flex-col gap-4">
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] mb-1">
                              Sessions ({d.sessions.length})
                            </div>
                            {d.sessions.length === 0 ? (
                              <div className="text-[var(--ink-muted)]">No session records.</div>
                            ) : (
                              <ul className="flex flex-col gap-1">
                                {d.sessions.map((s) => (
                                  <li key={s.id} className="text-[var(--ink-secondary)]">
                                    {fmt(s.created_at)} · {s.ip || 'unknown IP'} · {s.user_agent || 'unknown agent'}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] mb-1">
                              Videos analyzed ({d.analyses.length})
                            </div>
                            {d.analyses.length === 0 ? (
                              <div className="text-[var(--ink-muted)]">None.</div>
                            ) : (
                              <ul className="flex flex-col gap-1">
                                {d.analyses.map((a) => (
                                  <li key={a.id} className="flex items-center gap-2">
                                    <span className="text-[var(--ink-secondary)]">{fmt(a.created_at)}</span>
                                    <span className="text-[var(--ink-main)]">{a.title || a.video_id}</span>
                                    <span className="text-[var(--ink-muted)]">[{a.billing_status}]</span>
                                    <a
                                      href={`/api/analyses/${a.id}/export?format=pdf&scope=full`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[var(--accent)] hover:underline"
                                    >
                                      view report ↗
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)] mb-1">
                              Reports downloaded ({d.downloads.length})
                            </div>
                            {d.downloads.length === 0 ? (
                              <div className="text-[var(--ink-muted)]">None recorded.</div>
                            ) : (
                              <ul className="flex flex-col gap-1">
                                {d.downloads.map((dl) => (
                                  <li key={dl.id} className="flex items-center gap-2">
                                    <span className="text-[var(--ink-secondary)]">{fmt(dl.created_at)}</span>
                                    <span className="text-[var(--ink-main)]">{dl.metadata?.format || 'unknown format'}</span>
                                    {dl.metadata?.analysisId && (
                                      <a
                                        href={`/api/analyses/${dl.metadata.analysisId}/export?format=pdf&scope=full`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[var(--accent)] hover:underline"
                                      >
                                        view report ↗
                                      </a>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                        );
                      })()}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
