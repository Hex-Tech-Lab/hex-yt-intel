/**
 * BILLING ARCHITECTURE LAW (2026-06-08)
 * -------------------------------------
 * Standard interface for all payment providers (Paddle, Stripe, LemonSqueezy).
 * Allows switching providers with a single environment variable change.
 */

/**
 * Canonical customer-facing tier vocabulary (2026-09-19 unification, STEP 1).
 * Product truth: Free / Light / Pro / Max. `enterprise` is kept — the DB
 * allows it and admin-granted accounts may carry it. `admin`/`casual`/`core`
 * /`power` exist ONLY in retention_policies.tier (DB-only, step 2 scope).
 */
export const USER_TIERS = ['free', 'light', 'pro', 'max', 'enterprise'] as const;

export type UserTier = typeof USER_TIERS[number];

/**
 * Fail-closed tier normalization (PR #325 P1 #3). Runtime code previously
 * treated any non-`free` string as paid (`tier !== 'free'`) and cast raw DB
 * values with `as UserTier`, so a legacy/misspelled value ('founder',
 * 'PRO', '', null) unlocked paid features. Any value not exactly one of
 * USER_TIERS becomes 'free'. Case-sensitive, no trimming.
 */
export function normalizeUserTier(value: unknown): UserTier {
  return typeof value === 'string' && (USER_TIERS as readonly string[]).includes(value)
    ? (value as UserTier)
    : 'free';
}

/** Paid means exactly light | pro | max | enterprise. */
export function isPaidTier(tier: UserTier): boolean {
  return tier !== 'free';
}

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

export type PlanTier = 'free' | 'founder' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'paused' | 'trialing';

export interface WebhookPayload {
  event_id: string;
  event_type: 'subscription.created' | 'subscription.updated' | 'subscription.canceled' | 'transaction.completed';
  occurred_at: string;
  data: {
    id: string;
    customer_id: string;
    status: SubscriptionStatus;
    /** Present on transaction.completed when the transaction is a recurring subscription renewal. */
    subscription_id?: string;
    custom_data?: {
      user_id?: string; userId?: string; [key: string]: unknown;
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
        billing_cycle?: {
          interval?: 'once' | 'day' | 'week' | 'month' | 'year';
          frequency?: number;
        };
      };
    }>;
    scheduled_change?: {
      action: 'cancel';
    } | null;
  };
}
