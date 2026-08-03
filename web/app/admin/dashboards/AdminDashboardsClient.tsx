'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import { Badge, Card, Spinner } from '@astryxdesign/core';

import { useAuth } from '@/hooks/useAuth';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  components: {
    database: { status: 'ok' | 'error'; latency?: number; error?: string };
    sentry: { status: 'ok' | 'error'; dsn_configured: boolean };
    worker: { status: 'ok' | 'error'; latency?: number; error?: string };
  };
  uptime?: number;
}

const StatusBadge = ({ status }: { status: 'ok' | 'error' }) => {
  const isOk = status === 'ok';
  return (
    <Badge
      variant={isOk ? 'success' : 'error'}
      label={isOk ? '✓ OK' : '✗ Error'}
    />
  );
};

const MetricCard = ({
  title,
  value,
  unit,
  trend,
}: {
  title: string;
  value: number | string;
  unit: string;
  trend?: 'up' | 'down' | 'neutral';
}) => {
  const trendColor =
    trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-600';
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';

  return (
    <Card padding={4}>
      <h3 className="text-sm font-medium text-gray-600">{title}</h3>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
      {trend && <span className={`text-sm ${trendColor}`}>{trendIcon}</span>}
    </Card>
  );
};

export function AdminDashboardsClient() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/signin');
    }
  }, [isAuthenticated, authLoading, router]);

  // Admin role is enforced server-side by the parent page.tsx gate (redirects
  // non-admins before this client ever renders). The useAuth redirect above is
  // a secondary client-side guard against mid-session expiry.

  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchData = async () => {
      try {
        // Fetch health status
        const healthRes = await fetch('/api/health');
        if (healthRes.ok) {
          const healthData = await healthRes.json();
          setHealth(healthData);
        }

        setLastUpdate(new Date());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[admin-dashboards]', { message, url: '/api/health' });
        Sentry.captureException(error, {
          contexts: { admin: { operation: 'fetchDashboardData' } },
        });
      } finally {
        // Loading complete
      }
    };

    fetchData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Observability Dashboards</h1>
          <p className="text-gray-600 mt-2">
            System health, performance metrics, and usage analytics
          </p>
          {lastUpdate && (
            <p className="text-sm text-gray-500 mt-2">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Health Status Section */}
        {health && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">System Health</h2>
            <Card padding={6}>
              <div className="mb-4">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-medium">Overall Status</span>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      health.status === 'healthy'
                        ? 'bg-green-100 text-green-800'
                        : health.status === 'degraded'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {health.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Database */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Database</span>
                    <StatusBadge status={health.components.database.status} />
                  </div>
                  {health.components.database.latency && (
                    <p className="text-sm text-gray-600">
                      Latency: {health.components.database.latency}ms
                    </p>
                  )}
                  {health.components.database.error && (
                    <p className="text-sm text-red-600">{health.components.database.error}</p>
                  )}
                </div>

                {/* Worker */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Cloudflare Worker</span>
                    <StatusBadge status={health.components.worker.status} />
                  </div>
                  {health.components.worker.latency && (
                    <p className="text-sm text-gray-600">
                      Latency: {health.components.worker.latency}ms
                    </p>
                  )}
                  {health.components.worker.error && (
                    <p className="text-sm text-red-600">{health.components.worker.error}</p>
                  )}
                </div>

                {/* Sentry */}
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Sentry</span>
                    <StatusBadge status={health.components.sentry.status} />
                  </div>
                  <p className="text-sm text-gray-600">
                    DSN: {health.components.sentry.dsn_configured ? 'Configured' : 'Missing'}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Performance — only cards backed by the live /api/health payload are
            shown. Aggregate usage metrics (analyses/searches/users/latency) are
            intentionally omitted until a real /api/admin/stats endpoint exists;
            we never render hollow '-' placeholders or hardcoded figures
            (AGENTS.md: no empty-state fake dashboards). */}
        {health?.uptime != null && (
          <div className="mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Performance</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard title="Uptime" value={health.uptime} unit="seconds" trend="up" />
            </div>
          </div>
        )}

        {/* Links to Sentry */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-medium text-blue-900 mb-2">External Dashboards</h3>
          <ul className="space-y-2 text-sm">
            <li>
              <a
                href={`https://sentry.io/organizations/hex-tech-lab/projects/`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-900 underline"
              >
                Sentry Dashboards (All Events, Issues, Performance)
              </a>
            </li>
            <li>
              <a
                href={`https://vercel.com/hex-tech-lab/hex-yt-intel/monitoring`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-900 underline"
              >
                Vercel Analytics (Edge Logs, Deployments)
              </a>
            </li>
            <li>
              <a
                href={`https://app.supabase.com/project/_/editor`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-900 underline"
              >
                Supabase Analytics (Database Queries, Usage)
              </a>
            </li>
          </ul>
        </div>

        {/* Troubleshooting Section */}
        <div className="mt-8 bg-surface rounded-lg border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Troubleshooting</h3>
          <details className="mb-4 cursor-pointer">
            <summary className="font-medium text-gray-900">What do I do if a component shows &quot;Error&quot;?</summary>
            <div className="mt-2 text-sm text-gray-600 space-y-2">
              <p>1. Check the component details for error message</p>
              <p>2. For Database: Check Supabase project status and connection limits</p>
              <p>3. For Worker: Verify Cloudflare deployment and check worker logs</p>
              <p>4. For Sentry: Verify DSN is configured in .env.local</p>
            </div>
          </details>
          <details className="mb-4 cursor-pointer">
            <summary className="font-medium text-gray-900">How to read Sentry dashboards?</summary>
            <div className="mt-2 text-sm text-gray-600 space-y-2">
              <p>- Issues: Grouped errors sorted by frequency (top left)</p>
              <p>- Performance: Slowest transactions and problematic endpoints</p>
              <p>- Releases: Track errors by code version</p>
              <p>- User Feedback: View session replays for errors</p>
            </div>
          </details>
          <details className="mb-4 cursor-pointer">
            <summary className="font-medium text-gray-900">How to set up Slack alerts?</summary>
            <div className="mt-2 text-sm text-gray-600 space-y-2">
              <p>1. Go to Sentry settings → Integrations</p>
              <p>2. Add Slack workspace</p>
              <p>3. Create alert rules (Settings → Alert Rules)</p>
              <p>4. Set conditions: Error rate &gt; 1%, P95 latency &gt; 2s, etc.</p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
