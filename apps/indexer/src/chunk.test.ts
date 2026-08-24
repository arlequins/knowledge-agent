import { describe, expect, it } from "vitest";
import { chunkMarkdown, chunkSource } from "./chunk";

describe("knowledge chunks", () => {
  it("keeps Markdown headings as evidence locators", () => {
    const chunks = chunkMarkdown(
      "# Sales\nSeven days.\n## Rules\nApproved only.",
      "docs/sales.md",
    );
    expect(chunks.map((chunk) => chunk.locator)).toEqual([
      "docs/sales.md#Sales",
      "docs/sales.md#Rules",
    ]);
  });

  it("keeps source line ranges", () => {
    const chunks = chunkSource(
      Array.from({ length: 90 }, (_, index) => `line ${index + 1}`).join("\n"),
      "src/api.ts",
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.locator).toBe("src/api.ts#L61-L90");
    expect(chunks[1]?.content).toContain("line 61");
  });

  it("bounds a generated single-line source file", () => {
    const chunks = chunkSource("x".repeat(7_000), ".cache/build.json");
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.content.length <= 2_400)).toBe(true);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual([0, 1, 2]);
  });
});
