export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSupabaseServiceClient, getSupabaseClientWithAuth } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

interface AdminStats {
  analyses_total: number;
  searches_total: number;
  active_users: number;
  pro_users: number;
  free_users: number;
  avg_api_latency: number;
  error_rate_24h: number;
  total_revenue: number;
  retention_7d: number;
  created_at: string;
}

/**
 * Admin-only endpoint for observability stats
 * Returns aggregated usage and performance metrics
 */
export async function GET(): Promise<NextResponse<AdminStats | { error: string }>> {
  try {
    // 1. Auth check - must be authenticated using unified Supabase client
    const authClient = await getSupabaseClientWithAuth();
    const { data: { user } } = await authClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const userId = user.id;

    // 2. Initialize Supabase service client for data queries
    const supabase = getSupabaseServiceClient();

    // 3. Role check - verify user is admin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (userError) {
      Sentry.captureException(userError, {
        tags: { operation: 'admin_role_check' },
        contexts: { admin: { userId, operation: 'role_check' } }
      });
      return NextResponse.json(
        { error: 'Failed to verify admin status' },
        { status: 500 }
      );
    }

    if (!userData || userData.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Fetch stats from database
    const stats: AdminStats = {
      analyses_total: 0,
      searches_total: 0,
      active_users: 0,
      pro_users: 0,
      free_users: 0,
      avg_api_latency: 0,
      error_rate_24h: 0,
      total_revenue: 0,
      retention_7d: 0,
      created_at: new Date().toISOString(),
    };

    // Get total analyses
    const { count: analysesCount } = await supabase
      .from('analyses')
      .select('*', { count: 'exact', head: true });
    stats.analyses_total = analysesCount || 0;

    // Get total searches
    const { count: searchCount } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'search_executed');
    stats.searches_total = searchCount || 0;

    // Get user counts
    const { count: totalUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    stats.active_users = totalUsers || 0;

    // Get Pro/Free split
    const { count: proCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'pro');
    stats.pro_users = proCount || 0;
    stats.free_users = (totalUsers || 0) - stats.pro_users;

    // Get average API latency from usage logs (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: latencyData } = await supabase
      .from('usage_logs')
      .select('metadata')
      .gte('created_at', oneDayAgo)
      .filter('metadata->>latency_ms', 'neq', 'null');

    if (latencyData && latencyData.length > 0) {
      const latencies = latencyData
        .map((log: { metadata: Record<string, unknown> | null }) => {
          try {
            return parseInt(String(log.metadata?.latency_ms ?? '0'), 10);
          } catch {
            return 0;
          }
        })
        .filter((l: number) => l > 0);

      // Explicit division-by-zero protection for average API latency
      if (latencies.length > 0) {
        const sum = latencies.reduce((a: number, b: number) => a + b, 0);
        stats.avg_api_latency = Math.round(sum / latencies.length);
      } else {
        stats.avg_api_latency = 0;
      }
    }

    // Get error rate (last 24 hours) - from Sentry would be better
    // For now, estimate from database
    const { count: errorCount } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneDayAgo)
      .filter('action', 'ilike', '%error%');

    const { count: totalEvents } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', oneDayAgo);

    // Explicit division-by-zero protection for error rate
    const eventCount = totalEvents ?? 0;
    if (eventCount > 0) {
      stats.error_rate_24h = ((errorCount ?? 0) / eventCount) * 100;
    } else {
      stats.error_rate_24h = 0;
    }

    // Get revenue (from stripe_events or manual tracking)
    // For now, return 0 - implement if billing data is available
    stats.total_revenue = 0;

    // Get 7-day retention (users active in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: activeUsersData } = await supabase
      .from('usage_logs')
      .select('user_id', { head: false })
      .gte('created_at', sevenDaysAgo);

    const uniqueActiveUsers = new Set(
      activeUsersData?.map((log: { user_id: string }) => log.user_id) || []
    ).size;

    // Explicit division-by-zero protection for retention
    const userCount = stats.active_users;
    if (userCount > 0) {
      stats.retention_7d = Math.round((uniqueActiveUsers / userCount) * 100);
    } else {
      stats.retention_7d = 0;
    }

    // Log access to admin stats
    await supabase.from('usage_logs').insert({
      user_id: userId,
      action: 'admin_stats_viewed',
      metadata: {
        timestamp: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json(stats);
  } catch (error) {
    console.error('[/api/admin/stats] Error:', error);
    Sentry.captureException(error, {
      contexts: {
        api: {
          endpoint: '/api/admin/stats',
          method: 'GET',
        },
      },
      tags: {
        endpoint: 'admin_stats',
      },
    });

    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}