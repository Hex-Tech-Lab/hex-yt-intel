import { BillingProvider, BillingProviderType, CheckoutOptions } from './types/billing';
import { paddle } from './paddle';
import * as stripeLib from './stripe'; // Existing stripe lib

/**
 * Paddle implementation of the BillingProvider interface
 */
const PaddleProvider: BillingProvider = {
  type: 'paddle',
  async createCheckout(options: CheckoutOptions) {
    try {
      const transaction = await paddle.transactions.create({
        items: [{ priceId: options.priceId, quantity: 1 }],
        customData: { userId: options.userId },
      });
      // Paddle checkout URLs are typically generated via the JS SDK or a specific link
      // For now we return the ID which the frontend can use to open the checkout
      return { url: null, id: transaction.id };
    } catch (error) {
      console.error('[BillingFactory] Paddle checkout failed:', error);
      return { url: null, id: null };
    }
  }
};

/**
 * Stripe implementation of the BillingProvider interface
 */
const StripeProvider: BillingProvider = {
  type: 'stripe',
  async createCheckout(options: CheckoutOptions) {
    try {
      // Reusing existing Stripe logic
      const customerId = await stripeLib.getOrCreateStripeCustomer(options.userId, options.userEmail);
      const url = await stripeLib.createCheckoutSession(customerId, options.successUrl, options.cancelUrl, options.userId);
      return { url, id: null };
    } catch (error) {
      console.error('[BillingFactory] Stripe checkout failed:', error);
      return { url: null, id: null };
    }
  }
};

/**
 * The Switch: Determines which provider to use
 */
export function getBillingProvider(): BillingProvider {
  const provider = (process.env.ACTIVE_BILLING_PROVIDER || 'paddle') as BillingProviderType;
  
  switch (provider) {
    case 'stripe':
      return StripeProvider;
    case 'paddle':
    default:
      return PaddleProvider;
  }
}
