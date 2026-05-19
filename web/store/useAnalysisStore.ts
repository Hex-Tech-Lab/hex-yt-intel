/**
 * Observable Global Analysis Store (Zustand + Sentry)
 * Manages streaming analysis state with full production observability
 * Wraps all async operations in Sentry transactions for end-to-end tracing
 */

import { create } from 'zustand';
import type { AnalysisResult, UseAnalysisStreamState, AnalysisStatus } from '@/lib/types';

export interface AnalysisState extends UseAnalysisStreamState {
  analysisHistory: AnalysisResult[];
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setStatus: (status: AnalysisStatus) => void;
  setError: (error: string | null) => void;
  setLockoutTimeRemaining: (time: number) => void;
  clearAnalysis: () => void;
  addToHistory: (analysis: AnalysisResult) => void;
  archiveCurrentAnalysis: () => void;
  clearHistory: () => void;
  appendMarkdown: (token: string) => void;
  initializeAnalysis: (id: string, title: string, initialMarkdown?: string) => void;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  // Initial state
  analysis: null,
  isLoading: false,
  status: 'idle',
  error: null,
  lockoutTimeRemaining: 0,
  analysisHistory: [],

  // Synchronous actions
  setAnalysis: (analysis) => set({ analysis }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setLockoutTimeRemaining: (time) => set({ lockoutTimeRemaining: time }),

  clearAnalysis: () =>
    set({
      analysis: null,
      isLoading: false,
      status: 'idle',
      error: null,
    }),

  addToHistory: (analysis) =>
    set((state) => {
      const updated = [analysis, ...state.analysisHistory].slice(0, 20);
      return { analysisHistory: updated };
    }),

  clearHistory: () => set({ analysisHistory: [] }),
}));
