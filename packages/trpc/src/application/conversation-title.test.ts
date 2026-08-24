import { describe, expect, it } from "vitest";
import {
  conversationTitleFromQuestion,
  isGenericConversationTitle,
} from "./conversation-title";

describe("conversation titles", () => {
  it("derives a compact title from the first Markdown question", () => {
    expect(conversationTitleFromQuestion("**훅스란?** 자세히 알려줘")).toBe(
      "훅스란? 자세히 알려줘",
    );
  });

  it("recognizes the localized generic titles", () => {
    expect(isGenericConversationTitle("새 대화")).toBe(true);
    expect(isGenericConversationTitle("New conversation")).toBe(true);
    expect(isGenericConversationTitle("React 훅 설명")).toBe(false);
  });
});
