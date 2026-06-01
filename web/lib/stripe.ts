import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

export const getStripe = (): Stripe => {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    stripeInstance = new Stripe(key, {
      apiVersion: '2024-04-10',
    });
  }
  return stripeInstance;
};

// For backwards compatibility, create a lazy getter
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const instance = getStripe();
    return (instance as any)[prop];
  },
});

export const STRIPE_PRICING = {
  free: {
    tier: 'free',
    price: 0,
    analysesPerMonth: 3,
    features: {
      analyses: true,
      search: false,
      export: false,
      apiAccess: false,
      historyRetention: 30,
    },
  },
  pro: {
    tier: 'pro',
    price: 900, // $9.00 in cents
    priceId: process.env.STRIPE_PRICE_ID_PRO || '',
    analysesPerMonth: null, // unlimited
    features: {
      analyses: true,
      search: true,
      export: true,
      apiAccess: true,
      historyRetention: 365,
    },
  },
} as const;

/**
 * Create Stripe customer for user
 */
export async function createStripeCustomer(email: string, name?: string): Promise<string> {
  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: {
      createdAt: new Date().toISOString(),
    },
  });
  return customer.id;
}

/**
 * Get or create Stripe customer
 */
export async function getOrCreateStripeCustomer(
  _userId: string,
  email: string,
  name?: string
): Promise<string> {
  // Search for existing customer
  const customers = await stripe.customers.list({
    email,
    limit: 1,
  });

  if (customers?.data && customers.data.length > 0) {
    const customerId = customers.data[0]?.id;
    if (customerId) {
      return customerId;
    }
  }

  // Create new customer
  return createStripeCustomer(email, name);
}

/**
 * Create checkout session for Pro upgrade
 */
export async function createCheckoutSession(
  customerId: string,
  successUrl: string,
  cancelUrl: string,
  userId?: string
): Promise<string> {
  if (!STRIPE_PRICING.pro.priceId) {
    throw new Error('STRIPE_PRICE_ID_PRO environment variable is required');
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [
      {
        price: STRIPE_PRICING.pro.priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: userId ? { userId } : undefined,
    subscription_data: {
      metadata: {
        upgradeAt: new Date().toISOString(),
      },
    },
  });

  return session.url || '';
}


/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(body, signature, secret);
}
