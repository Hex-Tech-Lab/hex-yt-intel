'use client';

import { useState, useEffect } from 'react';
import { LandingThree } from '@/components/LandingThree';

export function LandingPage() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30 overflow-x-hidden">
      {/* WebGL Particle Background */}
      <LandingThree />

      {/* Content Wrapper */}
      <div className="relative z-10">
        {/* Header */}
        <header
          className={`fixed top-0 left-0 right-0 z-50 px-6 transition-all duration-300 ${
            scrollY > 50 ? 'bg-black/70 backdrop-blur-md border-b border-cyan-500/10' : 'bg-transparent'
          }`}
        >
          <div className="max-w-[1200px] mx-auto h-16 flex items-center justify-between gap-8">
            <div className="flex items-center gap-3 text-lg font-semibold tracking-tight text-cyan-500">
              <div className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-sky-400 rounded-md" />
              <span>hex-yt-intel</span>
            </div>
            
            <nav className="hidden md:flex items-center gap-1 flex-1">
              {['Analyze', 'Learn', 'Docs'].map((item) => (
                <a
                  key={item}
                  href="#"
                  className="px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-all"
                >
                  {item}
                </a>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <button
                onClick={() => (window.location.href = '/dashboard')}
                className="px-6 py-3 rounded-full text-sm font-semibold bg-gradient-to-br from-cyan-500 to-sky-400 text-black shadow-[0_4px_8px_rgba(6,182,212,0.3)] hover:-translate-y-0.5 hover:shadow-[0_8px_16px_rgba(6,182,212,0.4)] transition-all active:translate-y-0"
              >
                Get Started
              </button>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section className="min-h-screen flex items-center justify-center p-5 pt-32">
          <div className="max-w-[900px] text-center animate-[fadeInUp_1.2s_ease-out]">
            <div className="text-sm font-medium text-cyan-500 tracking-[1px] uppercase mb-6 opacity-80">
              YouTube Intelligence Platform
            </div>

            <h1 className="text-[clamp(36px,8vw,72px)] font-semibold leading-[1.1] mb-8 tracking-tight">
              Knowledge is more than<br />
              <span className="bg-gradient-to-br from-cyan-500 to-sky-400 bg-clip-text text-transparent">
                data points.
              </span><br />
              Let there be light.
            </h1>

            <p className="text-lg md:text-xl text-white/70 mb-12 max-w-[600px] mx-auto leading-relaxed">
              Transform YouTube content into actionable insights. Semantic analysis, real-time transcription, and intelligence synthesis — all in one platform.
            </p>

            <div className="flex flex-wrap gap-4 justify-center">
              <button
                onClick={() => (window.location.href = '/dashboard')}
                className="px-8 py-4 rounded-full text-sm font-semibold bg-gradient-to-br from-cyan-500 to-sky-400 text-black shadow-[0_4px_8px_rgba(6,182,212,0.3)] hover:-translate-y-0.5 hover:shadow-[0_8px_16px_rgba(6,182,212,0.4)] transition-all"
              >
                Start Analyzing Free
              </button>
              <button
                className="px-8 py-4 rounded-full text-sm font-semibold bg-cyan-500/10 border border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/20 transition-all"
              >
                View Documentation
              </button>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="relative z-10 border-t border-cyan-500/10 px-6 py-12 bg-black/50 backdrop-blur-md">
          <div className="max-w-[1200px] mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
              <div className="flex flex-col gap-4">
                <div className="text-sm font-semibold text-cyan-500 uppercase tracking-wider">Product</div>
                {['Analyzer', 'Dashboard', 'API'].map((item) => (
                  <a key={item} href="#" className="text-sm text-white/60 hover:text-cyan-500 transition-colors">
                    {item}
                  </a>
                ))}
              </div>

              <div className="flex flex-col gap-4">
                <div className="text-sm font-semibold text-cyan-500 uppercase tracking-wider">Resources</div>
                {['Documentation', 'Blog', 'GitHub'].map((item) => (
                  <a key={item} href="#" className="text-sm text-white/60 hover:text-cyan-500 transition-colors">
                    {item}
                  </a>
                ))}
              </div>

              <div className="flex flex-col gap-4">
                <div className="text-sm font-semibold text-cyan-500 uppercase tracking-wider">Legal</div>
                <a href="/terms-and-conditions" className="text-sm text-white/60 hover:text-cyan-500 transition-colors">Terms of Service</a>
                <a href="/privacy-policy" className="text-sm text-white/60 hover:text-cyan-500 transition-colors">Privacy Policy</a>
                <a href="/refund-policy" className="text-sm text-white/60 hover:text-cyan-500 transition-colors">Refund Policy</a>
              </div>
            </div>

            <div className="pt-6 border-t border-cyan-500/10 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-white/50">
              <div>© 2026 hex-yt-intel. All rights reserved.</div>
              <div className="flex gap-4">
                {['Twitter', 'GitHub', 'Discord'].map((item) => (
                  <a key={item} href="#" className="hover:text-cyan-500 transition-colors">{item}</a>
                ))}
              </div>
            </div>
          </div>
        </footer>
      </div>

      <style jsx global>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
