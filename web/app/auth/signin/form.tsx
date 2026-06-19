'use client';

import { useCallback, useMemo, useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';
import { createClient } from '@/utils/supabase/client';

export default function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  const callbackUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/auth/callback';
    const searchParams = new URLSearchParams(window.location.search);
    const nextTarget = searchParams.get('next') || '/dashboard';
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget)}`;
  }, []);

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
          }}>HEX·YT·INTEL</h1>
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
            <div role="alert" style={{
              marginBottom: 20,
              padding: 12,
              background: "rgb(239 68 68 / 0.10)",
              border: "1px solid rgb(239 68 68 / 0.25)",
              color: "var(--err)",
              fontSize: 14,
            }}>
              {error}
            </div>
          )}

          <button
            onClick={handleSupabaseAuth}
            disabled={loading}
            aria-busy={loading}
            className="btn-primary"
            style={{
              width: "100%",
              justifyContent: "center",
              opacity: loading ? 0.5 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            <Icon icon="solar:sun-bold-duotone" size={16} />
            {loading ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </div>
      </div>
    </div>
  );
}
