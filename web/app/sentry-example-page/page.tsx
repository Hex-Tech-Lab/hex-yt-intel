'use client';

export default function SentryExamplePage() {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Sentry Test Page</h1>
      <button
        onClick={() => { (window as any).myUndefinedFunction(); }}
        style={{ padding: '10px 20px', cursor: 'pointer' }}
      >
        Trigger Sentry Error
      </button>
    </div>
  );
}
