/**
 * API Routes: HEX-YT-INTEL Monetization
 * 
 * All routes are stateless adapters. No internal state management.
 * Data flows: Request → validation → Stripe API → response.
 * 
 * Environment vars required:
 * - STRIPE_SECRET_KEY
 * - STRIPE_PUBLISHABLE_KEY
 * - STRIPE_WEBHOOK_SECRET
 * - APP_BASE_URL (for redirect_url)
 */

import Stripe from "stripe";
import express from "express";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

/* ============================================================================
   VALIDATION HELPERS
   ========================================================================= */

const validateEmail = (email) => {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed !== email || /\s/.test(trimmed) || trimmed.length > 255) return false;
  // Conservative regex for valid email format: non-empty local part, exactly one '@', 
  // domain with at least one dot and valid characters.
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(trimmed);
};
const validatePromoCode = (code) => /^[A-Z0-9]{6,12}$/.test(code);

/* ============================================================================
   GET /api/prices
   Fetch all available plans, intervals, add-ons. Used to populate UI.
   ========================================================================= */

router.get("/api/prices", async (req, res) => {
  try {
    const prices = await stripe.prices.list({
      expand: ["data.product"],
      limit: 100,
    });

    const plans = prices.data
      .filter((p) => p.product.metadata?.type === "plan")
      .map((p) => ({
        id: p.id,
        productId: p.product.id,
        name: p.product.name,
        description: p.product.description,
        amount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring?.interval || "one_time",
        metadata: p.product.metadata,
      }));

    const addons = prices.data
      .filter((p) => p.product.metadata?.type === "addon")
      .map((p) => ({
        id: p.id,
        productId: p.product.id,
        name: p.product.name,
        description: p.product.description,
        amount: p.unit_amount,
        currency: p.currency,
      }));

    res.json({ plans, addons, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================================
   POST /api/checkout
   Create a Stripe Checkout session.
   
   Body:
   {
     email: string,
     planPriceId: string,
     addonPriceIds: string[],
     promoCode?: string,
     successUrl: string,
     cancelUrl: string
   }
   ========================================================================= */

router.post("/api/checkout", async (req, res) => {
  try {
    const { email, planPriceId, addonPriceIds = [], promoCode, successUrl, cancelUrl } = req.body;

    // Validate
    if (!email || !validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    if (!planPriceId) {
      return res.status(400).json({ error: "Plan required" });
    }

    // Build line items
    const lineItems = [
      { price: planPriceId, quantity: 1 },
      ...addonPriceIds.map((id) => ({ price: id, quantity: 1 })),
    ];

    // Validate promo if provided
    let discounts = [];
    if (promoCode) {
      if (!validatePromoCode(promoCode)) {
        return res.status(400).json({ error: "Invalid promo code format" });
      }
      // Fetch coupon from Stripe (or custom DB)
      try {
        const coupon = await stripe.coupons.retrieve(promoCode);
        if (coupon.valid) {
          discounts = [{ coupon: promoCode }];
        } else {
          return res.status(400).json({ error: "Promo code expired or invalid" });
        }
      } catch (err) {
        return res.status(400).json({ error: "Promo code not found" });
      }
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: email,
      line_items: lineItems,
      discounts: discounts,
      success_url: successUrl || `${process.env.APP_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.APP_BASE_URL}/billing`,
      metadata: {
        email,
        promoCode: promoCode || null,
      },
    });

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================================
   POST /api/gift-card/create
   Generate a gift card (coupon + tracking).
   
   Body:
   {
     amount: number (cents),
     expiresInDays: number,
     createdBy: string
   }
   ========================================================================= */

router.post("/api/gift-card/create", async (req, res) => {
  try {
    const { amount, expiresInDays = 30, createdBy } = req.body;

    if (!amount || amount < 500) {
      return res.status(400).json({ error: "Minimum gift card is $5" });
    }

    // Generate unique code
    const code = `GC${Date.now().toString(36).toUpperCase()}`;

    // Create coupon in Stripe
    const coupon = await stripe.coupons.create({
      amount_off: amount,
      currency: "usd",
      duration: "once",
      redeem_by: Math.floor((Date.now() + expiresInDays * 24 * 60 * 60 * 1000) / 1000),
      metadata: { type: "gift_card", createdBy },
    });

    // Store in DB (pseudo-code)
    // await GiftCard.create({ code, stripeCouponId: coupon.id, amount, expiresAt: ... })

    res.json({
      code: coupon.id,
      amount,
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      url: `${process.env.APP_BASE_URL}/redeem?code=${coupon.id}`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================================
   POST /api/referral/generate
   Create a referral code and link.
   
   Body:
   {
     userId: string,
     rewardAmount: number (cents)
   }
   ========================================================================= */

router.post("/api/referral/generate", async (req, res) => {
  try {
    const { userId, rewardAmount = 1000 } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }

    const code = `REF${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Store in DB (pseudo-code)
    // await Referral.create({ code, userId, rewardAmount, status: 'pending' })

    res.json({
      code,
      rewardAmount,
      url: `${process.env.APP_BASE_URL}/join?ref=${code}`,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================================
   POST /api/referral/redeem
   Apply a referral code to a new subscription.
   
   Body:
   {
     referralCode: string,
     newCustomerEmail: string
   }
   ========================================================================= */

router.post("/api/referral/redeem", async (req, res) => {
  try {
    const { referralCode, newCustomerEmail } = req.body;

    if (!referralCode || !newCustomerEmail) {
      return res.status(400).json({ error: "Code and email required" });
    }

    // Lookup referral in DB (pseudo-code)
    // const referral = await Referral.findOne({ code: referralCode })
    // if (!referral || referral.status !== 'pending') throw error

    // Create discount coupon for referrer's account
    // (E.g., $10 credit on next invoice)

    res.json({
      success: true,
      message: "Referral applied. Your friend gets 20% off their first month.",
      referrerReward: "Reward pending after subscription confirmation",
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/* ============================================================================
   GET /api/billing-portal
   Create a Stripe Billing Portal session and redirect.
   
   Query:
   - customerId: string (Stripe customer ID)
   - returnUrl: string (where to go after)
   ========================================================================= */

router.get("/api/billing-portal", async (req, res) => {
  try {
    const { customerId, returnUrl } = req.query;

    if (!customerId) {
      return res.status(400).json({ error: "Customer ID required" });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || `${process.env.APP_BASE_URL}/billing`,
    });

    res.json({ url: portalSession.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ============================================================================
   POST /api/webhook
   Stripe webhook handler.
   Listens for: customer.subscription.created, customer.subscription.updated,
                charge.succeeded, charge.refunded
   ========================================================================= */

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

router.post("/api/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (error) {
    return res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        // Update user subscription in DB
        // await User.updateOne({ stripeCustomerId: subscription.customer }, { subscription })
        console.log(`[WEBHOOK] Subscription ${subscription.id} updated`);
        break;
      }

      case "charge.succeeded": {
        const charge = event.data.object;
        // Log payment success
        console.log(`[WEBHOOK] Charge succeeded: ${charge.id}`);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        // Handle refund
        console.log(`[WEBHOOK] Charge refunded: ${charge.id}`);
        break;
      }

      case "coupon.deleted": {
        const coupon = event.data.object;
        // Mark promo as expired in DB
        console.log(`[WEBHOOK] Coupon deleted: ${coupon.id}`);
        break;
      }

      default:
        console.log(`[WEBHOOK] Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
