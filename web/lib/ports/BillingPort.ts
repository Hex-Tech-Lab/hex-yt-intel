import type { WebhookPayload } from '../types/billing';

/** Plans a checkout session can be created for (never 'free'; excludes
 * 'enterprise' -- PlanTier members that PaddleBillingAdapter cannot
 * actually check out, per Cubic review 2026-09-24). */
export type PaidPlanTier = 'founder' | 'light' | 'pro' | 'max';

export interface BillingPort {
  verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean;
  parseWebhookEvent(rawBody: string): WebhookPayload;
  processSubscriptionEvent(payload: WebhookPayload): Promise<{ success: boolean; error?: string }>;
  processTransactionEvent(payload: WebhookPayload): Promise<{ success: boolean; error?: string }>;
  createCheckoutSession(userId: string, email: string, planTier: PaidPlanTier, interval?: 'once' | 'month' | 'year'): Promise<{ checkoutUrl: string }>;
}
