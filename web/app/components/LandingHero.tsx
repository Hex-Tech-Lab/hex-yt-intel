'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export function LandingHero() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();

  useEffect(() => {
    // Only load Three.js on client side
    if (!canvasRef.current) return;

    let script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.async = true;
    script.onload = () => {
      initWebGL();
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const initWebGL = () => {
    if (!canvasRef.current) return;

    const THREE = (window as any).THREE;
    if (!THREE) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    camera.position.z = 50;

    // Create particle field
    const geometry = new THREE.BufferGeometry();
    const particleCount = 1600;
    const positions = new Float32Array(particleCount * 3);
    const offsets = new Float32Array(particleCount);

    let index = 0;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        positions[index * 3] = (i - 20) * 2.5;
        positions[index * 3 + 1] = (j - 20) * 2.5;
        positions[index * 3 + 2] = Math.random() * 20;
        offsets[index] = Math.random() * Math.PI * 2;
        index++;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));

    const material = new THREE.PointsMaterial({
      color: 0x06b6d4,
      size: 0.8,
      sizeAttenuation: true,
      transparent: true,
    });

    const particles = new THREE.Points(geometry, material);
    scene.add(particles);

    const animate = () => {
      requestAnimationFrame(animate);
      particles.rotation.x += 0.0001;
      particles.rotation.y += 0.0002;
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  };

  return (
    <>
      {/* WebGL Canvas */}
      <canvas
        ref={canvasRef}
        className="fixed top-0 left-0 w-full h-full z-0 opacity-50 pointer-events-none"
      />

      {/* Content Wrapper */}
      <div className="relative z-10">
        {/* Header */}
        <header className="fixed top-0 left-0 right-0 z-50 px-6 bg-black/70 backdrop-blur-md border-b border-cyan-500/10 transition-all duration-300">
          <div className="max-w-7xl mx-auto h-16 flex items-center justify-between gap-8">
            {/* Logo */}
            <div className="flex items-center gap-3 font-semibold text-cyan-500 flex-shrink-0">
              <div className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-sm" />
              <span className="text-sm">hex-yt-intel</span>
            </div>

            {/* Nav */}
            <nav className="flex items-center gap-1 flex-1">
              <Link
                href="/dashboard"
                className="px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
              >
                Analyze
              </Link>
              <Link
                href="/search"
                className="px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
              >
                Learn
              </Link>
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
                onClick={() => router.push('/dashboard')}
                className="px-6 py-3 rounded-full text-sm font-semibold text-black bg-gradient-to-r from-cyan-500 to-blue-500 hover:shadow-lg hover:shadow-cyan-500/30 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
              >
                Get Started
              </button>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section className="min-h-screen flex items-center justify-center pt-20 px-6">
          <div className="text-center max-w-4xl mx-auto animate-fadeInUp">
            <div className="text-sm font-semibold text-cyan-400 letter-spacing-wider uppercase tracking-widest mb-6 opacity-80">
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
                onClick={() => router.push('/dashboard')}
                className="px-8 py-3 rounded-full text-base font-semibold text-black bg-gradient-to-r from-cyan-500 to-blue-500 hover:shadow-lg hover:shadow-cyan-500/40 hover:-translate-y-1 transition-all duration-300 cursor-pointer"
              >
                Start Analyzing Free
              </button>
              <Link
                href="/docs"
                className="px-8 py-3 rounded-full text-base font-semibold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-all duration-300"
              >
                View Documentation
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="relative border-t border-cyan-500/10 py-12 px-6 bg-black/50 backdrop-blur-md">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
              <div className="flex flex-col gap-4">
                <div className="text-xs font-semibold text-cyan-400 uppercase letter-spacing-wider">
                  Product
                </div>
                <Link href="/dashboard" className="text-sm text-white/60 hover:text-cyan-400 transition-colors">
                  Analyzer
                </Link>
                <Link href="/dashboard" className="text-sm text-white/60 hover:text-cyan-400 transition-colors">
                  Dashboard
                </Link>
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

      <style jsx>{`
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

        .animate-fadeInUp {
          animation: fadeInUp 1.2s ease-out;
        }

        .letter-spacing-wider {
          letter-spacing: 0.1em;
        }
      `}</style>
    </>
  );
}
