export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceClient, getSupabaseClient } from '@/lib/supabase';
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
export async function GET(request: NextRequest): Promise<NextResponse<AdminStats | { error: string }>> {
  try {
    // Dev bypass for CI testing
    const bypassSecret = request.headers.get('X-Hex-Test-Secret');
    const isProduction = process.env.NODE_ENV === 'production';
    const devBypassToken = process.env.DEV_BYPASS_TOKEN;

    const hasValidBypassToken = devBypassToken && bypassSecret === devBypassToken;
    const shouldAttemptBypass = !isProduction && hasValidBypassToken;

    let userId: string;

    if (shouldAttemptBypass) {
      userId = 'da4381c6-f774-4c99-8f04-2c1c9e27d1fb'; // default to admin user for test bypass if needed
    } else {
      // 1. Auth check - must be authenticated using unified Supabase client
      const supabase = await getSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      userId = user.id;
    }

    // 2. Initialize Supabase early for role check
    const supabase = getSupabaseServiceClient();

    // 3. Role check - bypass for dev, otherwise query database
    if (!shouldAttemptBypass) {
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
        .map((log: any) => {
          try {
            return parseInt((log.metadata as any)?.latency_ms || '0');
          } catch {
            return 0;
          }
        })
        .filter((l: number) => l > 0);

      if (latencies.length > 0) {
        stats.avg_api_latency = Math.round(
          latencies.reduce((a: number, b: number) => a + b, 0) / latencies.length
        );
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

    stats.error_rate_24h =
      totalEvents && totalEvents > 0 ? ((errorCount || 0) / totalEvents) * 100 : 0;

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
      activeUsersData?.map((log: any) => log.user_id) || []
    ).size;
    stats.retention_7d =
      stats.active_users > 0 ? Math.round((uniqueActiveUsers / stats.active_users) * 100) : 0;

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
