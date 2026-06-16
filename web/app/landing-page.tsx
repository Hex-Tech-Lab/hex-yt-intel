'use client';

import Link from 'next/link';
import { Icon } from '@/components/templates/_shared/primitives';
import { Footer } from '@/components/Footer';

/**
 * LANDING PAGE - 10X DESIGN SYSTEM REPLICATION
 * -------------------------------------------
 * This page strictly mirrors ui_kits/marketing/index.html
 * and consumes tokens from colors_and_type.css.
 */

function Nav() {
  return (
    <header style={{ 
      display: "flex", 
      alignItems: "center", 
      justifyContent: "space-between", 
      padding: "12px 32px", 
      borderBottom: "1px solid var(--line)", 
      background: "rgb(17 20 29 / 0.7)", 
      backdropFilter: "blur(12px)", 
      position: "sticky", 
      top: 0, 
      zIndex: 50 
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ 
          display: "grid", 
          placeItems: "center", 
          width: 28, 
          height: 28, 
          borderRadius: 8, 
          background: "var(--accent-strong)", 
          color: "var(--void)" 
        }}>
          <Icon icon="solar:graph-up-linear" size={17} />
        </span>
        <span style={{ 
          fontFamily: "var(--font-mono)", 
          fontSize: 14, 
          fontWeight: 600, 
          letterSpacing: "0.04em", 
          color: "var(--ink)" 
        }}>HEX·YT·INTEL</span>
      </div>
      <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <Link href="/pricing" className="btn-secondary" style={{ textDecoration: "none" }}>
          Pricing
        </Link>
        <Link href="/auth/signin" className="btn-primary" style={{ textDecoration: "none" }}>
          <Icon icon="solar:sun-bold-duotone" size={16} />
          Sign in
        </Link>
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section style={{ textAlign: "center", paddingTop: 80, paddingBottom: 80, maxWidth: 1280, margin: "0 auto", padding: "80px 32px", width: "100%" }}>
      <div style={{ maxWidth: "52ch", margin: "0 auto" }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// YouTube → knowledge graph"}</p>
        <h1 className="hx-display" style={{ marginTop: 16, marginBottom: 12 }}>
          Drop a video. Get a synthesis.
        </h1>
        <p className="hx-body-lg" style={{ maxWidth: "54ch", margin: "0 auto" }}>
          Transcript, claims, frameworks, and contrarian takes — structured across the most important dimensions, mapped into your knowledge graph, searchable in seconds.
        </p>
        <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 12 }}>
          <Link href="/dashboard" className="btn-primary" style={{ textDecoration: "none" }}>
            <Icon icon="solar:bolt-linear" size={16} />
            Try it free
          </Link>
          <Link href="/pricing" className="btn-secondary" style={{ textDecoration: "none" }}>
            See a sample
            <Icon icon="solar:arrow-right-linear" size={16} />
          </Link>
        </div>
      </div>
      {/* Product Still Placeholder */}
      <div style={{ 
        marginTop: 48, 
        padding: 32, 
        borderRadius: 16, 
        border: "1px solid rgb(148 163 184 / 0.18)", 
        background: "rgb(26 31 43 / 0.6)",
        boxShadow: "0 24px 48px -12px rgba(0,0,0,0.5)"
      }}>
        <div style={{ 
          height: 320, 
          background: "linear-gradient(135deg, rgb(51 65 85 / 0.3) 0%, transparent 60%)", 
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
          color: "var(--ink-muted)",
          fontSize: 12
        }}>
          [ PROPRIETARY SYNTHESIS ENGINE INTERFACE ]
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    { icon: "solar:target-linear", title: "Core thesis", desc: "The central claim distilled to one clear sentence." },
    { icon: "solar:chat-square-like-linear", title: "Key arguments", desc: "Supporting points ranked by relevance and evidence strength." },
    { icon: "solar:database-linear", title: "Evidence", desc: "Citations, timestamps, and source material linked." },
    { icon: "solar:widget-5-linear", title: "Frameworks", desc: "Mental models and applicable systems thinking." },
    { icon: "solar:users-group-rounded-linear", title: "Entities", desc: "People, companies, products mentioned and mapped." },
    { icon: "solar:bolt-linear", title: "Tactics", desc: "Actionable techniques and implementation methods." },
  ];
  return (
    <section id="features" style={{ borderTop: "1px solid var(--line)", padding: "80px 32px", maxWidth: 1280, margin: "0 auto", width: "100%" }}>
      <div style={{ maxWidth: "52ch", marginBottom: 48 }}>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// Multi-dimension synthesis"}</p>
        <h2 className="hx-h2" style={{ marginTop: 12 }}>The UCIS model.</h2>
        <p className="hx-body-lg">Every video is parsed across the most important semantic dimensions. You get the full picture — not a summary, a structured synthesis.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
        {features.map((f) => (
          <div key={f.title} className="hx-glow" style={{ padding: 20, background: "rgb(26 31 43 / 0.6)", border: "1px solid var(--line)", borderRadius: 16 }}>
            <Icon icon={f.icon} size={24} style={{ color: "var(--accent)" }} />
            <h3 style={{ marginTop: 12, marginBottom: 0, fontSize: 18, fontWeight: 500, color: "var(--ink)" }}>{f.title}</h3>
            <p style={{ fontSize: 14, color: "var(--ink-secondary)", marginTop: 8, lineHeight: 1.5 }}>{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <div style={{ background: "var(--void)", color: "var(--ink)", minHeight: "100vh", minWidth: "320px", display: "flex", flexDirection: "column" }}>
      <Nav />
      <main style={{ flex: 1 }}>
        <Hero />
        <Features />
        
        {/* Pricing Summary */}
        <section style={{ borderTop: "1px solid var(--line)", padding: "80px 32px", maxWidth: 1280, margin: "0 auto", width: "100%" }}>
          <div style={{ maxWidth: "52ch", marginBottom: 48 }}>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-muted)", margin: 0 }}>{"// Investment"}</p>
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Simple, transparent pricing.</h2>
            <p className="hx-body-lg">Pay for what you use. Scale when you&apos;re ready.</p>
          </div>
          
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, marginBottom: 40 }}>
            {[
              { name: "Free", price: "$0", desc: "Individual experimenters", isPro: false },
              { name: "Pro", price: "$9", desc: "Serious content analysts", isPro: true },
              { name: "Enterprise", price: "$99", desc: "For high-volume operations", isPro: false, isEnterprise: true },
            ].map((p) => (
              <div key={p.name} style={{ padding: 32, border: p.isPro || (p as any).isEnterprise ? "1px solid var(--accent)" : "1px solid var(--line)", borderRadius: 16, background: "rgb(26 31 43 / 0.6)" }}>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{p.name}</h3>
                <p style={{ margin: "4px 0 0", fontSize: 32, fontWeight: 500, color: "var(--accent)" }}>{p.price}</p>
                <p style={{ margin: "2px 0 20px", fontSize: 13, color: "var(--ink-secondary)" }}>{p.desc}</p>
                <Link href="/pricing" className={p.isPro ? "btn-primary" : "btn-secondary"} style={{ width: "100%", textDecoration: "none", display: "flex", justifyContent: "center" }}>
                  {(p as any).isEnterprise ? "Contact Sales" : "Get started"}
                </Link>
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center" }}>
             <Link href="/pricing#compare" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 8 }}>
                Compare all features <Icon icon="solar:arrow-right-linear" size={14} />
             </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
