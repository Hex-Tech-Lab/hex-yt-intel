'use client';

import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export interface HighlightsTransitionOverlayProps {
  active: boolean;
  direction?: 'forward' | 'backward';
}

let sharedAudioContext: AudioContext | null = null;

function getSharedAudioContext(): AudioContext | null {
  try {
    if (sharedAudioContext && sharedAudioContext.state !== 'closed') {
      if (sharedAudioContext.state === 'suspended') void sharedAudioContext.resume().catch((resumeError) => console.debug('[HighlightsTransitionOverlay] AudioContext resume failed', resumeError));
      return sharedAudioContext;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new Ctx();
    return sharedAudioContext;
  } catch (error) {
    console.debug('[HighlightsTransitionOverlay] AudioContext creation failed', error);
    return null;
  }
}

function playSwoosh() {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
    const duration = 0.6;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(200, ctx.currentTime + duration);
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + duration);
  } catch (error) {
    console.debug('[HighlightsTransitionOverlay] playSwoosh failed', error);
  }
}

export function HighlightsTransitionOverlay({ active, direction = 'forward' }: HighlightsTransitionOverlayProps) {
  const prevActive = useRef(false);
  useEffect(() => {
    if (active && !prevActive.current) playSwoosh();
    prevActive.current = active;
  }, [active]);

  const isForward = direction === 'forward';

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none overflow-hidden"
          style={{ backgroundColor: '#090D16' }}
          aria-hidden="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.35, delay: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="w-32 h-32 rounded-full blur-2xl"
            style={{ backgroundColor: '#10B981', opacity: 0.18 }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.9, letterSpacing: '0.2em' }}
            animate={{ opacity: 1, scale: 1, letterSpacing: '0.05em' }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.4, delay: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="absolute font-black text-3xl sm:text-4xl tracking-widest select-none"
            style={{ color: '#10B981', textShadow: '0 0 20px rgba(16,185,129,0.6), 0 0 40px rgba(16,185,129,0.3)' }}
          >
            vIntel
          </motion.div>
          <motion.div
            initial={{ x: isForward ? '-100%' : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: isForward ? '100%' : '-100%' }}
            transition={{ duration: 0.5, delay: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="absolute h-[2px] top-1/2 -translate-y-1/2 w-full"
            style={{ backgroundColor: '#10B981', opacity: 0.7 }}
          />
          <motion.div
            initial={{ x: isForward ? '-100%' : '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: isForward ? '100%' : '-100%', opacity: 0 }}
            transition={{ duration: 0.5, delay: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-y-0 w-full"
            style={{
              background: isForward
                ? 'linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.08) 50%, transparent 100%)'
                : 'linear-gradient(270deg, transparent 0%, rgba(16,185,129,0.08) 50%, transparent 100%)',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
