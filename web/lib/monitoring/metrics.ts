/**
 * Metrics collection for hex-yt-intel
 * Tracks business and operational metrics
 * Reported to Sentry and stored locally for dashboards
 */

import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';

export interface Metric {
  name: string;
  value: number;
  unit: string;
  tags: Record<string, string>;
  timestamp: Date;
}

// In-memory metric store (local aggregation before sending to Sentry)
const metricsBuffer: Metric[] = [];
const MAX_BUFFER_SIZE = 1000;

/**
 * Record a metric event
 */
export function recordMetric(
  name: string,
  value: number,
  unit = 'none',
  tags: Record<string, string> = {}
): void {
  const metric: Metric = {
    name,
    value,
    unit,
    tags,
    timestamp: new Date(),
  };

  metricsBuffer.push(metric);

  // Send to Sentry immediately for critical metrics
  if (name.includes('error') || name.includes('latency')) {
    Sentry.captureMessage(`Metric: ${name}=${value}${unit}`, 'info');
  }

  // Flush buffer if too large
  if (metricsBuffer.length >= MAX_BUFFER_SIZE) {
    flushMetrics().catch(console.error);
  }
}

/**
 * Flush metrics buffer to storage/monitoring system
 */
export async function flushMetrics(): Promise<void> {
  if (metricsBuffer.length === 0) return;

  try {
    const metrics = metricsBuffer.splice(0, metricsBuffer.length);

    // Store in Supabase for historical analysis
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Insert as usage logs (reuse existing table)
    for (const metric of metrics) {
      await supabase.from('usage_logs').insert({
        action: `metric_${metric.name}`,
        metadata: {
          value: metric.value,
          unit: metric.unit,
          tags: metric.tags,
        },
        created_at: metric.timestamp.toISOString(),
      });
    }
  } catch (error) {
    console.error('[flushMetrics] Error:', error);
    // Keep metrics in buffer on error
    metricsBuffer.unshift(...metricsBuffer);
  }
}

/**
 * Track API endpoint metrics
 */
export function trackEndpointMetrics(
  endpoint: string,
  method: string,
  statusCode: number,
  latency: number,
  userId?: string,
  tier?: string
): void {
  const tags: Record<string, string> = {
    endpoint,
    method,
    status: String(statusCode),
  };

  if (userId) tags.user_id = userId;
  if (tier) tags.tier = tier;

  recordMetric('api_request', 1, 'count', tags);
  recordMetric('api_latency', latency, 'ms', tags);

  if (statusCode >= 500) {
    recordMetric('api_error_5xx', 1, 'count', tags);
  } else if (statusCode >= 400) {
    recordMetric('api_error_4xx', 1, 'count', tags);
  }
}

/**
 * Track analysis creation
 */
export function trackAnalysisCreated(
  userId: string,
  tier: string,
  latency: number
): void {
  recordMetric('analysis_created', 1, 'count', { user_id: userId, tier });
  recordMetric('analysis_latency', latency, 'ms', { user_id: userId, tier });
}

/**
 * Track search operation
 */
export function trackSearch(
  userId: string,
  tier: string,
  latency: number,
  resultCount: number
): void {
  recordMetric('search_executed', 1, 'count', { user_id: userId, tier });
  recordMetric('search_latency', latency, 'ms', { user_id: userId, tier });
  recordMetric('search_results', resultCount, 'count', { user_id: userId, tier });
}

/**
 * Track embedding generation
 */
export function trackEmbedding(
  userId: string,
  _analysisId: string,
  tokensUsed: number,
  costUsd: number
): void {
  recordMetric('embedding_generated', 1, 'count', { user_id: userId });
  recordMetric('embedding_tokens', tokensUsed, 'tokens', { user_id: userId });
  recordMetric('embedding_cost', costUsd, 'usd', { user_id: userId });
}

/**
 * Track external service call
 */
export function trackExternalServiceCall(
  service: string,
  operation: string,
  statusCode: number,
  latency: number
): void {
  const tags = { service, operation, status: String(statusCode) };

  recordMetric('external_call', 1, 'count', tags);
  recordMetric('external_latency', latency, 'ms', tags);

  if (statusCode >= 400) {
    recordMetric('external_error', 1, 'count', tags);
  }
}

/**
 * Track quota/usage
 */
export function trackUsage(
  userId: string,
  tier: string,
  action: string,
  amount = 1
): void {
  recordMetric(`usage_${action}`, amount, 'count', { user_id: userId, tier });
}

/**
 * Track Stripe transaction
 */
export function trackStripeTransaction(
  userId: string,
  amount: number,
  currency: string,
  status: string
): void {
  const tags = { user_id: userId, status, currency };

  recordMetric('stripe_transaction', 1, 'count', tags);
  recordMetric('stripe_amount', amount, currency.toLowerCase(), tags);
}

/**
 * Get metrics summary for dashboards
 */
export function getMetricsSummary(
  minutes = 60
): { [key: string]: { count: number; sum: number; avg: number } } {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000);
  const recentMetrics = metricsBuffer.filter((m) => m.timestamp > cutoff);

  const summary: { [key: string]: { count: number; sum: number; avg: number } } = {};

  for (const metric of recentMetrics) {
    if (!summary[metric.name]) {
      summary[metric.name] = { count: 0, sum: 0, avg: 0 };
    }

    const summaryEntry = summary[metric.name];
    if (summaryEntry) {
      summaryEntry.count++;
      summaryEntry.sum += metric.value;
      summaryEntry.avg = summaryEntry.sum / summaryEntry.count;
    }
  }

  return summary;
}

/**
 * Clear metrics buffer
 */
export function clearMetrics(): void {
  metricsBuffer.length = 0;
}
