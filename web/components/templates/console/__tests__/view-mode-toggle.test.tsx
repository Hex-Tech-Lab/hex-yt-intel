/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViewModeToggle } from "../ViewModeToggle";
import { useEffectiveViewMode } from "@/lib/hooks/useEffectiveViewMode";

vi.mock("@/lib/hooks/useEffectiveViewMode", () => ({
  useEffectiveViewMode: vi.fn(),
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
  });

  it("renders correctly with Simple mode active", () => {
    vi.mocked(useEffectiveViewMode).mockReturnValue({ 
      effectiveViewMode: "simple", 
      setViewMode: mockSetViewMode,
      canAccessPro: false,
      isLoading: false
    });
    render(<ViewModeToggle />);
    expect(screen.getByText("Simple")).toBeTruthy();
    expect(screen.getByText("Pro")).toBeTruthy();
  });

  it("allows switching to Pro when entitled", () => {
    vi.mocked(useEffectiveViewMode).mockReturnValue({ 
      effectiveViewMode: "simple", 
      setViewMode: mockSetViewMode,
      canAccessPro: true,
      isLoading: false
    });
    render(<ViewModeToggle />);
    fireEvent.click(screen.getByText("Pro"));
    expect(mockSetViewMode).toHaveBeenCalledWith("pro");
    expect(screen.queryByTestId("pricing-modal")).toBeNull();
  });

  it("shows PricingModal when non-entitled user clicks Pro", () => {
    vi.mocked(useEffectiveViewMode).mockReturnValue({ 
      effectiveViewMode: "simple", 
      setViewMode: mockSetViewMode,
      canAccessPro: false,
      isLoading: false
    });
    render(<ViewModeToggle />);
    fireEvent.click(screen.getByText("Pro"));
    expect(mockSetViewMode).not.toHaveBeenCalled();
    expect(screen.getByTestId("pricing-modal")).toBeTruthy();
  });
});
