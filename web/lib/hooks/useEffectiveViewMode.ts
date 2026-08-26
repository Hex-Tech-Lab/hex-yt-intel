import { useConsoleViewStore, type ConsoleViewMode } from "@/lib/stores/useConsoleViewStore";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

export function useEffectiveViewMode(): { 
  effectiveViewMode: ConsoleViewMode; 
  setViewMode: (mode: ConsoleViewMode) => void;
  canAccessPro: boolean;
  isLoading: boolean;
} {
  const { viewMode, setViewMode } = useConsoleViewStore();
  const { entitlements, isLoading } = useEntitlements();

  const canAccessPro = !isLoading && Boolean(entitlements?.canAccessKnowledgeGraph);

  const effectiveViewMode: ConsoleViewMode =
    !canAccessPro ? "simple" : viewMode;

  return { effectiveViewMode, setViewMode, canAccessPro, isLoading };
}
