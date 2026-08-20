'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button, Banner, TextInput } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import { createClient } from '@/utils/supabase/client';

export default function SignInForm({ showTestAuth = false }: { showTestAuth?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testPassword, setTestPassword] = useState('');

  const supabase = useMemo(() => createClient(), []);

  const nextTarget = useMemo(() => {
    if (typeof window === 'undefined') return '/dashboard';
    const searchParams = new URLSearchParams(window.location.search);
    const next = searchParams.get('next');
    return next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  }, []);

  const callbackUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/auth/callback';
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget)}`;
  }, [nextTarget]);

  const handleSupabaseAuth = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callbackUrl },
      });
      if (error) setError(error.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }, [supabase, callbackUrl]);

  // Real gap fix (2026-08-20): automated testing tools (TestSprite) can only
  // fill real form fields, not issue a raw POST with a custom header. This
  // is Supabase's own signInWithPassword -- no custom auth mechanism -- and
  // only appears when the caller (SignIn page.tsx) resolved
  // testAuthBypass.enabled=true from the Settings Registry. Only the one
  // pre-existing test account has a password set at all.
  const handleTestAuth = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: testEmail, password: testPassword });
      if (error) {
        setError(error.message);
        return;
      }
      window.location.href = nextTarget;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }, [supabase, testEmail, testPassword, nextTarget]);

  return (
    <div style={{
      display: "flex",
      minHeight: "100vh",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--void)",
      padding: 32,
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Logo + brand */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            display: "inline-grid",
            placeItems: "center",
            width: 40,
            height: 40,
            borderRadius: 8,
            background: "var(--accent-strong)",
            color: "var(--void)",
            marginBottom: 16,
          }}>
            <Icon icon="solar:graph-up-linear" size={22} />
          </div>
          <h1 style={{
            fontFamily: "var(--font-mono)",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "var(--ink)",
            margin: 0,
          }}>VINTEL</h1>
          <p style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--ink-muted)",
            marginTop: 8,
          }}>{"// YouTube → knowledge graph"}</p>
        </div>

        {/* Card */}
        <div style={{
          background: "var(--surface)",
          border: "1px solid var(--line)",
          padding: 32,
        }}>
          <h2 style={{
            fontFamily: "var(--font-sans)",
            fontSize: 18,
            fontWeight: 500,
            color: "var(--ink)",
            textAlign: "center",
            marginBottom: 24,
          }}>Sign in to continue</h2>

          {error && (
            <Banner
              status="error"
              title={error}
              style={{ marginBottom: 20 }}
            />
          )}

          <Button
            label={loading ? 'Signing in...' : 'Sign in with Google'}
            variant="primary"
            onClick={handleSupabaseAuth}
            isDisabled={loading}
            isLoading={loading}
            icon={<Icon icon="solar:sun-bold-duotone" size={16} />}
            width="100%"
          />

          {showTestAuth && (
            <form onSubmit={handleTestAuth} style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// Test account sign-in"}</p>
              <TextInput
                type="email"
                label="Email"
                value={testEmail}
                onChange={setTestEmail}
                isDisabled={loading}
                width="100%"
                htmlName="email"
              />
              <TextInput
                type="password"
                label="Password"
                value={testPassword}
                onChange={setTestPassword}
                isDisabled={loading}
                width="100%"
                htmlName="password"
              />
              <Button
                label={loading ? 'Signing in...' : 'Sign in with test account'}
                variant="secondary"
                type="submit"
                isDisabled={loading || !testEmail || !testPassword}
                isLoading={loading}
                width="100%"
              />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
