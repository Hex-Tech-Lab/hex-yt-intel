'use client';

import dynamic from 'next/dynamic';

const BentoGrid = dynamic(() => import('@/components/dashboard/BentoGrid'), {
  ssr: false,
});

interface AnalysisErrorProps {
  error: string | null;
  url: string;
}

export function AnalysisError({ error, url }: AnalysisErrorProps) {
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
          analysis_markdown: `### DIMENSION 1 – ERROR_REPORT\n${error || 'An unexpected error occurred during processing.'}\n\n### DIMENSION 10 – RISK_ASSESSMENT\nSYSTEM_STATE: RECOVERED_VIA_DEGRADATION\nMITIGATION: USER_RETAINED_IN_DASHBOARD`,
          validation_report: {
            transcript_available: false,
            analysis_type: 'metadata-only',
            warning: error || 'Analysis failed',
          },
          model_used: 'error-handler',
          created_at: new Date().toISOString(),
          cached_at: new Date().toISOString(),
        }}
      />
    </div>
  );
}
