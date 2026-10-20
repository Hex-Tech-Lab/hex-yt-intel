import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { clearClientCache } from '@/lib/utils/client-cache';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: process.env.TEST_USER_BYPASS_ID || 'mock-user-1', email: 'test@example.com' },
    session: { access_token: 'test-token' },
    isLoading: false,
    isAuthenticated: true,
    signOut: vi.fn(),
  }),
}));

afterEach(() => {
  clearClientCache();
});