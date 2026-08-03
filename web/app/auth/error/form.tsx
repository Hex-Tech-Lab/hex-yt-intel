'use client';

import { useSearchParams } from 'next/navigation';
import { Banner, Button, Card } from '@astryxdesign/core';

export default function AuthErrorForm() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  const errorMessages: Record<string, string> = {
    Callback: 'Callback error',
    OAuthSignin: 'OAuth signin failed',
    OAuthCallback: 'OAuth callback failed',
    OAuthCreateAccount: 'Could not create OAuth account',
    EmailCreateAccount: 'Could not create email account',
    OAuthAccountNotLinked: 'Email already in use with different provider',
    EmailSignInError: 'Check your email address',
    CredentialsSignin: 'Sign in failed',
    SessionCallback: 'Session callback error',
    admin_check_failed: 'Admin access check failed — please try again shortly',
    default: 'Authentication error',
  };

  const message = error ? errorMessages[error] || errorMessages.default : errorMessages.default;

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--void)',
      padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <Banner
          status="error"
          title="Authentication Error"
          description={message}
          style={{ marginBottom: 24 }}
        />

        <Card style={{ padding: 32, textAlign: 'center' }}>
          <Button
            href="/auth/signin"
            label="Try again"
            variant="primary"
            style={{ width: '100%', justifyContent: 'center' }}
          />
        </Card>
      </div>
    </div>
  );
}
