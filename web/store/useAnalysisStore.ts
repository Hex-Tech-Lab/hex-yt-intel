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
  // Consecutive identical lines are coalesced (see logInfo/logOk/logError)
  // instead of appended -- parallel bundle streams (5 for a full analysis)
  // each emit the same generic status text ("Preparing analysis...",
  // "Contacting OpenRouter...") independently, which used to 5x every one
  // of them in the panel for no informational gain.
  count?: number;
}

export interface AnalysisState extends UseAnalysisStreamState {
  analysisHistory: AnalysisResult[];
  videoMetadata: VideoMetadata | null;
  terminalLines: LogLine[];
  userRole: string | null;
  setAnalysis: (analysis: AnalysisResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setStatus: (status: AnalysisStatus) => void;
  setError: (error: AnalysisErrorState | null) => void;
  setVideoMetadata: (metadata: VideoMetadata | null) => void;
  setLockoutTimeRemaining: (time: number) => void;
  setUserRole: (role: string | null) => void;
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
  initializeAnalysis: (id: string, title: string, initialMarkdown?: string, executiveDigest?: Record<string, unknown> | null) => void;
}

function sanitizeLogMessage(message: string, role: string | null): string {
  if (role === 'admin') return message;

  let clean = message;

  // 1. Remove references to OpenRouter
  clean = clean.replace(/OpenRouter/gi, 'secure server');

  // 2. Remove references to Vercel or Worker or Cloudflare edge worker
  clean = clean.replace(/Cloudflare edge worker/gi, 'edge server');
  clean = clean.replace(/Cloudflare/gi, 'edge server');
  clean = clean.replace(/Worker/gi, 'edge server');
  clean = clean.replace(/Vercel/gi, 'server');

  // 3. Remove specific model names/cascade nodes
  clean = clean.replace(/Running model cascade node:\s*([^\n]+)/gi, 'Analyzing video dimensions...');

  // 4. Remove fallback routing details
  clean = clean.replace(/Attempting automated fallback routing\.\.\./gi, 'Retrying analysis...');
  clean = clean.replace(/Adjusting backup cascade path\.\.\./gi, 'retrying...');
  clean = clean.replace(/Cascade path fault detected\. Switching node\.\.\./gi, 'Optimizing request routing...');
  clean = clean.replace(/Connection response delayed\. Adjusting backup cascade path\.\.\./gi, 'Optimizing request routing...');
  clean = clean.replace(/Provider capacity limit reached\. Re-routing to alternate provider\.\.\./gi, 'Optimizing request routing...');
  clean = clean.replace(/Model tier capacity overdrawn\. Transitioning route\.\.\./gi, 'Optimizing request routing...');
  clean = clean.replace(/Model response validation failed\. Re-routing analysis\.\.\./gi, 'Optimizing request routing...');

  // 5. Clean up edge pipeline/worker start details
  clean = clean.replace(/Edge pipeline start for video ID:\s*([a-zA-Z0-9_-]+)/gi, 'Initializing analysis pipeline...');
  clean = clean.replace(/Worker handshaked successfully\./gi, 'Secure connection established.');

  return clean;
}

/**
 * Appends a log line, coalescing into the previous one when the sanitized
 * text and type are identical to what's already at the tail of the panel.
 * A full analysis runs N parallel bundle streams (currently 5) that each
 * independently emit the same generic status text ("Preparing analysis...",
 * "Contacting OpenRouter...") -- without this, every one of those lines
 * appeared N times back-to-back for zero additional information, and on a
 * long video with fallback/retry cycling the panel could reach thousands of
 * lines. A repeat bumps `count` on the existing line instead of adding a
 * new one.
 */
function appendLogLine(
  state: { terminalLines: LogLine[]; userRole: string | null },
  type: LogLine['type'],
  message: string
): { terminalLines: LogLine[] } {
  const sanitized = sanitizeLogMessage(message, state.userRole);
  const lines = state.terminalLines;
  const last = lines[lines.length - 1];
  if (last && last.type === type && last.message === sanitized) {
    const updated = [...lines];
    updated[updated.length - 1] = { ...last, count: (last.count ?? 1) + 1, timestamp: new Date().toLocaleTimeString() };
    return { terminalLines: updated };
  }
  return {
    terminalLines: [...lines, { timestamp: new Date().toLocaleTimeString(), type, message: sanitized }],
  };
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
  userRole: null,

  // Synchronous actions
  setAnalysis: (analysis) => set({ analysis }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setVideoMetadata: (metadata) => set({ videoMetadata: metadata }),
  setLockoutTimeRemaining: (time) => set({ lockoutTimeRemaining: time }),
  setUserRole: (userRole) => set({ userRole }),

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

  logInfo: (message) => set((state) => appendLogLine(state, 'info', message)),
  logOk: (message) => set((state) => appendLogLine(state, 'ok', message)),
  logError: (message) => set((state) => appendLogLine(state, 'error', message)),

  initializeAnalysis: (id, title, initialMarkdown = '', executiveDigest = null) =>
    set(() => ({
      analysis: {
        id,
        title,
        analysis_markdown: initialMarkdown,
        executiveDigest,
      },
      terminalLines: [],
      status: initialMarkdown || executiveDigest ? 'complete' : 'idle',
      error: null,
      isLoading: false,
    })),
}));
