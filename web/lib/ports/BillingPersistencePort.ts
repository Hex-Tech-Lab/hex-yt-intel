import type { BillingStatus } from '@/lib/types/validation-report';

export interface UserProfile {
  email: string | null;
  name: string | null;
  tier: string;
  role: string | null;
  analysesUsed: number;
}

export interface BillingPersistencePort {
  updateUserTier(params: {
    userId: string;
    tier: 'pro' | 'free';
  }): Promise<void>;

  updateBillingStatus(params: {
    analysisId: string;
    status: BillingStatus;
  }): Promise<void>;

  getUserProfile(userId: string): Promise<UserProfile | null>;

  getUserBillingConfig(userId: string): Promise<{
    stripeCustomerId: string | null;
    tier: string;
    analysesUsed: number;
  } | null>;

  getUsageLogsCountSince(params: {
    userId: string;
    since: string;
  }): Promise<number>;

  getMonthlyAnalyses(params: {
    userId: string;
    since: string;
  }): Promise<Array<{ id: string; billingStatus: string; createdAt: string }>>;

  logUsageEvent(params: {
    userId: string;
    action: string;
    metadata: any;
  }): Promise<void>;
}
