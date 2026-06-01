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

  // Scroll-reveal helper — translates the prior inline opacity/transform fade 1:1 to Tailwind.
  // Module classes (.heroBadge/.heroH1/.heroP/.heroCta) do not set opacity/transform, so no cascade conflict.
  const fade = (id: string) =>
    `transition-[opacity,transform] duration-1000 [transition-timing-function:ease] ${
      fadeInElements.has(id) ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
    }`;

  return (
    <div className="min-h-screen bg-[var(--grey-1)] text-white overflow-x-hidden">
      {/* Hero Canvas Background */}
      <canvas
        ref={canvasRef}
        className={styles.heroLightCanvas}
      />

      {/* Header */}
      <header
        className={`${styles.header} ${
          scrollY > 50
            ? 'bg-[rgba(9,10,12,0.8)] backdrop-blur-[12px] border-b border-white/5'
            : 'bg-transparent'
        }`}
      >
        <div className={styles.headerInner}>
          {/* Logo */}
          <div className={`${styles.logo} text-white`}>
            <div className="w-7 h-7 rounded-control bg-[linear-gradient(135deg,#3d7eff,#3d7eff)]" />
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
            className={`${styles.heroBadge} ${fade('hero-badge')}`}
          >
            <div className={styles.dot} />
            YouTube Intelligence Platform
          </div>

          <h1
            id="hero-title"
            data-fade-in
            className={`${styles.heroH1} ${fade('hero-title')}`}
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
            className={`${styles.heroP} ${fade('hero-description')}`}
          >
            Transform YouTube content into actionable insights. Semantic analysis, real-time
            transcription, and intelligence synthesis — all in one platform.
          </p>

          <div
            id="hero-cta"
            data-fade-in
            className={`${styles.heroCta} ${fade('hero-cta')}`}
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
        className={`${styles.section} border-t border-white/5 ${fade('stats')}`}
      >
        <div className={`${styles.sectionInner} grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-8`}>
          <div className="text-center">
            <div className="text-[32px] font-bold mb-2">1M+</div>
            <div className="text-[var(--grey-50)]">Videos Analyzed</div>
          </div>
          <div className="text-center">
            <div className="text-[32px] font-bold mb-2">500K+</div>
            <div className="text-[var(--grey-50)]">Active Users</div>
          </div>
          <div className="text-center">
            <div className="text-[32px] font-bold mb-2">99.9%</div>
            <div className="text-[var(--grey-50)]">Uptime Guaranteed</div>
          </div>
          <div className="text-center">
            <div className="text-[32px] font-bold mb-2">24/7</div>
            <div className="text-[var(--grey-50)]">Expert Support</div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className={`${styles.section} border-t border-white/5`}>
        <div className={styles.sectionInner}>
          <div
            id="features-header"
            data-fade-in
            className={`text-center mb-16 ${fade('features-header')}`}
          >
            <h2 className="text-[clamp(32px,5vw,48px)] font-semibold mb-6">
              Everything you need for YouTube intelligence
            </h2>
            <p className="text-[17px] text-[var(--grey-50)] max-w-[520px] mx-auto leading-[1.65]">
              Comprehensive tools to analyze, search, and synthesize YouTube content
            </p>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-8">
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
                className={`p-8 border border-white/10 rounded-xl bg-white/[0.02] ${fade(feature.id)}`}
              >
                <h3 className="text-lg font-semibold mb-4">{feature.title}</h3>
                <p className="text-[var(--grey-50)] leading-[1.6]">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className={`${styles.section} border-t border-white/5`}>
        <div
          id="cta-final"
          data-fade-in
          className={`max-w-[900px] mx-auto text-center ${fade('cta-final')}`}
        >
          <h2 className="text-[clamp(32px,5vw,48px)] font-semibold mb-6">
            Ready to unlock YouTube intelligence?
          </h2>
          <p className="text-[17px] text-[var(--grey-50)] max-w-[520px] mx-auto mb-8 leading-[1.65]">
            Join thousands of creators, researchers, and teams using hex-yt-intel to transform
            their content strategy.
          </p>
          <button
            onClick={() => (window.location.href = '/dashboard')}
            className={`${styles.btnPrimary} px-7 py-[14px] text-[15px]`}
          >
            Start Free Trial
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 px-6 py-12 bg-[rgba(9,10,12,0.8)] backdrop-blur-[12px]">
        <div className={styles.sectionInner}>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-8 mb-8">
            <div className="flex flex-col gap-4">
              <div className="text-xs font-semibold text-[var(--blue)] uppercase tracking-[1px]">
                Product
              </div>
              <a
                href="#"
                onClick={() => (window.location.href = '/dashboard')}
                className="text-sm text-[var(--grey-50)] cursor-pointer"
              >
                Analyzer
              </a>
              <a
                href="#"
                onClick={() => (window.location.href = '/dashboard')}
                className="text-sm text-[var(--grey-50)] cursor-pointer"
              >
                Dashboard
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                API
              </a>
            </div>

            <div className="flex flex-col gap-4">
              <div className="text-xs font-semibold text-[var(--blue)] uppercase tracking-[1px]">
                Resources
              </div>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/wiki"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                Documentation
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                Blog
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                GitHub
              </a>
            </div>

            <div className="flex flex-col gap-4">
              <div className="text-xs font-semibold text-[var(--blue)] uppercase tracking-[1px]">
                Company
              </div>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                About
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/main/PRIVACY.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                Privacy
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/main/TERMS.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                Terms
              </a>
            </div>

            <div className="flex flex-col gap-4">
              <div className="text-xs font-semibold text-[var(--blue)] uppercase tracking-[1px]">
                Social
              </div>
              <a
                href="https://x.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                Twitter
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                GitHub
              </a>
              <a
                href="https://discord.gg"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--grey-50)]"
              >
                Discord
              </a>
            </div>
          </div>

          <div className="border-t border-white/5 pt-8 flex flex-col justify-between items-center gap-4">
            <div className="text-xs text-[var(--grey-50)]">© 2026 hex-yt-intel. All rights reserved.</div>
            <div className="text-xs text-[var(--grey-50)]">Knowledge is more than data points. Let there be light.</div>
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
