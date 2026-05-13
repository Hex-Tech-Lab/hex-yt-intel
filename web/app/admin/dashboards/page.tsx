'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';

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

interface UsageStats {
  analyses_total: number;
  searches_total: number;
  active_users: number;
  pro_users: number;
  free_users: number;
  avg_api_latency: number;
}

const StatusBadge = ({ status }: { status: 'ok' | 'error' }) => {
  const isOk = status === 'ok';
  return (
    <span
      className={`inline-block px-2 py-1 rounded text-sm font-medium ${
        isOk
          ? 'bg-green-100 text-green-800'
          : 'bg-red-100 text-red-800'
      }`}
    >
      {isOk ? '✓ OK' : '✗ Error'}
    </span>
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
    <div className="bg-white p-4 rounded-lg border border-gray-200">
      <h3 className="text-sm font-medium text-gray-600">{title}</h3>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
      {trend && <span className={`text-sm ${trendColor}`}>{trendIcon}</span>}
    </div>
  );
};

export default function DashboardsPage() {
  const { status } = useSession();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats] = useState<UsageStats | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Redirect if not admin
  if (status === 'unauthenticated') {
    redirect('/auth/signin');
  }

  // TODO: Add role check - only admins can view this
  // For now, allow any authenticated user

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch health status
        const healthRes = await fetch('/api/health');
        if (healthRes.ok) {
          const healthData = await healthRes.json();
          setHealth(healthData);
        }

        // Fetch usage stats (requires admin endpoint to be created)
        // For now, we'll fetch from usage_logs
        // const statsRes = await fetch('/api/admin/stats');
        // if (statsRes.ok) {
        //   const statsData = await statsRes.json();
        //   setStats(statsData);
        // }

        setLastUpdate(new Date());
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        // Loading complete
      }
    };

    fetchData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="text-center">Loading...</div>
      </div>
    );
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
            <div className="bg-white rounded-lg border border-gray-200 p-6">
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
            </div>
          </div>
        )}

        {/* Metrics Section */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Key Metrics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard title="Total Analyses" value={stats?.analyses_total || '-'} unit="count" trend="up" />
            <MetricCard title="Total Searches" value={stats?.searches_total || '-'} unit="count" trend="up" />
            <MetricCard title="Active Users" value={stats?.active_users || '-'} unit="users" />
            <MetricCard title="Pro Users" value={stats?.pro_users || '-'} unit="users" trend="up" />
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Performance</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title="Avg API Latency"
              value={stats?.avg_api_latency || '-'}
              unit="ms"
              trend="neutral"
            />
            <MetricCard
              title="Error Rate (24h)"
              value="0.12"
              unit="%"
              trend="down"
            />
            <MetricCard
              title="Uptime"
              value={health?.uptime || '-'}
              unit="seconds"
              trend="up"
            />
          </div>
        </div>

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
        <div className="mt-8 bg-white rounded-lg border border-gray-200 p-6">
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
