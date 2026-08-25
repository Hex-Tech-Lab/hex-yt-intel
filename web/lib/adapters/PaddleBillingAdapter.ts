import * as crypto from 'crypto';
import { BillingPort } from '../ports/BillingPort';
import { WebhookPayload } from '../types/billing';
import { getSupabaseServiceClient } from '../supabase';
import * as Sentry from '@sentry/nextjs';

export class PaddleBillingAdapter implements BillingPort {
  verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean {
    try {
      const parts = signatureHeader.split(';');
      const tsPart = parts.find((p: string) => p.startsWith('ts='));
      const h1Part = parts.find((p: string) => p.startsWith('h1='));

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
    } catch (_e) {
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
      const userId = data.custom_data?.user_id;
      
      if (!userId) {
        // Not a SaaS subscription event or missing mapping
        return { success: false, error: 'Missing user_id in custom_data' };
      }

      let planTier = 'free';
      if (data.items && data.items.length > 0) {
        planTier = data.items[0]?.price?.custom_data?.plan_tier || 'free';
      }

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
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      Sentry.captureException(e instanceof Error ? e : new Error(errorMsg), { tags: { operation: 'paddle-process-event' } });
      return { success: false, error: errorMsg };
    }
  }
}
