/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewModeToggle } from "../ViewModeToggle";
import { useEffectiveViewMode } from "@/lib/hooks/useEffectiveViewMode";
import * as UseEntitlementsModule from "@/lib/hooks/useEntitlements";

vi.mock("@/lib/hooks/useEffectiveViewMode", () => ({
  useEffectiveViewMode: vi.fn(),
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

// Mock the PricingModal
vi.mock("@/components/billing/PricingModal", () => ({
  PricingModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <div data-testid="pricing-modal">
        <button onClick={onClose}>Close</button>
      </div>
    ) : null,
}));

describe("ViewModeToggle", () => {
  let mockSetViewMode: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSetViewMode = vi.fn();
    vi.mocked(useEffectiveViewMode).mockReturnValue({ effectiveViewMode: "simple", setViewMode: mockSetViewMode });
  });

  it("renders correctly with Simple mode active", () => {
    vi.spyOn(UseEntitlementsModule, "useEntitlements").mockReturnValue({
      isFounder: false,
      isPro: false,
      tier: "free",
      status: "canceled",
      entitlements: {
        canAnalyzeVideo: true,
        canAccessKnowledgeGraph: false,
        canUseExtendedChat: false,
      },
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    });
    render(<ViewModeToggle />);
    expect(screen.getByText("Simple")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
  });

  it("allows switching to Pro when entitled", () => {
    vi.spyOn(UseEntitlementsModule, "useEntitlements").mockReturnValue({
      isFounder: true,
      isPro: false,
      tier: "founder",
      status: "active",
      entitlements: {
        canAnalyzeVideo: true,
        canAccessKnowledgeGraph: true,
        canUseExtendedChat: true,
      },
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    });
    render(<ViewModeToggle />);
    fireEvent.click(screen.getByText("Pro"));
    expect(mockSetViewMode).toHaveBeenCalledWith("pro");
    expect(screen.queryByTestId("pricing-modal")).toBeNull();
  });

  it("shows PricingModal when non-entitled user clicks Pro", () => {
    vi.spyOn(UseEntitlementsModule, "useEntitlements").mockReturnValue({
      isFounder: false,
      isPro: false,
      tier: "free",
      status: "canceled",
      entitlements: {
        canAnalyzeVideo: true,
        canAccessKnowledgeGraph: false,
        canUseExtendedChat: false,
      },
      isLoading: false,
      error: null,
      mutate: vi.fn(),
    });
    render(<ViewModeToggle />);
    fireEvent.click(screen.getByText("Pro"));
    expect(mockSetViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId("pricing-modal")).toBeTruthy();
  });
});
