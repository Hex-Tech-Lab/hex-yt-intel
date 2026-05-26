'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import HomeContent from '@/components/organisms/HomeContent';
import styles from './page.module.css';

function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollY, setScrollY] = useState(0);
  const [fadeInElements, setFadeInElements] = useState<Set<string>>(new Set());

  // Hero light beam animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number | null = null;
    let isVisible = false;
    let frame = 0;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = canvas.parentElement?.clientHeight || 600;
    };

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      ctx!.clearRect(0, 0, W, H);

      const centerX = W / 2;
      const beamTop = 100;
      const beamWidth = 400;
      const beamHalfWidth = beamWidth / 2;
      const isMobile = W < 900;
      const beamHeight = isMobile ? 500 : 600;
      const landingRadius = isMobile ? 250 : 350;

      // Animated light beam
      const gradient = ctx!.createRadialGradient(
        centerX, beamTop, 80,
        centerX, beamTop + 300, landingRadius
      );

      const pulse = Math.sin(frame * 0.02) * 0.2 + 0.8;

      gradient.addColorStop(0, `rgba(61, 127, 255, ${0.4 * pulse})`);
      gradient.addColorStop(0.3, `rgba(61, 127, 255, ${0.15 * pulse})`);
      gradient.addColorStop(0.6, `rgba(61, 127, 255, ${0.05 * pulse})`);
      gradient.addColorStop(1, 'rgba(61, 127, 255, 0)');

      ctx!.fillStyle = gradient;
      ctx!.fillRect(centerX - beamHalfWidth, beamTop, beamWidth, beamHeight);

      frame++;
    };

    const scheduleFrame = () => {
      if (!isVisible) {
        animationId = null;
        return;
      }
      draw();
      animationId = requestAnimationFrame(scheduleFrame);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const wasVisible = isVisible;
        isVisible = entry.isIntersecting;
        if (!wasVisible && isVisible && !animationId) {
          scheduleFrame();
        }
      },
      { threshold: 0.01 }
    );

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    observer.observe(canvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      observer.disconnect();
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, []);

  // Scroll handler for header effects
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Fade-in observer for sections
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.id;
            setFadeInElements((prev) => new Set([...prev, id]));
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll('[data-fade-in]').forEach((el) => {
      if (el.id) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--grey-1)', color: '#fff', overflowX: 'hidden' }}>
      {/* Hero Canvas Background */}
      <canvas
        ref={canvasRef}
        className={styles.heroLightCanvas}
      />

      {/* Header */}
      <header
        className={styles.header}
        style={{
          background: scrollY > 50 ? 'rgba(9, 10, 12, 0.8)' : 'transparent',
          backdropFilter: scrollY > 50 ? 'blur(12px)' : 'none',
          borderBottom: scrollY > 50 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
        }}
      >
        <div className={styles.headerInner}>
          {/* Logo */}
          <div className={styles.logo} style={{ color: '#fff' }}>
            <div style={{ width: '28px', height: '28px', background: 'linear-gradient(135deg, #3d7eff, #3d7eff)', borderRadius: '8px' }} />
            <span>hex-yt-intel</span>
          </div>

          {/* Nav */}
          <nav className={styles.nav}>
            <a
              href="#"
              onClick={() => (window.location.href = '/dashboard')}
              className={styles.navItem}
            >
              Analyze
            </a>
            <a
              href="#"
              onClick={() => (window.location.href = '/search')}
              className={styles.navItem}
            >
              Learn
            </a>
            <a
              href="#pricing"
              className={styles.navItem}
            >
              Pricing
            </a>
            <a
              href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.navItem}
            >
              Docs
            </a>
          </nav>

          {/* CTA */}
          <div className={styles.headerActions}>
            <button
              onClick={() => (window.location.href = '/dashboard')}
              className={styles.btnPrimary}
            >
              Get Started
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div
            id="hero-badge"
            data-fade-in
            className={`${styles.heroBadge} ${
              fadeInElements.has('hero-badge') ? styles.visible : ''
            }`}
            style={{
              opacity: fadeInElements.has('hero-badge') ? 1 : 0,
              transform: fadeInElements.has('hero-badge') ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 1s ease, transform 1s ease',
            }}
          >
            <div className={styles.dot} />
            YouTube Intelligence Platform
          </div>

          <h1
            id="hero-title"
            data-fade-in
            className={styles.heroH1}
            style={{
              opacity: fadeInElements.has('hero-title') ? 1 : 0,
              transform: fadeInElements.has('hero-title') ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 1s ease, transform 1s ease',
            }}
          >
            Knowledge is more than
            <br />
            data points.
            <br />
            Let there be light.
          </h1>

          <p
            id="hero-description"
            data-fade-in
            className={styles.heroP}
            style={{
              opacity: fadeInElements.has('hero-description') ? 1 : 0,
              transform: fadeInElements.has('hero-description') ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 1s ease, transform 1s ease',
            }}
          >
            Transform YouTube content into actionable insights. Semantic analysis, real-time
            transcription, and intelligence synthesis — all in one platform.
          </p>

          <div
            id="hero-cta"
            data-fade-in
            className={styles.heroCta}
            style={{
              opacity: fadeInElements.has('hero-cta') ? 1 : 0,
              transform: fadeInElements.has('hero-cta') ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 1s ease, transform 1s ease',
            }}
          >
            <button
              onClick={() => (window.location.href = '/dashboard')}
              className={styles.btnPrimary}
            >
              Start Analyzing Free
            </button>
            <a
              href="https://github.com/Hex-Tech-Lab/hex-yt-intel/wiki"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.btnSecondary}
            >
              View Documentation
            </a>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section
        id="stats"
        data-fade-in
        className={styles.section}
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          opacity: fadeInElements.has('stats') ? 1 : 0,
          transform: fadeInElements.has('stats') ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 1s ease, transform 1s ease',
        }}
      >
        <div className={styles.sectionInner} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '32px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '8px' }}>1M+</div>
            <div style={{ color: 'var(--grey-50)' }}>Videos Analyzed</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '8px' }}>500K+</div>
            <div style={{ color: 'var(--grey-50)' }}>Active Users</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '8px' }}>99.9%</div>
            <div style={{ color: 'var(--grey-50)' }}>Uptime Guaranteed</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '8px' }}>24/7</div>
            <div style={{ color: 'var(--grey-50)' }}>Expert Support</div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={styles.section} style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div className={styles.sectionInner}>
          <div
            id="features-header"
            data-fade-in
            style={{
              textAlign: 'center',
              marginBottom: '64px',
              opacity: fadeInElements.has('features-header') ? 1 : 0,
              transform: fadeInElements.has('features-header') ? 'translateY(0)' : 'translateY(20px)',
              transition: 'opacity 1s ease, transform 1s ease',
            }}
          >
            <h2 style={{ fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: '600', marginBottom: '24px' }}>
              Everything you need for YouTube intelligence
            </h2>
            <p style={{ fontSize: '17px', color: 'var(--grey-50)', maxWidth: '520px', margin: '0 auto', lineHeight: '1.65' }}>
              Comprehensive tools to analyze, search, and synthesize YouTube content
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '32px' }}>
            {[
              {
                id: 'feature-semantic',
                title: 'Semantic Analysis',
                description: 'AI-powered content understanding and relationship mapping',
              },
              {
                id: 'feature-transcription',
                title: 'Real-time Transcription',
                description: 'Accurate speech-to-text with multi-language support',
              },
              {
                id: 'feature-synthesis',
                title: 'Intelligence Synthesis',
                description: 'Automated report generation and insight extraction',
              },
            ].map((feature) => (
              <div
                key={feature.id}
                id={feature.id}
                data-fade-in
                style={{
                  padding: '32px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  background: 'rgba(255, 255, 255, 0.02)',
                  opacity: fadeInElements.has(feature.id) ? 1 : 0,
                  transform: fadeInElements.has(feature.id) ? 'translateY(0)' : 'translateY(20px)',
                  transition: 'opacity 1s ease, transform 1s ease, background 0.3s',
                }}
              >
                <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>{feature.title}</h3>
                <p style={{ color: 'var(--grey-50)', lineHeight: '1.6' }}>{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className={styles.section} style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div
          id="cta-final"
          data-fade-in
          style={{
            maxWidth: '900px',
            margin: '0 auto',
            textAlign: 'center',
            opacity: fadeInElements.has('cta-final') ? 1 : 0,
            transform: fadeInElements.has('cta-final') ? 'translateY(0)' : 'translateY(20px)',
            transition: 'opacity 1s ease, transform 1s ease',
          }}
        >
          <h2 style={{ fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: '600', marginBottom: '24px' }}>
            Ready to unlock YouTube intelligence?
          </h2>
          <p style={{ fontSize: '17px', color: 'var(--grey-50)', marginBottom: '32px', maxWidth: '520px', margin: '0 auto 32px', lineHeight: '1.65' }}>
            Join thousands of creators, researchers, and teams using hex-yt-intel to transform
            their content strategy.
          </p>
          <button
            onClick={() => (window.location.href = '/dashboard')}
            className={styles.btnPrimary}
            style={{ padding: '14px 28px', fontSize: '15px' }}
          >
            Start Free Trial
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', padding: '48px 24px', background: 'rgba(9, 10, 12, 0.8)', backdropFilter: 'blur(12px)' }}>
        <div className={styles.sectionInner}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '32px', marginBottom: '32px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Product
              </div>
              <a
                href="#"
                onClick={() => (window.location.href = '/dashboard')}
                style={{ fontSize: '14px', color: 'var(--grey-50)', cursor: 'pointer' }}
              >
                Analyzer
              </a>
              <a
                href="#"
                onClick={() => (window.location.href = '/dashboard')}
                style={{ fontSize: '14px', color: 'var(--grey-50)', cursor: 'pointer' }}
              >
                Dashboard
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                API
              </a>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Resources
              </div>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/wiki"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                Documentation
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                Blog
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                GitHub
              </a>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Company
              </div>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                About
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/main/PRIVACY.md"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                Privacy
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/main/TERMS.md"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                Terms
              </a>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Social
              </div>
              <a
                href="https://x.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                Twitter
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                GitHub
              </a>
              <a
                href="https://discord.gg"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '14px', color: 'var(--grey-50)' }}
              >
                Discord
              </a>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '32px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
            <div style={{ fontSize: '12px', color: 'var(--grey-50)' }}>© 2026 hex-yt-intel. All rights reserved.</div>
            <div style={{ fontSize: '12px', color: 'var(--grey-50)' }}>Knowledge is more than data points. Let there be light.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  const { user, isLoading } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || isLoading) {
    return null;
  }

  return user ? <HomeContent /> : <LandingPage />;
}
