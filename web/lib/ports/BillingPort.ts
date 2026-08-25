import { WebhookPayload } from '../types/billing';

export interface BillingPort {
  verifySignature(rawBody: string, signatureHeader: string, secret: string): boolean;
  parseWebhookEvent(rawBody: string): WebhookPayload;
  processSubscriptionEvent(payload: WebhookPayload): Promise<{ success: boolean; error?: string }>;
}
