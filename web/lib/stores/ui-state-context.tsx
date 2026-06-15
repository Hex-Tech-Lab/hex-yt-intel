"use client";

import { createContext, useContext, useState, useMemo } from 'react';

interface UIState {
  isAtlasVisible: boolean;
  isSynthesisLogVisible: boolean;
  isVideoPlayerVisible: boolean;
}

interface UIStateContextType {
  state: UIState;
  toggleAtlas: () => void;
  toggleSynthesisLog: () => void;
  toggleVideoPlayer: () => void;
}

const UIStateContext = createContext<UIStateContextType | undefined>(undefined);

export function UIStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UIState>({
    isAtlasVisible: true,
    isSynthesisLogVisible: true,
    isVideoPlayerVisible: true,
  });

  const toggleAtlas = () => setState(prev => ({ ...prev, isAtlasVisible: !prev.isAtlasVisible }));
  const toggleSynthesisLog = () => setState(prev => ({ ...prev, isSynthesisLogVisible: !prev.isSynthesisLogVisible }));
  const toggleVideoPlayer = () => setState(prev => ({ ...prev, isVideoPlayerVisible: !prev.isVideoPlayerVisible }));

  const value = useMemo(() => ({ state, toggleAtlas, toggleSynthesisLog, toggleVideoPlayer }), [state]);

  return (
    <UIStateContext.Provider value={value}>
      {children}
    </UIStateContext.Provider>
  );
}

export const useUIState = () => {
  const context = useContext(UIStateContext);
  if (!context) throw new Error('useUIState must be used within a UIStateProvider');
  return context;
};
