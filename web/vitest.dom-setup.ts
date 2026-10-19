import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { clearClientCache } from '@/lib/utils/client-cache';

afterEach(() => {
  clearClientCache();
});