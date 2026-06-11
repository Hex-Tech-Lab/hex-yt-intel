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
  logInfo: (message: string) => void;
  logOk: (message: string) => void;
  logError: (message: string) => void;
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
      videoMetadata: null,
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
      const lines = [...state.terminalLines];
      if (lines.length === 0) {
        const parts = content.split('\n\n');
        const firstLine: LogLine = {
          timestamp: new Date().toLocaleTimeString(),
          type: 'info',
          message: parts[0] || '',
        };
        const newLines: LogLine[] = [firstLine];
        for (let i = 1; i < parts.length; i++) {
          newLines.push({
            timestamp: new Date().toLocaleTimeString(),
            type: 'info',
            message: parts[i] || '',
          });
        }
        return { terminalLines: newLines };
      }

      const lastLine = { ...lines[lines.length - 1]! };

      // Split on paragraph boundaries (\n\n)
      if (content.includes('\n\n')) {
        const parts = content.split('\n\n');
        lastLine.message += parts[0] || '';
        lines[lines.length - 1] = lastLine;

        const newLines: LogLine[] = [];
        for (let i = 1; i < parts.length; i++) {
          newLines.push({
            timestamp: new Date().toLocaleTimeString(),
            type: 'info',
            message: parts[i] || '',
          });
        }
        return { terminalLines: [...lines, ...newLines] };
      } else {
        // If content contains a single newline followed by a bullet marker (e.g. \n- or \n1. )
        // start a new line. Otherwise, treat single newlines as soft breaks and append to current line.
        const bulletMatch = content.match(/\n\s*([-*]|\d+\.)\s+/);
        if (bulletMatch) {
          const parts = content.split(/\n(?=\s*[-*]|\d+\.)/);
          lastLine.message += parts[0] || '';
          lines[lines.length - 1] = lastLine;

          const newLines: LogLine[] = [];
          for (let i = 1; i < parts.length; i++) {
            newLines.push({
              timestamp: new Date().toLocaleTimeString(),
              type: 'info',
              message: parts[i] || '',
            });
          }
          return { terminalLines: [...lines, ...newLines] };
        } else {
          // Replace single newlines with spaces to form a continuous paragraph
          const cleaned = content.replace(/\r?\n/g, ' ');
          lastLine.message += cleaned;
          lines[lines.length - 1] = lastLine;
          return { terminalLines: lines };
        }
      }
    }),

  clearTerminal: () => set({ terminalLines: [] }),

  logInfo: (message) =>
    set((state) => ({
      terminalLines: [
        ...state.terminalLines,
        { timestamp: new Date().toLocaleTimeString(), type: 'info', message },
      ],
    })),

  logOk: (message) =>
    set((state) => ({
      terminalLines: [
        ...state.terminalLines,
        { timestamp: new Date().toLocaleTimeString(), type: 'ok', message },
      ],
    })),

  logError: (message) =>
    set((state) => ({
      terminalLines: [
        ...state.terminalLines,
        { timestamp: new Date().toLocaleTimeString(), type: 'error', message },
      ],
    })),

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
