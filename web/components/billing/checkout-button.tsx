'use client';

import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';

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

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: "100%" }}>
      <div style={{ position: "relative", padding: isLoading ? 1.5 : 0, borderRadius: 9, overflow: "hidden", display: "inline-flex", width: "100%" }}>
        {isLoading && (
          <span style={{ position: "absolute", inset: "-60%", background: "conic-gradient(from var(--hx-angle), transparent 55%, var(--accent) 78%, transparent 92%)", animation: "hx-rotate-ring 3s linear infinite" }} />
        )}
        <Button
          label={isLoading ? "Analyzing" : "Get started"}
          variant="primary"
          size="md"
          width="100%"
          isLoading={isLoading}
          isDisabled={isLoading}
          onClick={handleCheckout}
        />
      </div>
      {error && <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--err)", marginTop: 7 }}>{error}</div>}
    </div>
  );
}
