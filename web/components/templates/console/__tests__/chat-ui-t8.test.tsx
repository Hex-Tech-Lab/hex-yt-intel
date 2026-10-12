/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { chatMarkdownComponents, USER_BUBBLE_SELECTION_CLASS } from "../ChatDock";

vi.mock("@/store/useVideoStore", () => ({
  useVideoStore: (sel: (s: { seekAndReveal: () => void }) => unknown) =>
    sel({ seekAndReveal: () => {} }),
}));

describe("T8 chat timestamp uses the flyout seek class", () => {
  it("renders chat #t= links as the shared hx-timestamp-seek button", () => {
    const LinkRenderer = chatMarkdownComponents.link as unknown as (p: {
      href?: string;
      children?: React.ReactNode;
    }) => React.ReactElement;
    render(LinkRenderer({ href: "#t=01:30", children: "1:30" }));
    const btn = screen.getByRole("button", { name: "Seek to 01:30" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.classList.contains("hx-timestamp-seek")).toBe(true);
  });
});

describe("T8 user bubble selection highlight", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

  it("the user bubble className applies USER_BUBBLE_SELECTION_CLASS", () => {
    const src = read("../ChatDock.tsx");
    expect(src).toMatch(/\$\{USER_BUBBLE_SELECTION_CLASS\} !rounded-lg/);
  });

  it("globals.css keys a visible ::selection rule on that class", () => {
    const css = read("../../../../app/globals.css");
    expect(USER_BUBBLE_SELECTION_CLASS).toBe("user-chat-bubble");
    expect(css).toMatch(new RegExp(`\\.${USER_BUBBLE_SELECTION_CLASS}::selection[\\s\\S]*?\\{[\\s\\S]*?background-color`));
  });
});
