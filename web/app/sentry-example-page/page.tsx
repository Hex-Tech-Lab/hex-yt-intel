'use client';

import { useEffect } from 'react';

export default function SentryExamplePage() {
  useEffect(() => {
    // Trigger Sentry error capture on page load
    myUndefinedFunction();
  }, []);

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Sentry Test Page</h1>
      <button
        onClick={() => { throw new Error('Sentry Test: Manual trigger'); }}
        style={{ padding: '10px 20px', cursor: 'pointer' }}
      >
        Trigger Sentry Error
      </button>
    </div>
  );
}
