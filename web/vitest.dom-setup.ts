import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { clearClientCache } from '@/lib/utils/client-cache';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'test-user-id', email: 'test@example.com' },
    session: { access_token: 'test-token' },
    isLoading: false,
    isAuthenticated: true,
    signOut: vi.fn(),
  }),
}));

afterEach(() => {
  clearClientCache();
});