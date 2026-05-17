'use client';

import { SessionProvider } from 'next-auth/react';
import React, { ReactNode } from 'react';

class SessionErrorBoundary extends React.Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[SessionErrorBoundary] Caught error:', error.message);
  }

  render() {
    if (this.state.hasError) {
      // Fallback UI for session hydration errors - render children anyway
      console.info('[SessionErrorBoundary] Rendering fallback layout');
      return this.props.children;
    }

    return this.props.children;
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionErrorBoundary>
      <SessionProvider>{children}</SessionProvider>
    </SessionErrorBoundary>
  );
}
