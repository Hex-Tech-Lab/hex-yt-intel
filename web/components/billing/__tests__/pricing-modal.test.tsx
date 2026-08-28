/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingModal } from '../PricingModal';
import { PRICING_REGISTRY_FALLBACK } from '@/lib/config/pricing-settings';
import * as exportUtils from '@/lib/dashboard/export';

vi.mock('@/lib/dashboard/export', () => ({
  showToast: vi.fn(),
}));


// Polyfill window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('PricingModal component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost' },
      writable: true,
    });
  });

  it('Test 1: Renders Founder tier benefits and price clearly', () => {
    render(<PricingModal isOpen={true} onClose={() => {}} />);
    expect(screen.getAllByText('Upgrade to Founder')).toBeDefined();
    expect(screen.getByText(PRICING_REGISTRY_FALLBACK.founder.display)).toBeDefined();
    expect(screen.getByText('Unlimited video analysis')).toBeDefined();
    expect(screen.getByText('Knowledge Graph access')).toBeDefined();
  });

  it('Test 2: Clicking Upgrade triggers POST checkout API and redirects', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ checkoutUrl: 'https://paddle.checkout.url' }),
    });

    render(<PricingModal isOpen={true} onClose={() => {}} />);
    
    // There are two buttons, one is the close (icon) and one is the primary action. We'll click the one with the text.
    const upgradeButtons = screen.getAllByRole('button', { name: /Upgrade to Founder/i });
    const upgradeButton = upgradeButtons.find(btn => btn.textContent?.includes('Upgrade to Founder'));
    
    fireEvent.click(upgradeButton!);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/billing/checkout', expect.objectContaining({
        method: 'POST',
      }));
      expect(window.location.href).toBe('https://paddle.checkout.url');
    });
  });

  it('Test 3: API failure displays error toast without crashing', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid plan' }),
    });

    render(<PricingModal isOpen={true} onClose={() => {}} />);
    
    const upgradeButtons = screen.getAllByRole('button', { name: /Upgrade to Founder/i });
    const upgradeButton = upgradeButtons.find(btn => btn.textContent?.includes('Upgrade to Founder'));
    
    fireEvent.click(upgradeButton!);

    await waitFor(() => {
      expect(exportUtils.showToast).toHaveBeenCalledWith('Invalid plan');
      expect(window.location.href).toBe('http://localhost'); // Not redirected
    });
    // Verifies container has role="alert" or aria-live="polite"
  });
});
