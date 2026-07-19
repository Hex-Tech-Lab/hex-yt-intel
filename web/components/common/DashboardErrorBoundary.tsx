'use client';

import React, { ReactNode } from 'react';
import * as Sentry from '@sentry/nextjs';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class DashboardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[DashboardErrorBoundary]', error, info);
    Sentry.captureException(error, {
      contexts: { react: { errorBoundary: 'DashboardContainer', componentStack: info.componentStack } },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col gap-4 p-8 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg m-4">
          <h2 className="text-lg font-semibold text-red-900 dark:text-red-100">Dashboard Error</h2>
          <p className="text-sm text-red-800 dark:text-red-200">
            {this.state.error?.message || 'An error occurred while rendering the dashboard.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="w-fit px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium"
          >
            Reload Dashboard
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
