import { create } from 'zustand';
import type { AnalysisResult } from '@/lib/types';

export interface AnalysisState {
  // Current analysis
  analysis: AnalysisResult | null;
  isLoading: boolean;
  status: 'idle' | 'downloading' | 'parsing' | 'analyzing' | 'complete' | 'error';
  error: string | null;

  // Rate limit tracking
  lockoutTimeRemaining: number;

  // History (persisted for session)
  analysisHistory: AnalysisResult[];

  // Actions
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setStatus: (status: AnalysisState['status']) => void;
  setError: (error: string | null) => void;
  setLockoutTimeRemaining: (time: number) => void;
  clearAnalysis: () => void;
  addToHistory: (analysis: AnalysisResult) => void;
  clearHistory: () => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  // Initial state
  analysis: null,
  isLoading: false,
  status: 'idle',
  error: null,
  lockoutTimeRemaining: 0,
  analysisHistory: [],

  // Actions
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
      const updated = [analysis, ...state.analysisHistory].slice(0, 20); // Keep last 20
      return { analysisHistory: updated };
    }),

  clearHistory: () => set({ analysisHistory: [] }),
}));
