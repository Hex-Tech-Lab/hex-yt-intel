/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { useChatStore } from "@/store/useChatStore";
import { chatMarkdownComponents, ChatDock, USER_BUBBLE_SELECTION_CLASS } from "../ChatDock";

vi.mock("@/store/useVideoStore", () => ({
  useVideoStore: (selector: (state: { seekAndReveal: () => void }) => unknown) =>
    selector({ seekAndReveal: () => {} }),
}));

describe("T8 chat timestamp uses the flyout seek class", () => {
  it("renders chat #t= links as the shared hx-timestamp-seek button", () => {
    const LinkRenderer = chatMarkdownComponents.link as unknown as (props: {
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
  const USER_TEXT = "t8 user bubble probe message";

  beforeEach(() => {
    // jsdom has no Element.scrollTo; ChatDock auto-scrolls the message list on mount.
    Element.prototype.scrollTo = () => {};
    useChatStore.setState({
      isChatOpen: true,
      conversations: [{ id: "c-t8", title: "T8", updatedAt: new Date().toISOString() } as never],
      activeId: "c-t8",
      messagesByConv: {
        "c-t8": [{ id: "m-t8", role: "user", content: USER_TEXT, createdAt: new Date().toISOString() } as never],
      },
      loadConversations: () => Promise.resolve(),
      selectConversation: () => Promise.resolve(),
      bindNetwork: () => {},
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("the rendered user message bubble carries the user-chat-bubble class", () => {
    render(<ChatDock />);
    const text = screen.getByText(USER_TEXT);
    expect(text.closest(".user-chat-bubble")).not.toBeNull();
  });

  it("globals.css scopes both ::selection declarations to the dock and the bubble class", () => {
    const css = read("../../../../app/globals.css");
    expect(USER_BUBBLE_SELECTION_CLASS).toBe("user-chat-bubble");
    const rule = css.match(/\[data-chat-dock="true"\] \.user-chat-bubble::selection[^{]*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const body = rule![1];
    expect(body).toMatch(/background-color:\s*var\(--void\)/);
    expect(body).toMatch(/(^|[;\s])color:\s*var\(--accent-ink\)/);
  });
});
