import * as Sentry from '@sentry/nextjs';

import * as crypto from 'crypto';
import { z } from 'zod';

import { BillingPort } from '@/lib/ports/BillingPort';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { paddle } from '@/lib/paddle';
import { resolvePriceId, resolveUserTierForPriceId } from '@/lib/config/pricing';
import { SupabaseBillingAdapter } from './SupabaseBillingAdapter';

import type { PlanTier, UserTier, WebhookPayload } from '@/lib/types/billing';

export const WebhookCustomDataSchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const raw = val as Record<string, unknown>;
    const rawUserId = raw.user_id ?? raw.userId;
    const rawPlanTier = raw.plan_tier ?? raw.planTier;
    const normalizedUserId = typeof rawUserId === "string" && rawUserId.trim() !== "" ? rawUserId.trim() : undefined;
    const normalizedPlanTier = typeof rawPlanTier === "string" && rawPlanTier.trim() !== "" ? rawPlanTier.trim().toLowerCase() : undefined;
    return {
      ...raw,
      ...(normalizedUserId ? { userId: normalizedUserId, user_id: normalizedUserId } : {}),
      ...(normalizedPlanTier ? { planTier: normalizedPlanTier, plan_tier: normalizedPlanTier } : {}),
    };
  },
  z.object({
    userId: z.string().optional(),
    user_id: z.string().optional(),
    planTier: z.string().optional(),
    plan_tier: z.string().optional(),
  }).passthrough().nullable().optional()
);

export const PaddleWebhookSchema = z.object({
  event_id: z.string().optional(),
  event_type: z.string(),
  occurred_at: z.string().optional(),
  data: z.object({
    id: z.string().optional(),
    customer_id: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    custom_data: WebhookCustomDataSchema,
    items: z.array(z.object({
      price: z.object({
        id: z.string().optional(),
        custom_data: WebhookCustomDataSchema,
      }).passthrough().nullable().optional(),
    }).passthrough()).nullable().optional(),
    scheduled_change: z.object({
      action: z.string().nullable().optional(),
      effective_at: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
    current_billing_period: z.object({
      ends_at: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
  }).passthrough(),
}).passthrough();

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

  async processSubscriptionEvent(rawPayload: WebhookPayload): Promise<{ success: boolean; error?: string }> {
    try {
      const parsed = PaddleWebhookSchema.safeParse(rawPayload);
      if (!parsed.success) {
        console.warn('[PaddleBillingAdapter] Schema validation dropped payload', parsed.error.issues);
        Sentry.captureMessage(`Validation dropped payload at ${'PaddleBillingAdapter'}`, {
          level: "warning",
          extra: {
            boundary: 'PaddleBillingAdapter',
            issueCount: parsed.error.issues.length,
            issuePaths: parsed.error.issues.map((i: any) => `${i.path.join(".")}: ${i.code}`),
          },
        });
        return { success: false, error: 'Invalid webhook payload schema' };
      }
      const payload = parsed.data as any;
      const supabase = getSupabaseServiceClient();
      
      const { data } = payload;
      const userId = data.custom_data?.userId;
      
      if (!userId) {
        // Not a SaaS subscription event or missing mapping
        Sentry.captureMessage('PaddleBillingAdapter: Missing user_id in custom_data', { level: 'warning', extra: { event_type: payload?.event_type } });
        return { success: false, error: 'Missing user_id in custom_data' };
      }

      // Tier from the shared price-ID -> UserTier mapping (single source,
      // 2026-09-19; custom_data fallback removed 2026-09-24 round 2 — an
      // unrecognised price must never re-derive a tier from custom_data
      // plan strings: forged/unmapped price carrying planTier "max" would
      // otherwise grant Max). Fails CLOSED — null ⇒ tier unchanged.
      // Only statuses that are actually being billed grant a paid tier
      // (CodeRabbit review, 2026-09-24): `paused`/`past_due` generate no
      // billing while a subscription is paused, so they must not keep paid
      // quotas alive. No explicit past_due grace policy exists yet -- if
      // one is implemented, add 'past_due' here and document it.
      const ENTITLED_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing']);
      const isCanceled = !ENTITLED_STATUSES.has(data.status);
      const priceId: string | null | undefined = data.items?.[0]?.price?.id;
      let effectiveUserTier: UserTier;
      if (isCanceled) {
        effectiveUserTier = 'free';
      } else {
        const resolvedTier: UserTier | null = await resolveUserTierForPriceId(priceId);
        if (!resolvedTier) {
          console.error('[PaddleBillingAdapter] Unrecognised price ID, failing closed (tier unchanged)', { priceId: priceId ?? null });
          Sentry.captureMessage('PaddleBillingAdapter: unrecognised price ID, tier unchanged', { level: 'error', extra: { priceId: priceId ?? null, event_type: payload?.event_type } });
          return { success: false, error: 'Unrecognised price ID, tier not changed' };
        }
        effectiveUserTier = resolvedTier;
      }
      // user_subscriptions.plan_tier is DB-CHECK-constrained to
      // ('free','founder','pro') -- light/max cannot be stored until that
      // constraint is migrated (STEP 2's scope). De facto entitlements treat
      // every paid tier as pro today, so clamp ONLY this column;
      // users.tier carries the true tier below.
      const planTier: PlanTier = effectiveUserTier === 'free' ? 'free' : 'pro';

      const cancelAtPeriodEnd = data.scheduled_change?.action === 'cancel' || false;
      const eventOccurredAt = payload.occurred_at || new Date().toISOString();

      // Ordering protection: check existing record timestamp if present
      const { data: existing, error: existingError } = await supabase
        .from('user_subscriptions')
        .select('updated_at')
        .eq('paddle_subscription_id', data.id)
        .maybeSingle();

      if (existingError) {
        console.error('[PaddleBillingAdapter] Database error checking existing subscription:', existingError);
        Sentry.captureException(new Error(existingError.message), { tags: { operation: 'paddle-check-existing' } });
        return { success: false, error: existingError.message };
      }

      if (existing?.updated_at && new Date(existing.updated_at) > new Date(eventOccurredAt)) {
        console.info('[PaddleBillingAdapter] Stale subscription event ignored (existing updated_at:', existing.updated_at, '> occurred_at:', eventOccurredAt, ')');
        return { success: true };
      }

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
            updated_at: eventOccurredAt
          },
          { onConflict: 'paddle_subscription_id' }
        );

      if (error) {
        Sentry.captureException(new Error(error.message), { tags: { operation: 'paddle-upsert' } });
        return { success: false, error: error.message };
      }

      // users.tier is the canonical tier store (quota gate, rate limits,
      // usage summary all read it). Write the TRUE mapped tier, not the
      // DB-CHECK-clamped subscriptions value.
      // Downgrade protection (Cubic review, 2026-09-24): only drop the user
      // to free when no OTHER active/trialing subscription remains --
      // a user with two subscriptions canceling one must not lose their
      // paid tier from the still-active one.
      let tierToWrite: UserTier | null = effectiveUserTier;
      if (effectiveUserTier === 'free') {
        try {
          const { data: otherActive, error: otherActiveError } = await supabase
            .from('user_subscriptions')
            .select('paddle_subscription_id')
            .eq('user_id', userId)
            .neq('paddle_subscription_id', data.id)
            .in('status', ['active', 'trialing']);
          if (otherActiveError) {
            console.error('[PaddleBillingAdapter] Database error checking other active subscriptions:', otherActiveError);
            Sentry.captureException(new Error(otherActiveError.message), { tags: { operation: 'paddle-check-other-active' } });
            return { success: false, error: otherActiveError.message };
          }
          if ((otherActive ?? []).length > 0) {
            tierToWrite = null; // leave users.tier untouched
          }
        } catch (otherSubError: unknown) {
          const otherSubMsg = otherSubError instanceof Error ? otherSubError.message : String(otherSubError);
          Sentry.captureException(otherSubError instanceof Error ? otherSubError : new Error(otherSubMsg), { tags: { operation: 'paddle-check-other-active' } });
          return { success: false, error: otherSubMsg };
        }
      }
      if (tierToWrite !== null) {
        try {
          await SupabaseBillingAdapter.updateUserTier({ userId, tier: tierToWrite });
        } catch (tierUpdateError: unknown) {
          const tierErrorMsg = tierUpdateError instanceof Error ? tierUpdateError.message : String(tierUpdateError);
          Sentry.captureException(tierUpdateError instanceof Error ? tierUpdateError : new Error(tierErrorMsg), { tags: { operation: 'paddle-update-user-tier' } });
          return { success: false, error: `Failed to update users.tier: ${tierErrorMsg}` };
        }
      }

      return { success: true };
    } catch (processError) {
      const errorMsg = processError instanceof Error ? processError.message : String(processError);
      console.error('[PaddleBillingAdapter] processSubscriptionEvent error:', processError);
      Sentry.captureException(processError instanceof Error ? processError : new Error(errorMsg), { tags: { operation: 'paddle-process-event' } });
      return { success: false, error: errorMsg };
    }
  }


  async processTransactionEvent(rawPayload: WebhookPayload): Promise<{ success: boolean; error?: string }> {
    try {
      const parsed = PaddleWebhookSchema.safeParse(rawPayload);
      if (!parsed.success) {
        console.warn('[PaddleBillingAdapter] Schema validation dropped payload', parsed.error.issues);
        Sentry.captureMessage(`Validation dropped payload at ${'PaddleBillingAdapter'}`, {
          level: "warning",
          extra: {
            boundary: 'PaddleBillingAdapter',
            issueCount: parsed.error.issues.length,
            issuePaths: parsed.error.issues.map((i: any) => `${i.path.join(".")}: ${i.code}`),
          },
        });
        return { success: false, error: 'Invalid webhook payload schema' };
      }
      const payload = parsed.data as any;
      if (payload.event_type !== 'transaction.completed') {
        return { success: true };
      }

      const supabase = getSupabaseServiceClient();
      const { data } = payload;
      if (!data.id || !data.customer_id || !data.items || data.items.length === 0) {
        return { success: false, error: 'Malformed transaction payload: missing id, customer_id, or items' };
      }
      const userId = data.custom_data?.userId;
      
      if (!userId) {
        Sentry.captureMessage('PaddleBillingAdapter: Missing user_id in transaction custom_data', { level: 'warning', extra: { event_type: payload?.event_type } });
        return { success: false, error: 'Missing user_id in transaction custom_data' };
      }

      // Read authoritatively from transaction custom data
      let planTier: string | undefined = data.custom_data?.planTier;
      if (!planTier && data.items && data.items.length > 0) {
        // Fail closed (qa-intel R4, 2026-09-24): no `|| 'free'` fallback —
        // an undefined plan tier simply never reaches the founder gate.
        planTier = data.items[0]?.price?.custom_data?.plan_tier;
      }
      
      // Strictly require founder tier for lifetime access provisioning.
      // Pro one-time transactions or free tiers must not be granted 100-year lifetime access.
      if (planTier !== 'founder') {
        console.warn(`[PaddleBillingAdapter] Skipping lifetime provisioning for non-founder tier: ${planTier}`);
        return { success: true };
      }

      // Guard: only provision lifetime access when ALL items are one-time (interval === 'once').
      // Recurring Pro transactions also fire transaction.completed — those are handled by
      // subscription.created / subscription.updated; provisioning lifetime here would be wrong.
      const items: Array<{ price?: { id?: string; billing_cycle?: { interval?: string } } }> = data.items ?? [];
      const isOneTime = items.length > 0 && items.every(
        (item) => item.price?.billing_cycle?.interval === 'once' || item.price?.billing_cycle == null
      );
      if (!isOneTime && data.subscription_id) {
        // This transaction belongs to a recurring subscription — skip lifetime provisioning.
        console.info('[PaddleBillingAdapter] transaction.completed is recurring (sub:', data.subscription_id, ') — skipping lifetime upsert');
        return { success: true };
      }

      const eventOccurredAt = payload.occurred_at || new Date().toISOString();

      // Ordering protection: check existing record timestamp if present
      const { data: existing, error: existingError } = await supabase
        .from('user_subscriptions')
        .select('updated_at')
        .eq('paddle_subscription_id', 'tx_' + data.id)
        .maybeSingle();

      if (existingError) {
        console.error('[PaddleBillingAdapter] Database error checking existing transaction:', existingError);
        Sentry.captureException(new Error(existingError.message), { tags: { operation: 'paddle-check-existing-tx' } });
        return { success: false, error: existingError.message };
      }

      if (existing?.updated_at && new Date(existing.updated_at) > new Date(eventOccurredAt)) {
        console.info('[PaddleBillingAdapter] Stale transaction event ignored');
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
            updated_at: eventOccurredAt
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

  async createCheckoutSession(
    userId: string,
    email: string,
    planTier: 'light' | 'pro' | 'max' | 'founder',
    interval: 'once' | 'month' | 'year' = 'month'
  ): Promise<{ checkoutUrl: string }> {
    // Runtime guard (the type narrows callers, but the port boundary accepts
    // broader plan strings -- fail closed on anything unrecognised).
    const VALID_CHECKOUT_PLANS: ReadonlySet<string> = new Set(['light', 'pro', 'max', 'founder']);
    if (!VALID_CHECKOUT_PLANS.has(planTier)) {
      // 'free' is a VALID UserTier, just not purchasable -- say so instead
      // of reporting it as invalid (Cubic review, 2026-09-24).
      // planTier is typed to PaidPlanTier here (never 'free' at compile
      // time), but the port boundary accepts broader strings at runtime --
      // distinguish "valid UserTier, not purchasable" from "junk".
      const planStr = String(planTier);
      throw new Error(planStr === 'free' ? 'Checkout is not available for the free tier' : `Invalid plan tier: ${planStr}`);
    }

    let priceId = '';
    if (planTier === 'pro') {
      if (interval === 'year') {
        priceId = process.env.PADDLE_PRO_ANNUAL_PRICE_ID || process.env.PADDLE_PRO_PRICE_ID || '';
      } else {
        priceId = process.env.PADDLE_PRO_PRICE_ID || '';
      }
      if (!priceId) {
        priceId = (await resolvePriceId('pro', interval, 'paddle')) || '';
      }
      if (!priceId) {
        throw new Error('Paddle Pro price ID is not configured (PADDLE_PRO_PRICE_ID missing)');
      }
    } else if (planTier === 'founder') {
      priceId = process.env.PADDLE_FOUNDER_PRICE_ID || '';
      if (!priceId) {
        priceId = (await resolvePriceId('founder', 'once', 'paddle')) || '';
      }
      if (!priceId) {
        throw new Error('Paddle Founder price ID is not configured (PADDLE_FOUNDER_PRICE_ID missing)');
      }
    } else {
      // Light / Max resolve from the billing.priceIds registry (fail closed
      // on a missing combo -- never substitute another tier's price).
      // 'once' is never mapped to 'month' (CodeRabbit review, 2026-09-24):
      // a caller bypassing CheckoutSchema that requested light/once must
      // fail closed, not silently become a recurring monthly subscription.
      if (interval === 'once') {
        throw new Error(`Paddle ${planTier} does not support a one-time interval`);
      }
      priceId = (await resolvePriceId(planTier, interval, 'paddle')) || '';
      if (!priceId) {
        throw new Error(`Paddle ${planTier} price ID is not configured for interval ${interval}`);
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

      const checkoutUrl = (transaction as any).checkout?.url;
      if (!checkoutUrl) {
        throw new Error('Paddle API did not return a valid checkout URL');
      }
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
