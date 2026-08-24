const genericTitles = new Set(["new conversation", "새 대화"]);

export function isGenericConversationTitle(title: string): boolean {
  return genericTitles.has(title.trim().toLowerCase());
}

export function conversationTitleFromQuestion(question: string): string {
  const normalized = question
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_~>#[\](){}|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "새 대화";
  const characters = Array.from(normalized);
  return characters.length > 56
    ? `${characters.slice(0, 56).join("")}…`
    : normalized;
}
