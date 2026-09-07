// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEffectiveViewMode } from "../useEffectiveViewMode";
import { useConsoleViewStore, type ConsoleViewMode } from "@/lib/stores/useConsoleViewStore";
import { useEntitlements } from "@/lib/hooks/useEntitlements";

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

  it("round-trip: entitled user calling setViewMode('pro') yields effectiveViewMode 'pro'", () => {
    let storeViewMode: ConsoleViewMode = "simple";
    const setViewMode = (mode: ConsoleViewMode) => {
      storeViewMode = mode;
    };
    vi.mocked(useConsoleViewStore).mockImplementation(() => ({ viewMode: storeViewMode, setViewMode }));
    vi.mocked(useEntitlements).mockReturnValue({
      entitlements: { canAccessKnowledgeGraph: true },
      isLoading: false
    } as any);

    const { result, rerender } = renderHook(() => useEffectiveViewMode());
    expect(result.current.effectiveViewMode).toBe("simple");

    act(() => result.current.setViewMode("pro"));
    rerender();

    expect(result.current.effectiveViewMode).toBe("pro");
  });

  it("round-trip: entitled user with isLoading stuck true stays clamped to 'simple' until it resolves", () => {
    vi.mocked(useConsoleViewStore).mockReturnValue({ viewMode: "pro", setViewMode: vi.fn() });
    vi.mocked(useEntitlements).mockReturnValue({
      entitlements: { canAccessKnowledgeGraph: true },
      isLoading: true
    } as any);

    const { result } = renderHook(() => useEffectiveViewMode());
    expect(result.current.effectiveViewMode).toBe("simple");
    expect(result.current.canAccessPro).toBe(false);
  });
});
