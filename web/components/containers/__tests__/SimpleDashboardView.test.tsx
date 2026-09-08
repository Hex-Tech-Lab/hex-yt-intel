/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SimpleDashboardView } from "../SimpleDashboardView";

// Mock other components to simplify test
vi.mock("@/components/organisms/ExecutiveSummary", () => ({
  ExecutiveSummary: () => <div data-testid="mock-executive-summary" />,
}));
vi.mock("@/components/dashboard/HighlightsScrubber", () => ({
  HighlightsScrubber: () => <div data-testid="mock-highlights-scrubber" />,
}));
vi.mock("@/components/templates/console/VideoPlayerCard", () => ({
  VideoPlayerCard: () => <div data-testid="mock-video-player" />,
}));
vi.mock("@/components/templates/console/BentoMetadata", () => ({
  BentoMetadata: () => <div data-testid="mock-bento-metadata" />,
}));

describe("SimpleDashboardView", () => {
  it("renders the executive summary when status is complete", () => {
    render(
      <SimpleDashboardView
        status="complete"
        analysisId="test-1"
        videoMetadata={{}}
        digest={{}}
        digestLoading={false}
        mappedDigestData={[]}
        partialInfo={null}
        TOTAL_DIMENSIONS={11}
        hasHadVideo={true}
      />,
    );

    expect(screen.getByTestId("mock-executive-summary")).toBeTruthy();
  });

  it("renders the partial-analysis warning when partialInfo is present (parity with Pro)", () => {
    render(
      <SimpleDashboardView
        status="complete"
        analysisId="test-1"
        videoMetadata={{}}
        digest={{}}
        digestLoading={false}
        mappedDigestData={[]}
        partialInfo={{ presentCount: 10, missing: [5] }}
        TOTAL_DIMENSIONS={11}
        hasHadVideo={true}
      />,
    );

    expect(screen.getByText(/Partial analysis warning/)).toBeTruthy();
    expect(screen.getByText(/10 of 11 dimensions generated/)).toBeTruthy();
  });

  it("omits the partial-analysis warning when partialInfo is null", () => {
    render(
      <SimpleDashboardView
        status="complete"
        analysisId="test-1"
        videoMetadata={{}}
        digest={{}}
        digestLoading={false}
        mappedDigestData={[]}
        partialInfo={null}
        TOTAL_DIMENSIONS={11}
        hasHadVideo={true}
      />,
    );

    expect(screen.queryByText(/Partial analysis warning/)).toBeNull();
  });
});
