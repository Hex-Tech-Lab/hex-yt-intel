'use client';

import { AnimatePresence, motion } from 'framer-motion';

export interface HighlightsTransitionOverlayProps {
  active: boolean;
}

export function HighlightsTransitionOverlay({ active }: HighlightsTransitionOverlayProps) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
          style={{ backgroundColor: '#090D16' }}
          aria-hidden="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ duration: 0.35, delay: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="w-24 h-24 rounded-full blur-2xl"
            style={{ backgroundColor: '#10B981', opacity: 0.15 }}
          />
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: '100%' }}
            transition={{ duration: 0.5, delay: 0.35, ease: [0.4, 0, 0.2, 1] }}
            className="absolute h-[2px] top-1/2 -translate-y-1/2"
            style={{ backgroundColor: '#10B981', opacity: 0.6 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
