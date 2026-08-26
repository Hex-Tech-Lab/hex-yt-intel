/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewModeToggle } from "../ViewModeToggle";
import { useConsoleViewStore } from "@/lib/stores/useConsoleViewStore";
import * as UseEntitlementsModule from "@/lib/hooks/useEntitlements";

vi.mock("@/lib/stores/useConsoleViewStore", () => ({
  useConsoleViewStore: vi.fn(),
}));

vi.mock("@/lib/hooks/useEntitlements", () => ({
  useEntitlements: vi.fn(),
}));

// Mock the PricingModal
vi.mock("@/components/billing/PricingModal", () => ({
  PricingModal: ({ isOpen, onClose }: any) =>
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
    (useConsoleViewStore as any).mockImplementation((selector: any) =>
      selector({
        viewMode: "simple",
        setViewMode: mockSetViewMode,
      }),
    );
  });

  it("renders correctly with Simple mode active", () => {
    vi.spyOn(UseEntitlementsModule, "useEntitlements").mockReturnValue({
      isFounder: false,
      isPro: false,
    } as any);
    render(<ViewModeToggle />);
    expect(screen.getByText("Simple")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
  });

  it("allows switching to Pro when entitled", () => {
    vi.spyOn(UseEntitlementsModule, "useEntitlements").mockReturnValue({
      isFounder: true,
      isPro: false,
    } as any);
    render(<ViewModeToggle />);
    fireEvent.click(screen.getByText("Pro"));
    expect(mockSetViewMode).toHaveBeenCalledWith("pro");
    expect(screen.queryByTestId("pricing-modal")).toBeNull();
  });

  it("shows PricingModal when non-entitled user clicks Pro", () => {
    vi.spyOn(UseEntitlementsModule, "useEntitlements").mockReturnValue({
      isFounder: false,
      isPro: false,
    } as any);
    render(<ViewModeToggle />);
    fireEvent.click(screen.getByText("Pro"));
    expect(mockSetViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId("pricing-modal")).toBeTruthy();
  });
});
