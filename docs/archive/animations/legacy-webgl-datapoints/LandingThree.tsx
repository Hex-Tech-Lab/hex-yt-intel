'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function LandingThree() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, particles: THREE.Points;

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
      color: 0x06B6D4,
      size: 0.8,
      sizeAttenuation: true,
      transparent: true
    });

    function initWebGL() {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
      renderer = new THREE.WebGLRenderer({ canvas: canvas!, alpha: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setClearColor(0x000000, 0);
      camera.position.z = 50;

      particles = new THREE.Points(geometry, material);
      scene.add(particles);

      animate();
    }

    function animate() {
      if (!renderer || !scene || !camera) return;
      requestAnimationFrame(animate);
      if (particles) {
        particles.rotation.x += 0.0001;
        particles.rotation.y += 0.0002;
      }
      renderer.render(scene, camera);
    }

    const handleResize = () => {
      if (renderer && camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      }
    };

    initWebGL();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (renderer) renderer.dispose();
      if (geometry) geometry.dispose();
      if (material) material.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="webgl-canvas"
      className="fixed top-0 left-0 w-full h-full z-0 opacity-50 pointer-events-none"
    />
  );
}
