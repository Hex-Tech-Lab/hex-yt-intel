// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { useEffectiveViewMode } from "../useEffectiveViewMode";
import { useConsoleViewStore } from "@/lib/stores/useConsoleViewStore";
import { useEntitlements } from "@/lib/hooks/useEntitlements";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/stores/useConsoleViewStore", () => ({
  useConsoleViewStore: vi.fn(),
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

describe("useEffectiveViewMode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("defaults to 'simple' when entitlements are loading", () => {
    vi.mocked(useConsoleViewStore).mockReturnValue({ viewMode: "pro", setViewMode: vi.fn() });
    vi.mocked(useEntitlements).mockReturnValue({ entitlements: null, isLoading: true });
    
    const { result } = renderHook(() => useEffectiveViewMode());
    expect(result.current.effectiveViewMode).toBe("simple");
  });

  it("persisted 'pro' in localStorage falls back to 'simple' for free tier", () => {
    vi.mocked(useConsoleViewStore).mockReturnValue({ viewMode: "pro", setViewMode: vi.fn() });
    vi.mocked(useEntitlements).mockReturnValue({ 
      entitlements: { canAccessKnowledgeGraph: false }, 
      isLoading: false 
    } as any);
    
    const { result } = renderHook(() => useEffectiveViewMode());
    expect(result.current.effectiveViewMode).toBe("simple");
  });

  it("authenticated Founder unlocks 'pro' view", () => {
    vi.mocked(useConsoleViewStore).mockReturnValue({ viewMode: "pro", setViewMode: vi.fn() });
    vi.mocked(useEntitlements).mockReturnValue({ 
      entitlements: { canAccessKnowledgeGraph: true }, 
      isLoading: false 
    } as any);
    
    const { result } = renderHook(() => useEffectiveViewMode());
    expect(result.current.effectiveViewMode).toBe("pro");
  });
});
