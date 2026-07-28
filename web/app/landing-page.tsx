'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Badge } from '@astryxdesign/core/Badge';
import { Divider } from '@astryxdesign/core/Divider';
import { Icon } from '@/components/templates/_shared/primitives';
import { Footer } from '@/components/Footer';

/**
 * LANDING PAGE - ASTRYX ROLLOUT + MOTION
 * ---------------------------------------
 * Public marketing surface (pre-signup). Uses @astryxdesign/core primitives
 * (Button/Card/Badge/Divider) layered on the existing hx-* design tokens,
 * plus framer-motion entrance choreography and CSS "living" glow reusing
 * the hx-pulse/hx-rise keyframes already defined in globals.css.
 */

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

function Nav() {
  return (
    <header style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      // Shrink chrome on narrow viewports so the nav never overflows the screen
      // (the Sign-in button was clipping off the right edge on mobile).
      padding: "12px clamp(14px, 4vw, 32px)",
      borderBottom: "1px solid var(--line)",
      background: "rgb(17 20 29 / 0.7)",
      backdropFilter: "blur(12px)",
      position: "sticky",
      top: 0,
      zIndex: 50,
      maxWidth: "100%",
      boxSizing: "border-box",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <span style={{
          display: "grid",
          placeItems: "center",
          width: 28,
          height: 28,
          flex: "none",
          borderRadius: 8,
          background: "var(--accent-strong)",
          color: "var(--void)"
        }}>
          <Icon icon="solar:graph-up-linear" size={17} />
        </span>
        <span style={{
          fontFamily: "var(--font-mono)",
          fontSize: "clamp(11px, 3.4vw, 14px)",
          fontWeight: 600,
          letterSpacing: "0.04em",
          color: "var(--ink)",
          whiteSpace: "nowrap",
        }}>HEX·YT·INTEL</span>
      </div>
      <nav style={{ display: "flex", gap: "clamp(6px, 2vw, 16px)", alignItems: "center", flex: "none" }}>
        <Button label="Pricing" variant="ghost" as={Link} href="/pricing" />
        <Button label="Sign in" variant="primary" as={Link} href="/auth/signin" />
      </nav>
    </header>
  );
}

function Hero() {
  return (
    <section style={{ position: "relative", textAlign: "center", maxWidth: 1280, margin: "0 auto", padding: "80px 32px", width: "100%" }}>
      <motion.div
        initial="hidden"
        animate="show"
        variants={fadeUp}
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{ position: "relative", maxWidth: "52ch", margin: "0 auto" }}
      >
        <Badge variant="cyan" label="// YouTube → knowledge graph" />
        <h1 className="hx-display" style={{ marginTop: 16, marginBottom: 12 }}>
          Drop a video. Get a synthesis.
        </h1>
        <p className="hx-body-lg" style={{ maxWidth: "54ch", margin: "0 auto" }}>
          Transcript, claims, frameworks, and contrarian takes — structured across the most important dimensions, mapped into your knowledge graph, searchable in seconds.
        </p>
        <div style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 12 }}>
          <Button
            label="Try it free"
            variant="primary"
            icon={<Icon icon="solar:bolt-linear" size={16} />}
            as={Link}
            href="/dashboard"
          />
          <Button
            label="See a sample"
            variant="secondary"
            endContent={<Icon icon="solar:arrow-right-linear" size={16} />}
            as={Link}
            href="/pricing"
          />
        </div>
      </motion.div>

      {/* Product Still Placeholder — living glow, breathes via hx-pulse */}
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 }}
        style={{ position: "relative" }}
      >
        <Card
          variant="default"
          padding={4}
          className="hx-glow"
          style={{
            marginTop: 48,
            boxShadow: "0 24px 48px -12px rgba(0,0,0,0.5)",
          }}
        >
          <div
            className="hx-pulse"
            style={{
              height: 320,
              background: "linear-gradient(135deg, rgb(51 65 85 / 0.3) 0%, transparent 60%)",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              color: "var(--ink-muted)",
              fontSize: 12,
              animationDuration: "4s",
            }}
          >
            [ PROPRIETARY SYNTHESIS ENGINE INTERFACE ]
          </div>
        </Card>
      </motion.div>
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
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5 }}
        style={{ maxWidth: "52ch", marginBottom: 48 }}
      >
        <Badge variant="neutral" label="// Multi-dimension synthesis" />
        <h2 className="hx-h2" style={{ marginTop: 12 }}>The UCIS model.</h2>
        <p className="hx-body-lg">Every video is parsed across the most important semantic dimensions. You get the full picture — not a summary, a structured synthesis.</p>
      </motion.div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
        {features.map((feature, i) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: i * 0.06 }}
            whileHover={{ y: -4 }}
          >
            <Card variant="default" padding={4} className="hx-glow">
              <Icon icon={feature.icon} size={24} style={{ color: "var(--accent)" }} />
              <h3 style={{ marginTop: 12, marginBottom: 0, fontSize: 18, fontWeight: 500, color: "var(--ink)" }}>{feature.title}</h3>
              <p style={{ fontSize: 14, color: "var(--ink-secondary)", marginTop: 8, lineHeight: 1.5 }}>{feature.desc}</p>
            </Card>
          </motion.div>
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
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.5 }}
            style={{ maxWidth: "52ch", marginBottom: 48 }}
          >
            <Badge variant="neutral" label="// Investment" />
            <h2 className="hx-h2" style={{ marginTop: 12 }}>Simple, transparent pricing.</h2>
            <p className="hx-body-lg">Pay for what you use. Scale when you&apos;re ready.</p>
          </motion.div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 24, marginBottom: 40 }}>
            {[
              { name: "Free", price: "$0", desc: "Individual experimenters", isPro: false },
              { name: "Pro", price: "$9", desc: "Serious content analysts", isPro: true },
              { name: "Enterprise", price: "$99", desc: "For high-volume operations", isPro: false, isEnterprise: true },
            ].map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: i * 0.08 }}
                whileHover={{ y: -4 }}
              >
                <Card
                  variant={plan.isPro || plan.isEnterprise ? "cyan" : "default"}
                  padding={8}
                  className={plan.isPro ? "hx-glow" : undefined}
                >
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{plan.name}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 32, fontWeight: 500, color: "var(--accent)" }}>{plan.price}</p>
                  <p style={{ margin: "2px 0 20px", fontSize: 13, color: "var(--ink-secondary)" }}>{plan.desc}</p>
                  <Button
                    label={plan.isEnterprise ? "Contact Sales" : "Get started"}
                    variant={plan.isPro ? "primary" : "secondary"}
                    width="100%"
                    as={Link}
                    href="/pricing"
                  />
                </Card>
              </motion.div>
            ))}
          </div>

          <Divider />

          <div style={{ textAlign: "center", marginTop: 24 }}>
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
