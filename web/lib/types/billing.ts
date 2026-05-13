export type UserTier = 'free' | 'pro' | 'enterprise';

export interface UserBillingData {
  id: string;
  email: string;
  name: string | null;
  tier: UserTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  analyses_used: number;
  last_reset_date: string;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionStatus {
  status: 'active' | 'inactive' | 'canceled' | 'past_due';
  currentPeriodEnd?: Date;
  subscriptionId?: string;
}

export interface CheckoutSessionResponse {
  sessionUrl: string;
}

export interface BillingDashboardData {
  tier: UserTier;
  analysesUsed: number;
  analysesLimit: number | null;
  stripeCustomerId: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  invoices: InvoiceData[];
}

export interface InvoiceData {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: Date | null;
  dueDate: Date | null;
  invoiceUrl: string;
}

export interface UsageData {
  action: string;
  count: number;
  lastAction: Date;
}
