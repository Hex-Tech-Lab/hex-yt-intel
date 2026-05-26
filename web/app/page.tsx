'use client';

import { useEffect, useRef, useState } from 'react';
import HomeContent from '@/components/organisms/HomeContent';
import { useAuth } from '@/hooks/useAuth';

function LandingPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !canvasRef.current) return;

    // Load Three.js dynamically
    let script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    script.async = true;
    script.onload = () => {
      initWebGL();
    };
    document.body.appendChild(script);

    return () => {
      try {
        document.body.removeChild(script);
      } catch (e) {
        // Script already removed
      }
    };
  }, [mounted]);

  const initWebGL = () => {
    if (!canvasRef.current) return;

    const THREE = (window as any).THREE;
    if (!THREE) return;

    let scene: any, camera: any, renderer: any, particles: any;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current, alpha: true });
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

    particles = new THREE.Points(geometry, material);
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

  if (!mounted) return null;

  return (
    <>
      {/* WebGL Canvas */}
      <canvas
        ref={canvasRef}
        className="fixed top-0 left-0 w-full h-full z-0 opacity-50 pointer-events-none"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
          opacity: 0.5,
          pointerEvents: 'none',
        }}
      />

      {/* Content Wrapper */}
      <div className="relative z-10" style={{ position: 'relative', zIndex: 10 }}>
        {/* Header */}
        <header
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            padding: '0 24px',
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(6, 182, 212, 0.1)',
            transition: 'all 0.3s ease',
          }}
        >
          <div
            style={{
              maxWidth: '1200px',
              margin: '0 auto',
              height: '64px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '32px',
            }}
          >
            {/* Logo */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '18px',
                fontWeight: 600,
                letterSpacing: '-0.5px',
                flexShrink: 0,
                color: '#06B6D4',
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  background: 'linear-gradient(135deg, #06B6D4, #00BFFF)',
                  borderRadius: '6px',
                }}
              />
              <span>hex-yt-intel</span>
            </div>

            {/* Nav */}
            <nav
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                flex: 1,
              }}
            >
              <a
                href="#"
                onClick={() => (window.location.href = '/dashboard')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#FFFFFF';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Analyze
              </a>
              <a
                href="#"
                onClick={() => (window.location.href = '/search')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#FFFFFF';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Learn
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#FFFFFF';
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Docs
              </a>
            </nav>

            {/* CTA */}
            <div style={{ flexShrink: 0 }}>
              <button
                onClick={() => (window.location.href = '/dashboard')}
                style={{
                  padding: '12px 24px',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#000000',
                  background: 'linear-gradient(135deg, #06B6D4, #00BFFF)',
                  border: 'none',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  boxShadow: '0 4px 8px rgba(6, 182, 212, 0.3)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 16px rgba(6, 182, 212, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 8px rgba(6, 182, 212, 0.3)';
                }}
              >
                Get Started
              </button>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            paddingTop: '120px',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              maxWidth: '900px',
              animation: 'fadeInUp 1.2s ease-out',
            }}
          >
            <div
              style={{
                fontSize: '14px',
                fontWeight: 500,
                color: '#06B6D4',
                letterSpacing: '1px',
                textTransform: 'uppercase',
                marginBottom: '24px',
                opacity: 0.8,
              }}
            >
              YouTube Intelligence Platform
            </div>

            <h1
              style={{
                fontSize: 'clamp(36px, 8vw, 72px)',
                fontWeight: 600,
                lineHeight: 1.1,
                marginBottom: '32px',
                letterSpacing: '-1px',
              }}
            >
              Knowledge is more than
              <br />
              <span
                style={{
                  background: 'linear-gradient(135deg, #06B6D4, #00BFFF)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                data points.
              </span>
              <br />
              Let there be light.
            </h1>

            <p
              style={{
                fontSize: '18px',
                fontWeight: 400,
                color: 'rgba(255, 255, 255, 0.7)',
                marginBottom: '48px',
                maxWidth: '600px',
                marginLeft: 'auto',
                marginRight: 'auto',
                lineHeight: 1.7,
              }}
            >
              Transform YouTube content into actionable insights. Semantic analysis, real-time
              transcription, and intelligence synthesis — all in one platform.
            </p>

            <div
              style={{
                display: 'flex',
                gap: '16px',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={() => (window.location.href = '/dashboard')}
                style={{
                  padding: '12px 24px',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#000000',
                  background: 'linear-gradient(135deg, #06B6D4, #00BFFF)',
                  border: 'none',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  boxShadow: '0 4px 8px rgba(6, 182, 212, 0.3)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 16px rgba(6, 182, 212, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 8px rgba(6, 182, 212, 0.3)';
                }}
              >
                Start Analyzing Free
              </button>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/wiki"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '12px 24px',
                  borderRadius: '9999px',
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#06B6D4',
                  background: 'rgba(6, 182, 212, 0.1)',
                  border: '1px solid rgba(6, 182, 212, 0.3)',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(6, 182, 212, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(6, 182, 212, 0.1)';
                  e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.3)';
                }}
              >
                View Documentation
              </a>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer
          style={{
            position: 'relative',
            zIndex: 10,
            borderTop: '1px solid rgba(6, 182, 212, 0.1)',
            padding: '48px 24px',
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div
            style={{
              maxWidth: '1200px',
              margin: '0 auto',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: '48px',
              marginBottom: '48px',
            }}
          >
            {/* Product */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#06B6D4',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Product
              </div>
              <a
                href="/dashboard"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                Analyzer
              </a>
              <a
                href="/dashboard"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                Dashboard
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                API
              </a>
            </div>

            {/* Resources */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#06B6D4',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Resources
              </div>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/wiki"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                Documentation
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                Blog
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                GitHub
              </a>
            </div>

            {/* Company */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#06B6D4',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Company
              </div>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                About
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/main/PRIVACY.md"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                Privacy
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/main/TERMS.md"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                Terms
              </a>
            </div>

            {/* Social */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#06B6D4',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Social
              </div>
              <a
                href="https://x.com"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                Twitter
              </a>
              <a
                href="https://github.com/Hex-Tech-Lab/hex-yt-intel"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                GitHub
              </a>
              <a
                href="https://discord.gg"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: '14px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  transition: 'color 0.2s ease',
                  textDecoration: 'none',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#06B6D4')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)')}
              >
                Discord
              </a>
            </div>
          </div>

          <div
            style={{
              borderTop: '1px solid rgba(6, 182, 212, 0.1)',
              paddingTop: '24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)' }}>
              © 2026 hex-yt-intel. All rights reserved.
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.5)' }}>
              Knowledge is more than data points. Let there be light.
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
      `}</style>
    </>
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
