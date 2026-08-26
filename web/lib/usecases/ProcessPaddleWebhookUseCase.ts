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
      
      let result: { success: boolean; error?: string } = { success: true };
      if (payload.event_type.startsWith('subscription.')) {
        result = await this.billingAdapter.processSubscriptionEvent(payload);
      } else if (payload.event_type.startsWith('transaction.')) {
        result = await this.billingAdapter.processTransactionEvent(payload);
      } else {
        return { success: true, status: 200, message: 'Event ignored' };
      }
      if (!result.success) {
        return { success: false, status: 400, message: result.error || 'Failed to process' };
      }
      return { success: true, status: 200, message: 'Processed' };
    } catch (parseError: unknown) {
      console.error('[ProcessPaddleWebhookUseCase] Error processing webhook event:', parseError);
      return { success: false, status: 400, message: parseError instanceof Error ? parseError.message : String(parseError) };
    }
  }
}
