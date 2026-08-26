import * as Sentry from '@sentry/nextjs';
import * as crypto from 'crypto';
import { BillingPort } from '../ports/BillingPort';
import { getSupabaseServiceClient } from '../supabase';
import { paddle } from '../paddle';
import type { PlanTier, WebhookPayload } from '../types/billing';

export class PaddleBillingAdapter implements BillingPort {
  verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
    try {
      const parts = signatureHeader.split(';');
      const tsPart = parts.find((part: string) => part.startsWith('ts='));
      const h1Part = parts.find((part: string) => part.startsWith('h1='));

      if (!tsPart || !h1Part) return false;

      const ts = tsPart.split('=')[1];
      const h1 = h1Part.split('=')[1];
      
      if (!ts || !h1) return false;

      const signedPayload = `${ts}:${rawBody}`;
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(signedPayload);
      const expectedSignature = hmac.digest('hex');

      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      const receivedBuffer = Buffer.from(h1, 'hex');

      if (expectedBuffer.length !== receivedBuffer.length) return false;
      return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    } catch (verifyError: unknown) {
      console.error('[PaddleBillingAdapter] verifySignature error:', verifyError);
      return false;
    }
  }

  parseWebhookEvent(rawBody: string): WebhookPayload {
    return JSON.parse(rawBody) as WebhookPayload;
  }

  async processSubscriptionEvent(payload: WebhookPayload): Promise<{ success: boolean; error?: string }> {
    try {
      const supabase = getSupabaseServiceClient();
      
      const { data } = payload;
      const userId = data.custom_data?.user_id || data.custom_data?.userId;
      
      if (!userId) {
        // Not a SaaS subscription event or missing mapping
        return { success: false, error: 'Missing user_id in custom_data' };
      }

      // Authoritative plan tier from subscription custom data (or fallback to item price custom data)
      let planTier = data.custom_data?.plan_tier || data.custom_data?.planTier;
      if (!planTier && data.items && data.items.length > 0) {
        planTier = data.items[0]?.price?.custom_data?.plan_tier || 'free';
      }
      if (!planTier) planTier = 'free';

      const cancelAtPeriodEnd = data.scheduled_change?.action === 'cancel' || false;

      const { error } = await supabase
        .from('user_subscriptions')
        .upsert(
          {
            user_id: userId,
            paddle_customer_id: data.customer_id,
            paddle_subscription_id: data.id,
            plan_tier: planTier,
            status: data.status,
            current_period_start: data.current_billing_period?.starts_at || null,
            current_period_end: data.current_billing_period?.ends_at || null,
            cancel_at_period_end: cancelAtPeriodEnd,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'paddle_subscription_id' }
        );

      if (error) {
        Sentry.captureException(new Error(error.message), { tags: { operation: 'paddle-upsert' } });
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (processError) {
      const errorMsg = processError instanceof Error ? processError.message : String(processError);
      console.error('[PaddleBillingAdapter] processSubscriptionEvent error:', processError);
      Sentry.captureException(processError instanceof Error ? processError : new Error(errorMsg), { tags: { operation: 'paddle-process-event' } });
      return { success: false, error: errorMsg };
    }
  }


  async processTransactionEvent(payload: WebhookPayload): Promise<{ success: boolean; error?: string }> {
    try {
      if (payload.event_type !== 'transaction.completed') {
        return { success: true };
      }
      
      const supabase = getSupabaseServiceClient();
      const { data } = payload;
      const userId = data.custom_data?.user_id || data.custom_data?.userId;
      
      if (!userId) {
        return { success: false, error: 'Missing user_id in transaction custom_data' };
      }

      // Read authoritatively from transaction custom data
      let planTier = data.custom_data?.plan_tier || data.custom_data?.planTier;
      if (!planTier && data.items && data.items.length > 0) {
        planTier = data.items[0]?.price?.custom_data?.plan_tier || 'free';
      }
      
      if (!planTier || planTier === 'free') {
        return { success: true }; // Not a founder tier or special one-time
      }

      // Guard: only provision lifetime access when ALL items are one-time (interval === 'once').
      // Recurring Pro transactions also fire transaction.completed — those are handled by
      // subscription.created / subscription.updated; provisioning lifetime here would be wrong.
      const items: Array<{ price?: { billing_cycle?: { interval?: string } } }> = data.items ?? [];
      const isOneTime = items.length > 0 && items.every(
        (item) => item.price?.billing_cycle?.interval === 'once' || item.price?.billing_cycle == null
      );
      if (!isOneTime && data.subscription_id) {
        // This transaction belongs to a recurring subscription — skip lifetime provisioning.
        console.info('[PaddleBillingAdapter] transaction.completed is recurring (sub:', data.subscription_id, ') — skipping lifetime upsert');
        return { success: true };
      }

      // Insert or update user_subscriptions for this one-time purchase
      // (Using transaction ID as subscription ID for one-time provisioning)
      const { error } = await supabase
        .from('user_subscriptions')
        .upsert(
          {
            user_id: userId,
            paddle_customer_id: data.customer_id,
            paddle_subscription_id: 'tx_' + data.id,
            plan_tier: planTier,
            status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString(), // effectively lifetime
            cancel_at_period_end: false,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'paddle_subscription_id' }
        );

      if (error) {
        Sentry.captureException(new Error(error.message), { tags: { operation: 'paddle-upsert-tx' } });
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (processError) {
      const errorMsg = processError instanceof Error ? processError.message : String(processError);
      console.error('[PaddleBillingAdapter] processTransactionEvent error:', processError);
      Sentry.captureException(processError instanceof Error ? processError : new Error(errorMsg), { tags: { operation: 'paddle-process-tx-event' } });
      return { success: false, error: errorMsg };
    }
  }

  async createCheckoutSession(userId: string, email: string, planTier: PlanTier): Promise<{ checkoutUrl: string }> {
    if (planTier === 'free') {
      throw new Error('Cannot create checkout session for free tier');
    }
    if (planTier !== 'founder' && planTier !== 'pro') {
      throw new Error(`Invalid plan tier: ${String(planTier)}`);
    }

    let priceId = '';
    if (planTier === 'pro') {
      priceId = process.env.PADDLE_PRO_PRICE_ID || '';
      if (!priceId) {
        throw new Error('Paddle Pro price ID is not configured (PADDLE_PRO_PRICE_ID missing)');
      }
    } else if (planTier === 'founder') {
      priceId = process.env.PADDLE_FOUNDER_PRICE_ID || '';
      if (!priceId) {
        throw new Error('Paddle Founder price ID is not configured (PADDLE_FOUNDER_PRICE_ID missing)');
      }
    }

    try {
      const transaction = await paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        customData: {
          userId,
          planTier,
        },
      });

      const checkoutUrl = (transaction as any).checkout?.url || `https://checkout.paddle.com/checkout/tx_${transaction.id}`;
      return { checkoutUrl };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      Sentry.captureException(error instanceof Error ? error : new Error(errorMsg), {
        tags: { operation: 'paddle-create-checkout-session' },
        extra: { userId, email, planTier },
      });
      throw new Error(`Paddle checkout creation failed: ${errorMsg}`);
    }
  }
}
