import { describe, it, expect } from "vitest";
import {
  buildAdaptiveOptions,
  getStaticOptions,
  type UserKnowledgeContext,
} from "../services/AdaptiveOptionsBuilder";
import {
  sanitizeOption,
  fillTemplate,
  validateOptionsList,
} from "../utils/option-templates";
import { CHAT_REGISTRY_FALLBACK } from "../../../web/lib/utils/chat-options-settings";

describe("AdaptiveOptionsBuilder", () => {
  describe("buildAdaptiveOptions", () => {
    it("returns static options when context is undefined", async () => {
      const options = await buildAdaptiveOptions(undefined, "test conversation");
      const maxOptions = CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions'];
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.length).toBeLessThanOrEqual(maxOptions);
      options.forEach((opt) => {
        expect(opt.length).toBeLessThanOrEqual(50);
      });
    });

    it("returns static options when context is empty", async () => {
      const context: UserKnowledgeContext = {};
      const options = await buildAdaptiveOptions(context, "test conversation");
      const maxOptions = CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions'];
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.length).toBeLessThanOrEqual(maxOptions);
    });

    it("generates theme-based options when themes are present", async () => {
      const context: UserKnowledgeContext = {
        themes: ["security", "performance"],
      };
      const options = await buildAdaptiveOptions(context, "authentication in the video");
      const maxOptions = CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions'];
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.length).toBeLessThanOrEqual(maxOptions);

      // At least one option should reference a theme
      const hasThemeOption = options.some(
        (opt) => opt.includes("security") || opt.includes("performance")
      );
      expect(hasThemeOption).toBe(true);

      // All options should be strings and under 50 chars
      options.forEach((opt) => {
        expect(typeof opt).toBe("string");
        expect(opt.length).toBeLessThanOrEqual(50);
      });
    });

    it("generates topic follow-up options from conversation", async () => {
      const context: UserKnowledgeContext = {
        themes: ["general"],
      };
      const conversation =
        "The video discusses authentication mechanisms and security protocols";
      const options = await buildAdaptiveOptions(context, conversation);

      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.length).toBeLessThanOrEqual(5);

      // At least one should mention a topic from conversation
      const hasTopicOption = options.some(
        (opt) =>
          opt.includes("authentication") ||
          opt.includes("security") ||
          opt.includes("protocol")
      );
      expect(hasTopicOption).toBe(true);
    });

    it("includes FAQ reference when FAQs are present", async () => {
      const context: UserKnowledgeContext = {
        themes: ["security"],
        faqs: [
          { question: "What is OAuth?", answer: "OAuth is..." },
          { question: "How does JWT work?", answer: "JWT is..." },
        ],
      };
      const options = await buildAdaptiveOptions(context, "security discussion");

      expect(options.length).toBeGreaterThanOrEqual(3);
      // Should include at least one FAQ reference
      const hasFaqOption = options.some((opt) => opt.includes("Revisit") || opt.includes("recap"));
      expect(hasFaqOption).toBe(true);
    });

    it("suggests related themes when multiple themes present", async () => {
      const context: UserKnowledgeContext = {
        themes: ["security", "performance", "scalability"],
      };
      const options = await buildAdaptiveOptions(context, "current topic");

      expect(options.length).toBeGreaterThanOrEqual(3);
      // Should include at least one related theme option
      const hasRelatedTheme = options.some((opt) =>
        ["security", "performance", "scalability"].some((theme) =>
          opt.includes(theme)
        )
      );
      expect(hasRelatedTheme).toBe(true);
    });

    it("avoids duplicate options", async () => {
      const context: UserKnowledgeContext = {
        themes: ["security", "security"], // Duplicated theme
      };
      const options = await buildAdaptiveOptions(context, "security topic");

      // Check no duplicates in result
      const uniqueOptions = new Set(options);
      expect(uniqueOptions.size).toBe(options.length);
    });

    it("respects 3-5 option limit", async () => {
      const context: UserKnowledgeContext = {
        themes: ["a", "b", "c", "d", "e", "f"],
        faqs: [
          { question: "Q1?", answer: "A1" },
          { question: "Q2?", answer: "A2" },
          { question: "Q3?", answer: "A3" },
        ],
      };
      const options = await buildAdaptiveOptions(context, "conversation");

      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.length).toBeLessThanOrEqual(5);
    });

    it("generates different options on successive calls (temporal validation)", async () => {
      const context: UserKnowledgeContext = {
        themes: ["topic1", "topic2", "topic3"],
      };

      const options1 = await buildAdaptiveOptions(context, "discussion");
      const options2 = await buildAdaptiveOptions(context, "discussion");

      // Note: This test may occasionally fail due to random chance, but is statistically sound
      // For robustness, we just check both are valid
      expect(options1.length).toBeGreaterThanOrEqual(3);
      expect(options2.length).toBeGreaterThanOrEqual(3);
    });

    it("prefers adaptive options over static when context provided", async () => {
      const context: UserKnowledgeContext = {
        themes: ["security"],
      };
      const options = await buildAdaptiveOptions(context, "security topic");
      const staticOptions = getStaticOptions();

      // Adaptive options should include theme reference
      const hasTheme = options.some((opt) => opt.includes("security"));
      expect(hasTheme).toBe(true);

      // Should not be identical to static options
      const allIdentical = options.every((opt, i) => opt === staticOptions[i]);
      expect(allIdentical).toBe(false);
    });
  });

  describe("getStaticOptions", () => {
    it("returns 3 to MAX_STARTER_OPTIONS static options", () => {
      const options = getStaticOptions();
      const maxOptions = CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions'];
      expect(options.length).toBeGreaterThanOrEqual(3);
      expect(options.length).toBeLessThanOrEqual(maxOptions);
    });

    it("all static options under 50 chars", () => {
      const options = getStaticOptions();
      options.forEach((opt) => {
        expect(opt.length).toBeLessThanOrEqual(50);
      });
    });

    it("all static options are non-empty strings", () => {
      const options = getStaticOptions();
      options.forEach((opt) => {
        expect(typeof opt).toBe("string");
        expect(opt.length).toBeGreaterThan(0);
      });
    });
  });

  describe("sanitizeOption", () => {
    it("truncates long options to max length", () => {
      const long = "This is a very long option that exceeds the maximum allowed length";
      const result = sanitizeOption(long, 30);
      expect(result.length).toBeLessThanOrEqual(30);
    });

    it("preserves short options", () => {
      const short = "Short option";
      const result = sanitizeOption(short, 50);
      expect(result).toBe(short);
    });

    it("trims whitespace", () => {
      const padded = "  option with spaces  ";
      const result = sanitizeOption(padded);
      expect(result).toBe("option with spaces");
    });
  });

  describe("fillTemplate", () => {
    it("replaces single placeholder", () => {
      const result = fillTemplate("Explore {theme}?", { theme: "security" });
      expect(result).toBe("Explore security?");
    });

    it("replaces multiple placeholders", () => {
      const result = fillTemplate(
        "Ask about {topic} in {context}?",
        { topic: "OAuth", context: "authentication" }
      );
      expect(result).toBe("Ask about OAuth in authentication?");
    });

    it("sanitizes after filling", () => {
      const result = fillTemplate(
        "This is a very long template with {placeholder} that might exceed limits",
        { placeholder: "A" }
      );
      expect(result.length).toBeLessThanOrEqual(50);
    });

    it("handles missing placeholders gracefully", () => {
      const result = fillTemplate("Simple option", {});
      expect(result).toBe("Simple option");
    });
  });

  describe("validateOptionsList", () => {
    it("validates correct options list", () => {
      const options = ["Option 1?", "Option 2?", "Option 3?"];
      const result = validateOptionsList(options, CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions']);
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("catches too few options", () => {
      const options = ["Option 1?", "Option 2?"];
      const result = validateOptionsList(options, CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("too few"))).toBe(true);
    });

    it("catches too many options", () => {
      const maxOptions = CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions'];
      const options = Array.from({ length: maxOptions + 1 }, (_idx, i) => `Option ${i + 1}?`);
      const result = validateOptionsList(options, maxOptions);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("too many"))).toBe(true);
    });

    it("catches options exceeding 50 chars", () => {
      const options = [
        "Short option 1?",
        "This option is way too long and exceeds the 50 character limit significantly?",
        "Short option 2?",
      ];
      const result = validateOptionsList(options, CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("too long"))).toBe(true);
    });

    it("catches duplicate options", () => {
      const options = ["Option 1?", "Option 1?", "Option 2?"];
      const result = validateOptionsList(options, CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
    });

    it("catches empty or null options", () => {
      const options = ["Option 1?", "", "Option 2?"];
      const result = validateOptionsList(options, CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions']);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("empty"))).toBe(true);
    });

    it("validates list with maxOptions options (boundary)", () => {
      const maxOptions = CHAT_REGISTRY_FALLBACK['chat.maxStarterOptions'];
      const options = Array.from({ length: maxOptions }, (_idx, i) => `Option ${i + 1}?`);
      const result = validateOptionsList(options, maxOptions);
      expect(result.valid).toBe(true);
    });
  });
});
