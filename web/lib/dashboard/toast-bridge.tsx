'use client';

import { useEffect } from 'react';
import { useToast, type ShowToastFn } from '@astryxdesign/core';

/**
 * Imperative toast bridge: lets non-component code (event handlers, plain
 * utility functions in export.ts, etc.) fire an Astryx Toast without needing
 * a React render context. `useToast()` itself must be called from inside a
 * component, so `<ToastBridge>` (mounted once inside `<ToastViewport>` at
 * the app root, see app/providers.tsx) calls it and stashes the resulting
 * function on this module so `showToast(message, type)` keeps its original
 * call signature. Must render as a descendant of `<ToastViewport>` so
 * `useToast()` picks up the real context instead of the library's
 * self-mounting (console-warning) fallback.
 */
let activeToast: ShowToastFn | null = null;

/**
 * Fires a toast notification. Preserves the original hand-rolled
 * `showToast(message, type)` signature so none of the existing call sites
 * need to change. No-ops (with a console warning) if `<ToastBridge>` hasn't
 * mounted yet -- e.g. calls that fire before hydration completes.
 */
export function showToast(message: string, type: 'success' | 'error' = 'success') {
  if (!activeToast) {
    console.warn('[toast-bridge] showToast called before ToastBridge mounted:', message);
    return;
  }
  activeToast({ body: message, type: type === 'error' ? 'error' : 'info' });
}

/** Registers the imperative bridge. Render once, inside `<ToastViewport>`, near the app root. */
export function ToastBridge() {
  const toast = useToast();

  useEffect(() => {
    activeToast = toast;
    return () => {
      activeToast = null;
    };
  }, [toast]);

  return null;
}
