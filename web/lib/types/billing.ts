/**
 * BILLING ARCHITECTURE LAW (2026-06-08)
 * -------------------------------------
 * Standard interface for all payment providers (Paddle, Stripe, LemonSqueezy).
 * Allows switching providers with a single environment variable change.
 */

export type UserTier = 'free' | 'pro' | 'enterprise';

export type BillingProviderType = 'paddle' | 'stripe' | 'lemonsqueezy';

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
