import Link from 'next/link';
import { Icon } from '@/components/templates/_shared/primitives';

/**
 * FOOTER - 10X DESIGN SYSTEM REPLICATION
 * -------------------------------------------
 * Mirrors the multi-link technical footer from the marketing spec.
 */

export function Footer() {
  return (
    <footer style={{ 
      padding: "60px 32px 40px", 
      borderTop: "1px solid var(--line)", 
      background: "rgb(17 20 29 / 0.4)",
      marginTop: "auto" 
    }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 48, marginBottom: 60 }}>
          {/* Brand Col */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 6, background: "var(--accent-strong)", color: "var(--void)" }}>
                <Icon icon="solar:graph-up-linear" size={14} />
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, letterSpacing: "0.04em", color: "var(--ink)" }}>HEX·YT·INTEL</span>
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-secondary)", lineHeight: 1.6, maxWidth: "24ch" }}>
              Technical instrumentation for high-volume video intelligence.
            </p>
          </div>

          {/* Product Col */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)" }}>Product</p>
            <nav style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Link href="/dashboard" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>Console</Link>
              <Link href="/pricing" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>Pricing</Link>
              <Link href="/analyses/saved" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>Library</Link>
            </nav>
          </div>

          {/* Resources Col */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)" }}>Resources</p>
            <nav style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Link href="/docs" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>Documentation</Link>
              <Link href="/api/health" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>System Status</Link>
              <Link href="https://github.com/Hex-Tech-Lab/hex-yt-intel" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>GitHub</Link>
            </nav>
          </div>

          {/* Legal Col */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)" }}>Legal</p>
            <nav style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Link href="/privacy-policy" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>Privacy Policy</Link>
              <Link href="/terms-and-conditions" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>Terms of Service</Link>
              <Link href="/refund-policy" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>Refund Policy</Link>
              <Link href="/legal/sub-processors" style={{ fontSize: 13, color: "var(--ink-secondary)", textDecoration: "none" }}>Sub-processors</Link>
            </nav>
          </div>
        </div>

        {/* Bottom Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 24, borderTop: "1px solid var(--line)" }}>
          <p style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-muted)" }}>
            © 2026 HEX-YT-INTEL. PROVENANCE ASSURED.
          </p>
          <div style={{ display: "flex", gap: 16 }}>
            <Link href="#" style={{ color: "var(--ink-muted)" }}><Icon icon="solar:letter-linear" size={16} /></Link>
            <Link href="#" style={{ color: "var(--ink-muted)" }}><Icon icon="solar:share-circle-linear" size={16} /></Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
