'use client';

import { Clock } from 'lucide-react';

interface RateLimitAlertProps {
  secondsRemaining: number;
}

export default function RateLimitAlert({ secondsRemaining }: RateLimitAlertProps) {
  const progress = ((60 - secondsRemaining) / 60) * 100; // Assuming max 60 second lockout
  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;

  return (
    <div className="mt-3 mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex gap-3">
        {/* Icon */}
        <Clock className="h-5 w-5 flex-shrink-0 text-amber-600 mt-0.5" />

        {/* Content */}
        <div className="flex-1">
          {/* Title */}
          <h3 className="font-semibold text-amber-900 mb-1 text-sm">
            Rate Limit Exceeded
          </h3>

          {/* Description */}
          <p className="text-amber-800 text-xs mb-3">
            You&apos;ve exceeded the request limit. Please try again in:
          </p>

          {/* Countdown Display */}
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="font-mono text-lg font-bold text-amber-600">
              {minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`}
            </div>
            <div className="text-xs text-amber-700">
              {minutes > 0
                ? `${minutes} minute${minutes > 1 ? 's' : ''} ${seconds} second${seconds !== 1 ? 's' : ''}`
                : `${seconds} second${seconds !== 1 ? 's' : ''}`}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 w-full rounded-full bg-amber-900/20 overflow-hidden">
            <div
              className="h-full bg-amber-600 transition-all duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
