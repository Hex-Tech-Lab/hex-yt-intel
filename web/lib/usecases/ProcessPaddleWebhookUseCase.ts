import { BillingPort } from '../ports/BillingPort';

export class ProcessPaddleWebhookUseCase {
  constructor(private billingAdapter: BillingPort) {}

  async execute(rawBody: string, signatureHeader: string | null, secret: string | undefined): Promise<{ success: boolean; status: number; message: string }> {
    if (!signatureHeader || !secret) {
      return { success: false, status: 401, message: 'Missing signature or secret' };
    }
    
    if (!this.billingAdapter.verifySignature(rawBody, signatureHeader, secret)) {
      return { success: false, status: 401, message: 'Invalid signature' };
    }

    try {
      const payload = this.billingAdapter.parseWebhookEvent(rawBody);
      
      // We only care about subscription events
      if (!payload.event_type.startsWith('subscription.')) {
        return { success: true, status: 200, message: 'Event ignored' };
      }

      const result = await this.billingAdapter.processSubscriptionEvent(payload);
      if (!result.success) {
        return { success: false, status: 400, message: result.error || 'Failed to process' };
      }
      return { success: true, status: 200, message: 'Processed' };
    } catch (e) {
      return { success: false, status: 400, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
