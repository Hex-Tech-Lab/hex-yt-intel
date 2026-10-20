import { describe, expect, it } from 'vitest';
import type { AuthIdentity, AuthOptions, AuthPort } from '../AuthPort';

describe('AuthPort interface contract', () => {
  it('conforms to the AuthPort contract with requireActiveSession option', async () => {
    const mockAuthAdapter: AuthPort = {
      authenticate: async (options?: AuthOptions): Promise<AuthIdentity | null> => {
        if (options?.requireActiveSession) {
          return {
            userId: 'user-active-1',
            email: 'active@example.com',
            tier: 'pro',
          };
        }
        return {
          userId: 'user-cached-1',
          email: 'cached@example.com',
          tier: 'free',
        };
      },
    };

    const cachedIdentity = await mockAuthAdapter.authenticate();
    expect(cachedIdentity?.userId).toBe('user-cached-1');

    const activeIdentity = await mockAuthAdapter.authenticate({ requireActiveSession: true });
    expect(activeIdentity?.userId).toBe('user-active-1');
  });
});
