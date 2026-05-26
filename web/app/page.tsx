'use client';

import { useEffect, useState } from 'react';
import HomeContent from '@/components/organisms/HomeContent';
import { useAuth } from '@/hooks/useAuth';

function LandingPage() {
  const [mounted, setMounted] = useState(false);
  const [headerBlurred, setHeaderBlurred] = useState(false);
  const [fadeInElements, setFadeInElements] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const handleScroll = () => {
      setHeaderBlurred(window.scrollY > 50);
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          setFadeInElements((prev) => new Set([...prev, id]));
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('[data-fade-in]').forEach((el) => {
      if (el.id) observer.observe(el);
    });

    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-black text-white overflow-x-hidden">
      {/* Header */}
      <header
        className={`fixed top-0 left-0 right-0 z-50 px-6 transition-all duration-300 border-b border-cyan-500/10 ${
          headerBlurred ? 'bg-black/80 backdrop-blur-md' : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto h-16 flex items-center justify-between gap-8">
          {/* Logo */}
          <div className="flex items-center gap-3 font-semibold text-cyan-500 flex-shrink-0">
            <div className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-sm" />
            <span className="text-sm">hex-yt-intel</span>
          </div>

          {/* Nav */}
          <nav className="flex items-center gap-1 flex-1">
            <a
              href="#"
              onClick={() => (window.location.href = '/dashboard')}
              className="px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              Analyze
            </a>
            <a
              href="#"
              onClick={() => (window.location.href = '/search')}
              className="px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
            >
              Learn
            </a>
            <a
              href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              Docs
            </a>
          </nav>

          {/* CTA */}
          <div className="flex-shrink-0">
            <button
              onClick={() => (window.location.href = '/dashboard')}
              className="px-6 py-3 rounded-full text-sm font-semibold text-black bg-gradient-to-r from-cyan-500 to-blue-500 hover:shadow-lg hover:shadow-cyan-500/30 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
            >
              Get Started
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center pt-20 px-6">
        <div
          id="hero-content"
          data-fade-in
          className={`text-center max-w-4xl mx-auto transition-all duration-1000 ${
            fadeInElements.has('hero-content')
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-5'
          }`}
        >
          <div className="text-sm font-semibold text-cyan-400 uppercase tracking-widest mb-6 opacity-80">
            YouTube Intelligence Platform
          </div>

          <h1 className="text-6xl md:text-7xl lg:text-8xl font-semibold leading-tight mb-8 -tracking-wide">
            Knowledge is more than<br />
            <span className="bg-gradient-to-r from-cyan-500 to-blue-500 bg-clip-text text-transparent">
              data points.
            </span>
            <br />
            Let there be light.
          </h1>

          <p className="text-lg md:text-xl text-white/70 mb-12 max-w-2xl mx-auto leading-relaxed">
            Transform YouTube content into actionable insights. Semantic analysis, real-time
            transcription, and intelligence synthesis — all in one platform.
          </p>

          <div className="flex gap-4 justify-center flex-wrap">
            <button
              onClick={() => (window.location.href = '/dashboard')}
              className="px-8 py-3 rounded-full text-base font-semibold text-black bg-gradient-to-r from-cyan-500 to-blue-500 hover:shadow-lg hover:shadow-cyan-500/40 hover:-translate-y-1 transition-all duration-300 cursor-pointer"
            >
              Start Analyzing Free
            </button>
            <a
              href="https://github.com/Hex-Tech-Lab/hex-yt-intel/wiki"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3 rounded-full text-base font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-all duration-300"
            >
              View Documentation
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-6 border-t border-cyan-500/10">
        <div className="max-w-7xl mx-auto">
          <div
            id="features-header"
            data-fade-in
            className={`text-center mb-16 transition-all duration-1000 ${
              fadeInElements.has('features-header')
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-5'
            }`}
          >
            <h2 className="text-4xl md:text-5xl font-semibold mb-6">
              Everything you need for YouTube intelligence
            </h2>
            <p className="text-xl text-white/70 max-w-2xl mx-auto">
              Comprehensive tools to analyze, search, and synthesize YouTube content
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                id: 'feature-1',
                title: 'Semantic Analysis',
                description: 'AI-powered content understanding and relationship mapping',
              },
              {
                id: 'feature-2',
                title: 'Real-time Transcription',
                description: 'Accurate speech-to-text with multi-language support',
              },
              {
                id: 'feature-3',
                title: 'Intelligence Synthesis',
                description: 'Automated report generation and insight extraction',
              },
            ].map((feature) => (
              <div
                key={feature.id}
                id={feature.id}
                data-fade-in
                className={`p-8 border border-cyan-500/20 rounded-lg bg-cyan-500/5 hover:bg-cyan-500/10 transition-all duration-300 ${
                  fadeInElements.has(feature.id)
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-5'
                }`}
              >
                <h3 className="text-xl font-semibold mb-4">{feature.title}</h3>
                <p className="text-white/70">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 border-t border-cyan-500/10">
        <div
          id="cta-section"
          data-fade-in
          className={`max-w-4xl mx-auto text-center transition-all duration-1000 ${
            fadeInElements.has('cta-section')
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-5'
          }`}
        >
          <h2 className="text-4xl md:text-5xl font-semibold mb-6">
            Ready to unlock YouTube intelligence?
          </h2>
          <p className="text-xl text-white/70 mb-8 max-w-2xl mx-auto">
            Join thousands of creators, researchers, and teams using hex-yt-intel to transform their content strategy.
          </p>
          <button
            onClick={() => (window.location.href = '/dashboard')}
            className="px-10 py-4 rounded-full text-lg font-semibold text-black bg-gradient-to-r from-cyan-500 to-blue-500 hover:shadow-lg hover:shadow-cyan-500/40 hover:-translate-y-1 transition-all duration-300 cursor-pointer"
          >
            Start Free Trial
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-cyan-500/10 py-12 px-6 bg-black/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div className="flex flex-col gap-4">
              <div className="text-xs font-semibold text-cyan-400 uppercase letter-spacing-wider">
                Product
              </div>
              <a
                href="#"
                onClick={() => (window.location.href = '/dashboard')}
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors cursor-pointer"
              >
                Analyzer
              </a>
              <a
                href="#"
                onClick={() => (window.location.href = '/dashboard')}
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors cursor-pointer"
              >
                Dashboard
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                API
              </a>
            </div>

            <div className="flex flex-col gap-4">
              <div className="text-xs font-semibold text-cyan-400 uppercase letter-spacing-wider">
                Resources
              </div>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/wiki"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                Documentation
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                Blog
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                GitHub
              </a>
            </div>

            <div className="flex flex-col gap-4">
              <div className="text-xs font-semibold text-cyan-400 uppercase letter-spacing-wider">
                Company
              </div>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                About
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/main/PRIVACY.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                Privacy
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/main/TERMS.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                Terms
              </a>
            </div>

            <div className="flex flex-col gap-4">
              <div className="text-xs font-semibold text-cyan-400 uppercase letter-spacing-wider">
                Social
              </div>
              <a
                href="https://x.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                Twitter
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                GitHub
              </a>
              <a
                href="https://discord.gg"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-white/60 hover:text-cyan-400 transition-colors"
              >
                Discord
              </a>
            </div>
          </div>

          <div className="border-t border-cyan-500/10 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="text-xs text-white/50">
              © 2026 hex-yt-intel. All rights reserved.
            </div>
            <div className="text-xs text-white/50">
              Knowledge is more than data points. Let there be light.
            </div>
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
