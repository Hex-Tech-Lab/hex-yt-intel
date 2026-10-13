/** @vitest-environment jsdom */
import * as Sentry from "@sentry/nextjs";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useChatStore } from "@/store/useChatStore";
import { useAnalysisStore } from "@/store/useAnalysisStore";
import { chatMarkdownComponents, ChatDock, USER_BUBBLE_SELECTION_CLASS } from "../ChatDock";

vi.mock("@/store/useVideoStore", () => ({
  useVideoStore: (selector: (state: { seekAndReveal: () => void }) => unknown) =>
    selector({ seekAndReveal: () => {} }),
}));

type AlertConfig = { onAction: () => Promise<void> };
const alertDialog = vi.hoisted(() => ({ shown: null as unknown, hide: () => {} }));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@astryxdesign/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@astryxdesign/core")>()),
  useImperativeAlertDialog: () => ({
    show: (config: unknown) => { alertDialog.shown = config; },
    hide: alertDialog.hide,
  }),
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
    Element.prototype.scrollIntoView = () => {};
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

  it("the ::selection pair is legible on the accent bubble and covers the bubble and its descendants", () => {
    expect(USER_BUBBLE_SELECTION_CLASS).toBe("user-chat-bubble");
    const root = postcss.parse(read("../../../../app/globals.css"));
    const tokens = new Map<string, string>();
    const selectionDecls = new Map<string, string>();
    root.walkRules((rule) => {
      const isRoot = rule.selectors.some((sel) => sel === ":root" || sel === "html");
      rule.walkDecls((decl) => {
        if (isRoot && decl.prop.startsWith("--") && !tokens.has(decl.prop)) tokens.set(decl.prop, decl.value.trim());
      });
      for (const sel of rule.selectors) {
        if (sel.includes("::selection") && sel.includes('[data-chat-dock="true"]') && sel.includes(".user-chat-bubble")) {
          rule.walkDecls((decl) => selectionDecls.set(`${sel}|${decl.prop}`, decl.value.trim()));
        }
      }
    });
    const resolveToken = (value: string | undefined) => {
      const ref = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
      return ref ? tokens.get(ref) : value;
    };
    const luminance = (hex: string) => {
      const [red, green, blue] = (hex.match(/[0-9a-f]{2}/gi) ?? []).map((channel) => parseInt(channel, 16) / 255)
        .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const contrast = (first: string, second: string) => {
      const [hi, lo] = [luminance(first), luminance(second)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    const bubbleSel = '[data-chat-dock="true"] .user-chat-bubble::selection';
    const descendantSel = '[data-chat-dock="true"] .user-chat-bubble *::selection';
    for (const sel of [bubbleSel, descendantSel]) {
      const bg = resolveToken(selectionDecls.get(`${sel}|background-color`));
      const fg = resolveToken(selectionDecls.get(`${sel}|color`));
      expect(bg, `${sel} background`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(fg, `${sel} color`).toMatch(/^#[0-9a-f]{6}$/i);
      // Text on the highlight must be AAA-legible, and the highlight must stand out from the bubble fill (--accent).
      expect(contrast(bg!, fg!)).toBeGreaterThanOrEqual(7);
      expect(contrast(bg!, tokens.get("--accent")!)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("ChatDock comment-expansion failures are logged and captured", () => {
  beforeEach(() => {
    Element.prototype.scrollTo = () => {};
    Element.prototype.scrollIntoView = () => {};
    // Astryx Markdown (assistant bubbles) reads prefers-reduced-motion/color-scheme via matchMedia; jsdom lacks it.
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    alertDialog.shown = null;
    vi.mocked(Sentry.captureException).mockClear();
    useAnalysisStore.setState({ videoMetadata: { videoId: "vid-t8" } } as never);
    useChatStore.setState({
      isChatOpen: true,
      conversations: [{ id: "c-x", title: "X", updatedAt: new Date().toISOString() } as never],
      activeId: "c-x",
      messagesByConv: {
        "c-x": [{ id: "m-x", role: "assistant", content: 'Body\nOPTIONS: ["expand-comments"]', createdAt: new Date().toISOString() } as never],
      },
      loadConversations: () => Promise.resolve(),
      selectConversation: () => Promise.resolve(),
      bindNetwork: () => {},
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("captures a failed cost estimate with the comment-estimate tag", async () => {
    const failure = new Error("estimate down");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ChatDock />);
    fireEvent.click(screen.getByRole("button", { name: /Expand to full comments/ }));
    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, { tags: { component: "ChatDock", operation: "comment-estimate" } });
    expect(errorSpy).toHaveBeenCalledWith("[ChatDock] Comment expansion cost estimate failed:", failure);
  });

  it("captures a failed expansion start with the comment-expansion tag", async () => {
    const failure = new Error("start down");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: () => Promise.resolve({ estimatedCredits: 3 }) })
      .mockRejectedValueOnce(failure);
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ChatDock />);
    fireEvent.click(screen.getByRole("button", { name: /Expand to full comments/ }));
    await waitFor(() => expect(alertDialog.shown).not.toBeNull());
    await (alertDialog.shown as AlertConfig).onAction();
    expect(Sentry.captureException).toHaveBeenCalledWith(failure, { tags: { component: "ChatDock", operation: "comment-expansion" } });
    expect(errorSpy).toHaveBeenCalledWith("[ChatDock] Comment expansion start failed:", failure);
  });
});
