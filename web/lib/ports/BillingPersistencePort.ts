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
    status: 'processing' | 'completed' | 'failed';
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
  }): Promise<Record<string, number>>;

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
