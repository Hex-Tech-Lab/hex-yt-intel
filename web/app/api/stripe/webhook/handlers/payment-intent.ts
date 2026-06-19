import { addBreadcrumb } from '@/lib/monitoring/sentry-utils';
import Stripe from 'stripe';

export function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): void {
  addBreadcrumb('Payment succeeded', { paymentIntentId: paymentIntent.id });
  console.log('[/api/stripe/webhook] Payment succeeded:', paymentIntent.id);
}

export function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): void {
  addBreadcrumb('Payment failed', { paymentIntentId: paymentIntent.id }, 'billing');
  console.log('[/api/stripe/webhook] Payment failed:', paymentIntent.id);
}
