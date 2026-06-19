'use client';

import { useState } from 'react';
import { Icon } from '@/components/templates/_shared/primitives';

// Lazy-load Supabase client module to avoid blocking initial render
const supabaseModulePromise = import('@/utils/supabase/client');

export default function SignInForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSupabaseAuth = async () => {
    setError(null);
    setLoading(true);
    try {
      const { createClient } = await supabaseModulePromise;
      const supabase = createClient();
      const searchParams = new URLSearchParams(window.location.search);
      const nextTarget = searchParams.get('next') || '/dashboard';
      const callbackUrl = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextTarget)}`;
      
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
  };

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

          <p style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--ink-muted)",
            textAlign: "center",
            marginTop: 24,
          }}>Powered by Supabase</p>
        </div>
      </div>
    </div>
  );
}
