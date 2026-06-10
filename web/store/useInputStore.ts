import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { z } from 'zod';

export const InputUrlSchema = z.string().url().regex(/youtube\.com|youtu\.be/, 'Must be a valid YouTube URL');

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
        const result = InputUrlSchema.safeParse(url);
        set({ url, isValid: result.success });
      },
      validateUrl: (url: string) => {
        const result = InputUrlSchema.safeParse(url);
        set({ isValid: result.success });
        return result.success;
      },
    }),
    {
      name: 'hex_intel_saved_input',
      storage: createJSONStorage(() => localStorage), // Persist across sessions
    }
  )
);
