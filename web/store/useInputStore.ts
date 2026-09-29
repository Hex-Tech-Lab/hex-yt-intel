import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';
import { safeStateLocalStorage } from '@/lib/utils/safe-storage';
import { extractVideoId } from '@/lib/youtube';

export const InputUrlSchema = z.string().url().regex(/youtube\.com|youtu\.be/, 'Must be a valid YouTube URL');

// Wave 10.8 follow-up (R4): the `?v=` route parameter must win at the FIRST
// render. The persisted URL hydrates in the same commit as
// useAutoRestoreAnalysis, so a mount-time correction in DashboardContainer
// races the restore (restore starts for the persisted video, then gets
// cancelled). Applying `?v=` inside the persist hydration makes the first
// hydrated `url` already the route's video.
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function resolveHydratedUrl(persistedUrl: string, search: string): string {
  const routeVideoId = new URLSearchParams(search).get('v');
  if (!routeVideoId || !YOUTUBE_VIDEO_ID.test(routeVideoId)) return persistedUrl;
  if (extractVideoId(persistedUrl) === routeVideoId) return persistedUrl;
  return `https://www.youtube.com/watch?v=${routeVideoId}`;
}

interface InputState {
  url: string;
  setUrl: (url: string) => void;
  isValid: boolean;
  validateUrl: (url: string) => boolean;
}

export const useInputStore = create<InputState>()(
  persist(
    (set) => ({
      url: '',
      isValid: false,
      setUrl: (url: string) => {
        set({ url });
      },
      validateUrl: (url: string) => {
        const result = InputUrlSchema.safeParse(url);
        set({ isValid: result.success });
        return result.success;
      },
    }),
    {
      name: 'hex_intel_saved_input',
      storage: createJSONStorage(() => safeStateLocalStorage), // Persist across sessions
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<InputState> | undefined) };
        if (typeof window === 'undefined') return merged;
        if (typeof merged.url === 'string') {
          merged.url = resolveHydratedUrl(merged.url, window.location.search);
        }
        return merged;
      },
    }
  )
);
