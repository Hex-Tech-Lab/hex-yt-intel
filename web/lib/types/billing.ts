/**
 * BILLING ARCHITECTURE LAW (2026-06-08)
 * -------------------------------------
 * Standard interface for all payment providers (Paddle, Stripe, LemonSqueezy).
 * Allows switching providers with a single environment variable change.
 */

export type UserTier = 'free' | 'pro' | 'enterprise';

export type BillingProviderType = 'paddle' | 'stripe' | 'lemonsqueezy';

export type CheckoutPlan = 'light' | 'pro' | 'max';
export type CheckoutInterval = 'month' | 'year';

export interface CheckoutOptions {
  userId: string;
  userEmail: string;
  successUrl: string;
  cancelUrl: string;
  priceId: string;
}

export interface BillingProvider {
  type: BillingProviderType;
  createCheckout(options: CheckoutOptions): Promise<{ url: string | null; id: string | null }>;
  // Future-proofing for unified dashboard
  getInvoices?(customerId: string): Promise<any[]>;
  cancelSubscription?(subscriptionId: string): Promise<boolean>;
}

export type PlanTier = 'free' | 'founder' | 'pro';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'paused' | 'trialing';

export interface WebhookPayload {
  event_id: string;
  event_type: 'subscription.created' | 'subscription.updated' | 'subscription.canceled' | 'transaction.completed';
  occurred_at: string;
  data: {
    id: string;
    customer_id: string;
    status: SubscriptionStatus;
    custom_data?: {
      user_id?: string; [key: string]: any;
    };
    current_billing_period?: {
      starts_at: string;
      ends_at: string;
    };
    items?: Array<{
      price?: {
        custom_data?: {
          plan_tier?: PlanTier;
        };
      };
    }>;
    scheduled_change?: {
      action: 'cancel';
    } | null;
  };
}
