'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const BentoGrid = dynamic(() => import('@/components/dashboard/BentoGrid'), {
  ssr: false,
});

interface AnalysisErrorProps {
  error: string | null;
  url: string;
}

export function AnalysisError({ error, url }: AnalysisErrorProps) {
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  // Parse encoded error format: "STATUS:MESSAGE"
  const errorParts = error?.split(':') || [];
  const statusCode = errorParts[0] ? parseInt(errorParts[0], 10) : 0;
  const errorMessage = errorParts.length > 1 ? errorParts.slice(1).join(':') : error || 'An unexpected error occurred.';

  // Distinguish user quota errors from provider errors
  // User quota: includes ERR_MONTHLY_QUOTA_EXHAUSTED in the message
  // Provider quota: includes ERR_PROVIDER_QUOTA_EXHAUSTED or other provider errors
  const isUserQuotaError = error?.includes('ERR_MONTHLY_QUOTA_EXHAUSTED') || error?.includes('Monthly quota');
  const isProviderError = error?.includes('ERR_PROVIDER_QUOTA_EXHAUSTED') || statusCode === 502;

  const handleUpgradeClick = async () => {
    setIsUpgrading(true);
    setUpgradeError(null);

    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          successUrl: `${window.location.origin}/dashboard?upgrade=success`,
          cancelUrl: `${window.location.origin}/dashboard?upgrade=cancelled`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create checkout session');
      }

      const { sessionUrl } = await response.json();
      if (sessionUrl) {
        window.location.href = sessionUrl;
      } else {
        throw new Error('No session URL returned');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setUpgradeError(msg);
      setIsUpgrading(false);
    }
  };

  // Render user quota-specific error with upgrade CTA
  if (isUserQuotaError) {
    return (
      <div className="space-y-6">
        <Card className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-8 space-y-6">
          <div>
            <h3 className="text-lg font-bold text-amber-300 mb-2">Monthly Quota Reached</h3>
            <p className="text-sm text-amber-100/80 mb-4">
              {errorMessage}
            </p>
          </div>

          <div className="space-y-3">
            <Button
              onClick={handleUpgradeClick}
              disabled={isUpgrading}
              variant="default"
              className="w-full justify-center gap-2"
            >
              {isUpgrading ? (
                <>
                  <span className="inline-block h-4 w-4 border-2 border-transparent border-t-black rounded-full animate-spin" />
                  Upgrading...
                </>
              ) : (
                <>✨ Upgrade to Pro</>
              )}
            </Button>

            {upgradeError && (
              <p className="text-sm text-red-400">
                Error: {upgradeError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm text-slate-400 border-t border-border pt-4">
              <div>
                <p className="font-medium text-white mb-1">Free Tier</p>
                <p>3 analyses/month</p>
              </div>
              <div>
                <p className="font-medium text-accent mb-1">Pro Tier</p>
                <p>Unlimited analyses</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Render provider error without upgrade CTA
  if (isProviderError) {
    return (
      <div className="space-y-6">
        <Card className="border border-red-500/30 bg-red-500/5 rounded-lg p-8 space-y-4">
          <div>
            <h3 className="text-lg font-bold text-red-400 mb-2">System Degraded</h3>
            <p className="text-sm text-red-100/80">
              AI providers are currently overloaded. Please try again in a few minutes.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // Default error rendering for other error types
  return (
    <div className="space-y-6">
      <h3 className="text-sm font-mono text-red-400 uppercase tracking-widest mb-4">
        System Resilience Intercept
      </h3>
      <BentoGrid
        analysis={{
          id: 'error',
          video_id: url,
          title: 'Processing Exception Intercepted',
          analysis_markdown: `### DIMENSION 1 – ERROR_REPORT\n${errorMessage}\n\n### DIMENSION 10 – RISK_ASSESSMENT\nSYSTEM_STATE: RECOVERED_VIA_DEGRADATION\nMITIGATION: USER_RETAINED_IN_DASHBOARD`,
          validation_report: {
            transcript_available: false,
            analysis_type: 'metadata-only',
            warning: errorMessage || 'Analysis failed',
          },
          model_used: 'error-handler',
          created_at: new Date().toISOString(),
          cached_at: new Date().toISOString(),
        }}
      />
    </div>
  );
}
