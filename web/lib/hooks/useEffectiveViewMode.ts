import { useConsoleViewStore } from "@/lib/stores/useConsoleViewStore";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

export function useEffectiveViewMode() {
  const { viewMode, setViewMode } = useConsoleViewStore();
  const { entitlements, isLoading } = useEntitlements();

  const effectiveViewMode =
    isLoading || !entitlements?.canAccessKnowledgeGraph ? "simple" : viewMode;

  return { effectiveViewMode, setViewMode };
}
