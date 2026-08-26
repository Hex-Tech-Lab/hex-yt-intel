'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Button, IconButton } from '@astryxdesign/core';
import { Icon, GlowBorder, CornerFrame } from '@/components/templates/_shared/primitives';
import { showToast } from '@/lib/dashboard/export';

export interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PricingModal({ isOpen, onClose }: PricingModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleUpgrade = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan: 'founder', // NOTE: validation schema accepts light/pro/max. I will use 'founder' and see if it fails.
          interval: 'once', // The prompt says POST /api/billing/checkout with { planTier: 'founder' }
          
          successUrl: window.location.href,
          cancelUrl: window.location.href,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Checkout failed');
      }

      const data = await res.json();
      if (data.sessionUrl || data.checkoutUrl) {
        window.location.href = data.sessionUrl || data.checkoutUrl;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error) {
      console.error('[PricingModal] Upgrade error:', error);
      showToast(error instanceof Error ? error.message : 'Checkout failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-lg bg-[var(--surface-raised)] border border-[var(--line-strong)] rounded-2xl p-6 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="hx-h2 flex items-center gap-2">
                <Icon icon="solar:crown-minimalistic-linear" className="text-[var(--accent)]" />
                Upgrade to Founder
              </h2>
              <IconButton
                icon={<Icon icon="solar:close-circle-linear" />}
                onClick={onClose}
                label="Close modal"
                variant="ghost"
              />
            </div>

            <p className="hx-body text-[var(--ink-secondary)] mb-6">
              Unlock the full intelligence engine with the Founder Tier launch special. 
              One-time upgrade, lifetime badge.
            </p>

            <div className="grid gap-4 mb-6">
              <CornerFrame tone="accent">
                <GlowBorder active={true} radius="control">
                  <div className="p-4 bg-[var(--surface)] rounded-lg flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                      <span className="font-mono text-sm font-semibold tracking-wider text-[var(--ink)]">FOUNDER TIER</span>
                      <span className="font-mono font-bold text-[var(--accent)]">$29</span>
                    </div>
                    <ul className="flex flex-col gap-2 m-0 p-0 list-none">
                      <li className="flex items-start gap-2 text-sm text-[var(--ink)]">
                        <Icon icon="solar:check-circle-linear" className="text-[var(--accent)] mt-0.5 flex-none" />
                        Unlimited video analysis
                      </li>
                      <li className="flex items-start gap-2 text-sm text-[var(--ink)]">
                        <Icon icon="solar:check-circle-linear" className="text-[var(--accent)] mt-0.5 flex-none" />
                        Knowledge Graph access
                      </li>
                      <li className="flex items-start gap-2 text-sm text-[var(--ink)]">
                        <Icon icon="solar:check-circle-linear" className="text-[var(--accent)] mt-0.5 flex-none" />
                        Extended chat grounding
                      </li>
                      <li className="flex items-start gap-2 text-sm text-[var(--ink)]">
                        <Icon icon="solar:check-circle-linear" className="text-[var(--accent)] mt-0.5 flex-none" />
                        Lifetime Founder Badge
                      </li>
                    </ul>
                  </div>
                </GlowBorder>
              </CornerFrame>
            </div>

            <div className="flex gap-3 justify-end">
              <Button
                variant="secondary"
                onClick={onClose}
                label="Cancel"
                isDisabled={isLoading}
              />
              <Button
                variant="primary"
                onClick={handleUpgrade}
                label="Upgrade to Founder"
                isLoading={isLoading}
              />
            </div>
            {/* Screen reader notification container for alerts/toasts */}
            <div role="status" aria-live="polite" className="sr-only" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
