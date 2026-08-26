/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SimpleDashboardView } from "../SimpleDashboardView";

// Mock dynamic WordCloud
vi.mock("next/dynamic", () => ({
  default: () => {
    return function MockWordCloud() {
      return <div data-testid="mock-word-cloud">WordCloud</div>;
    };
  },
}));

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
  it("renders WordCloud when status is complete and graph nodes exist", () => {
    const mockGraph = {
      nodes: [{ id: "1", label: "Test", weight: 0.5 }],
      edges: []
    };

    render(
      <SimpleDashboardView
        status="complete"
        analysisId="test-1"
        videoMetadata={{}}
        digest={{}}
        digestLoading={false}
        mappedDigestData={[]}
        graph={mockGraph}
        selectedNodeId={null}
        onSelectNode={vi.fn()}
        hasHadVideo={true}
      />
    );

    expect(screen.getByTestId("mock-word-cloud")).toBeTruthy();
  });
});
