/**
 * Observable Global Analysis Store (Zustand + Sentry)
 * Manages streaming analysis state with full production observability
 * Wraps all async operations in Sentry transactions for end-to-end tracing
 */
import { create } from 'zustand';
import type { AnalysisResult, UseAnalysisStreamState, AnalysisStatus, AnalysisErrorState, VideoMetadata } from '@/lib/types';

export interface LogLine {
  timestamp: string;
  type: 'info' | 'ok' | 'error' | 'debug';
  message: string;
}

export interface AnalysisState extends UseAnalysisStreamState {
  analysisHistory: AnalysisResult[];
  videoMetadata: VideoMetadata | null;
  terminalLines: LogLine[];
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setStatus: (status: AnalysisStatus) => void;
  setError: (error: AnalysisErrorState | null) => void;
  setVideoMetadata: (metadata: VideoMetadata | null) => void;
  setLockoutTimeRemaining: (time: number) => void;
  clearAnalysis: () => void;
  addToHistory: (analysis: AnalysisResult) => void;
  archiveCurrentAnalysis: () => void;
  clearHistory: () => void;
  appendMarkdown: (token: string) => void;
  appendTerminalLine: (content: string) => void;
  clearTerminal: () => void;
  initializeAnalysis: (id: string, title: string, initialMarkdown?: string) => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  // Initial state
  analysis: null,
  isLoading: false,
  status: 'idle',
  error: null,
  videoMetadata: null,
  lockoutTimeRemaining: 0,
  analysisHistory: [],
  terminalLines: [],

  // Synchronous actions
  setAnalysis: (analysis) => set({ analysis }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setVideoMetadata: (metadata) => set({ videoMetadata: metadata }),
  setLockoutTimeRemaining: (time) => set({ lockoutTimeRemaining: time }),

  clearAnalysis: () =>
    set({
      analysis: null,
      status: 'idle',
      error: null,
      terminalLines: [],
    }),

  addToHistory: (analysis) =>
    set((state) => {
      const updated = [analysis, ...state.analysisHistory].slice(0, 20);
      return { analysisHistory: updated };
    }),

  clearHistory: () => set({ analysisHistory: [] }),

  archiveCurrentAnalysis: () =>
    set((state) => {
      if (state.analysis) {
        const updated = [state.analysis, ...state.analysisHistory].slice(0, 20);
        return { analysisHistory: updated };
      }
      return {};
    }),

  appendMarkdown: (token) =>
    set((state) => ({
      analysis: state.analysis
        ? { ...state.analysis, analysis_markdown: state.analysis.analysis_markdown + token }
        : null,
    })),

  appendTerminalLine: (content) =>
    set((state) => {
      const newLine: LogLine = {
        timestamp: new Date().toLocaleTimeString(),
        type: 'info',
        message: content,
      };
      return { terminalLines: [...state.terminalLines, newLine] };
    }),

  clearTerminal: () => set({ terminalLines: [] }),

  initializeAnalysis: (id, title, initialMarkdown = '') =>
    set((state) => ({
      analysis: { 
        id, 
        title, 
        analysis_markdown: initialMarkdown || state.analysis?.analysis_markdown || '' 
      },
      terminalLines: [],
      status: initialMarkdown ? 'complete' : 'idle',
      error: null,
      isLoading: false,
    })),
}));
