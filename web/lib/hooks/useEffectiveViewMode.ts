import { useConsoleViewStore, type ConsoleViewMode } from "@/lib/stores/useConsoleViewStore";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

export function useEffectiveViewMode(): { effectiveViewMode: ConsoleViewMode; setViewMode: (mode: ConsoleViewMode) => void } {
  const { viewMode, setViewMode } = useConsoleViewStore();
  const { entitlements, isLoading } = useEntitlements();

  const effectiveViewMode: ConsoleViewMode =
    isLoading || !entitlements?.canAccessKnowledgeGraph ? "simple" : viewMode;

  return { effectiveViewMode, setViewMode };
}
