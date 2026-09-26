'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface HighlightsTransitionOverlayProps {
  active: boolean;
  direction?: 'forward' | 'backward';
  volumeGain?: number;
}

let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  try {
    if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
      if (sharedAudioContext.state === 'suspended') void sharedAudioContext.resume().catch((resumeError) => console.debug('[HighlightsTransitionOverlay] AudioContext resume failed', resumeError));
      return sharedAudioContext;
    }
    const Ctx = typeof window !== 'undefined' ? (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctx) return null;
    sharedAudioContext = new Ctx();
    return sharedAudioContext;
  } catch (error) {
    console.debug('[HighlightsTransitionOverlay] AudioContext creation failed', error);
    return null;
  }
}

function playSwoosh(volumeGain = 1) {
  if (volumeGain <= 0) return;
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
    // Quick air-swoosh (0.32s) synced to directional whip-pan wipe (ADR 030)
    const duration = 0.32;
    const sampleRate = ctx.sampleRate;
    const bufferSize = Math.floor(sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);

    // Pink noise burst (1/f) for authentic airy aerodynamic swoosh
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Resonant bandpass filter sweeping rapidly 1400Hz -> 280Hz
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(280, ctx.currentTime + duration);
    filter.Q.setValueAtTime(2.2, ctx.currentTime);

    // Dynamic gain scaled by YouTube player volume and mute state (0.0 to 1.0)
    const baseGain = 0.2;
    const gainNode = ctx.createGain();
    const effectiveGain = baseGain * Math.max(0, Math.min(1, volumeGain));
    gainNode.gain.setValueAtTime(effectiveGain, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    source.connect(filter).connect(gainNode).connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + duration);
  } catch (error) {
    console.debug('[HighlightsTransitionOverlay] playSwoosh failed', error);
  }
}

export function HighlightsTransitionOverlay({ active, direction = 'forward', volumeGain = 1 }: HighlightsTransitionOverlayProps) {
  const prevActive = useRef(false);
  useEffect(() => {
    if (active && !prevActive.current) playSwoosh(volumeGain);
    prevActive.current = active;
  }, [active, volumeGain]);

  const isForward = direction === 'forward';
  // Arabic broadcast whip-pan: forward slides right-to-left, backward slides left-to-right
  const enterX = isForward ? '100%' : '-100%';
  const exitX = isForward ? '-100%' : '100%';

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0 z-30 pointer-events-none overflow-hidden select-none"
          aria-hidden="true"
          data-testid="highlights-transition-overlay"
        >
          {/* Layer 1: High-velocity motion-blur curtain */}
          <motion.div
            initial={{ x: enterX, skewX: isForward ? -18 : 18 }}
            animate={{ x: '0%', skewX: 0 }}
            exit={{ x: exitX, skewX: isForward ? 18 : -18 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 w-full h-full bg-[#070b12]/90 backdrop-blur-md"
          />

          {/* Layer 2: Broadcast energy wipe blade */}
          <motion.div
            initial={{ x: enterX }}
            animate={{ x: '0%' }}
            exit={{ x: exitX }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-y-0 w-full"
            style={{
              background: isForward
                ? 'linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.06) 40%, rgba(16,185,129,0.35) 90%, rgba(52,211,153,0.85) 100%)'
                : 'linear-gradient(270deg, transparent 0%, rgba(16,185,129,0.06) 40%, rgba(16,185,129,0.35) 90%, rgba(52,211,153,0.85) 100%)',
            }}
          />

          {/* Layer 3: High-speed leading-edge laser streak */}
          <motion.div
            initial={{ x: enterX }}
            animate={{ x: '0%' }}
            exit={{ x: exitX }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute inset-y-0 w-1.5 ${isForward ? 'right-0' : 'left-0'} bg-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.9),0_0_40px_rgba(16,185,129,0.7)]`}
          />

          {/* Layer 4: Center broadcast streak flares */}
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 0.8 }}
            exit={{ scaleX: 1.5, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
