'use client';

import { useEffect, useRef } from 'react';

interface AmbientCanvasProps {
  className?: string;
  reducedMotion?: boolean;
}

/**
 * AmbientCanvas: Animated background using 2D Canvas
 *
 * Renders a dynamic dot matrix effect with subtle animation.
 * Supports reduced motion preference and clean cleanup on unmount.
 */
export const AmbientCanvas = ({ className = '', reducedMotion = false }: AmbientCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const particlesRef = useRef<Array<{ x: number; y: number; vx: number; vy: number }>>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const updateCanvasSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    updateCanvasSize();

    // Check for reduced motion preference
    const prefersReducedMotion =
      reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Initialize particles (dots)
    const initParticles = () => {
      particlesRef.current = [];
      const particleCount = Math.floor((canvas.width * canvas.height) / 15000);

      for (let i = 0; i < particleCount; i++) {
        particlesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
        });
      }
    };
    initParticles();

    // Animation function
    const animate = () => {
      // Clear canvas with semi-transparent black for trailing effect
      ctx.fillStyle = 'rgba(15, 23, 42, 0.1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw and update particles.
      // Note: per-particle canvas shadowBlur was removed — it forced a full blur
      // composite on every arc every frame and was the dominant jank source when
      // BentoGrid rendered concurrently. A slightly higher fill alpha preserves
      // perceived brightness without the compositing cost.
      ctx.fillStyle = 'rgba(59, 130, 246, 0.75)';

      particlesRef.current.forEach((particle) => {
        // Update position
        particle.x += particle.vx;
        particle.y += particle.vy;

        // Bounce off edges
        if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1;
        if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1;

        // Keep in bounds
        particle.x = Math.max(0, Math.min(canvas.width, particle.x));
        particle.y = Math.max(0, Math.min(canvas.height, particle.y));

        // Draw particle
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw connections between nearby particles
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.lineWidth = 0.5;
      const connectionDistance = 120;
      // Compare squared distances to avoid ~n² Math.sqrt calls per frame.
      // Output is mathematically identical to the prior sqrt comparison.
      const connectionDistanceSq = connectionDistance * connectionDistance;
      const particles = particlesRef.current;

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const p1 = particles[i];
          const p2 = particles[j];
          if (p1 && p2) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const distanceSq = dx * dx + dy * dy;

            if (distanceSq < connectionDistanceSq) {
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            }
          }
        }
      }

      if (!prefersReducedMotion) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    // Start animation
    if (!prefersReducedMotion) {
      animationRef.current = requestAnimationFrame(animate);
    } else {
      // Static render for reduced motion
      ctx.fillStyle = 'rgba(15, 23, 42, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';

      particlesRef.current.forEach((particle) => {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Handle window resize
    const handleResize = () => {
      updateCanvasSize();
      initParticles();
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      window.removeEventListener('resize', handleResize);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        background: 'linear-gradient(to bottom, rgb(15, 23, 42), rgb(30, 41, 59))',
      }}
    />
  );
};

export default AmbientCanvas;
