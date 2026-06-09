'use client';

import { useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

interface CheckoutButtonProps {
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export function CheckoutButton({ isLoading, setIsLoading }: CheckoutButtonProps) {
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const baseUrl = window.location.origin;
      const successUrl = `${baseUrl}/billing?success=true`;
      const cancelUrl = `${baseUrl}/pricing?canceled=true`;

      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          successUrl,
          cancelUrl,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create checkout session');
      }

      const { sessionUrl } = await response.json();
      window.location.href = sessionUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      console.error('[CheckoutButton] Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <div style={{ position: "relative", padding: 1.5, borderRadius: 9, overflow: "hidden", display: "inline-flex", width: "100%" }}>
          <span style={{ position: "absolute", inset: "-60%", background: "conic-gradient(from var(--hx-angle), transparent 55%, var(--accent) 78%, transparent 92%)", animation: "hx-rotate-ring 3s linear infinite" }} />
          <button
            disabled
            style={{ position: "relative", width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 500, border: "none", cursor: "not-allowed", padding: "11px 18px", borderRadius: 8, background: "var(--accent-strong)", color: "var(--void)" }}
          >
            <Icon icon="solar:refresh-linear" size={16} />
            Analyzing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%" }}>
      <button
        onClick={handleCheckout}
        style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "var(--font-sans)", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer", padding: "11px 18px", borderRadius: 8, background: "var(--accent-strong)", color: "var(--void)" }}
      >
        Get started
      </button>
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--err)", marginTop: 7 }}>{error}</div>}
    </div>
  );
}
