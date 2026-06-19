import { stripe } from '@/lib/stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import * as Sentry from '@sentry/nextjs';

export async function handleInvoicePaid(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<void> {
  try {
    const customerId = invoice.customer as string;
    const customer = await stripe.customers.retrieve(customerId);

    if (typeof customer === 'string' || customer.deleted || !customer.email) {
      console.error('[handleInvoicePaid] Could not retrieve customer:', customerId);
      return;
    }

    const { data: users } = await supabase
      .from('users')
      .select('id, stripe_customer_id')
      .eq('email', customer.email)
      .maybeSingle();

    if (users && typeof users === 'object' && 'id' in users) {
      const userId = (users as any).id;

      const existingCustomerId = (users as any).stripe_customer_id;
      if (existingCustomerId && existingCustomerId !== customerId) {
        console.error('[handleInvoicePaid] Customer ID mismatch for user:', userId, {
          event: customerId,
          stored: existingCustomerId,
        });
        Sentry.captureMessage('Stripe customer ID mismatch on invoice payment', {
          level: 'error',
          tags: { security: 'customer_ownership' },
        });
        return;
      }

      const paymentData: Record<string, any> = {
        user_id: userId,
        action: 'invoice_paid',
        metadata: {
          invoice_id: invoice.id,
          amount: invoice.amount_paid,
          currency: invoice.currency,
        },
        created_at: new Date().toISOString(),
      };
      await supabase.from('usage_logs').insert(paymentData);

      console.log(`[handleInvoicePaid] Invoice ${invoice.id} paid for user ${userId}`);
    }
  } catch (error) {
    console.error('[handleInvoicePaid] Error:', error);
    Sentry.captureException(error, {
      tags: {
        handler: 'handleInvoicePaid',
        severity: 'medium',
      },
    });
  }
}

export async function handleInvoiceFailed(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<void> {
  try {
    const customerId = invoice.customer as string;
    const customer = await stripe.customers.retrieve(customerId);

    if (typeof customer === 'string' || customer.deleted || !customer.email) {
      console.error('[handleInvoiceFailed] Could not retrieve customer:', customerId);
      return;
    }

    const { data: users } = await supabase
      .from('users')
      .select('id, stripe_customer_id')
      .eq('email', customer.email)
      .maybeSingle();

    if (users && typeof users === 'object' && 'id' in users) {
      const userId = (users as any).id;

      const existingCustomerId = (users as any).stripe_customer_id;
      if (existingCustomerId && existingCustomerId !== customerId) {
        console.error('[handleInvoiceFailed] Customer ID mismatch for user:', userId, {
          event: customerId,
          stored: existingCustomerId,
        });
        Sentry.captureMessage('Stripe customer ID mismatch on invoice failure', {
          level: 'error',
          tags: { security: 'customer_ownership' },
        });
        return;
      }

      const failureData: Record<string, any> = {
        user_id: userId,
        action: 'invoice_failed',
        metadata: {
          invoice_id: invoice.id,
          amount: invoice.amount_due,
          currency: invoice.currency,
        },
        created_at: new Date().toISOString(),
      };
      await supabase.from('usage_logs').insert(failureData);

      console.log(`[handleInvoiceFailed] Invoice ${invoice.id} failed for user ${userId}`);
    }
  } catch (error) {
    console.error('[handleInvoiceFailed] Error:', error);
    Sentry.captureException(error, {
      tags: {
        handler: 'handleInvoiceFailed',
        severity: 'medium',
      },
    });
  }
}
