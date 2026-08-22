import { describe, expect, it } from "vitest";
import {
  isUsableKnowledgeSource,
  queryTerms,
  selectDiverseResults,
} from "./agent-retrieval";

describe("local agent retrieval ranking", () => {
  it("expands Korean improvement and business terms to source identifiers", () => {
    expect(queryTerms("실시간 개선 루프와 최근 판매 차량 조회")).toEqual(
      expect.arrayContaining([
        "real-time",
        "improvement",
        "loop",
        "recent",
        "sold",
        "vehicles",
        "list",
      ]),
    );
  });

  it("prevents one document from occupying the entire context", () => {
    expect(
      selectDiverseResults(
        [
          { documentId: "a", id: "a1" },
          { documentId: "a", id: "a2" },
          { documentId: "a", id: "a3" },
          { documentId: "b", id: "b1" },
          { documentId: "c", id: "c1" },
        ],
        4,
        2,
      ).map(({ id }) => id),
    ).toEqual(["a1", "a2", "b1", "c1"]);
  });

  it("rejects generated build caches from retrieval", () => {
    expect(
      isUsableKnowledgeSource("packages/trpc/.cache/tsbuildinfo.json"),
    ).toBe(false);
    expect(isUsableKnowledgeSource("packages/trpc/src/router/agent.ts")).toBe(
      true,
    );
  });
});
