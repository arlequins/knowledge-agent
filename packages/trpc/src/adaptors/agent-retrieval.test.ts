import { describe, expect, it } from "vitest";
import {
  isUsableKnowledgeSource,
  queryTerms,
  repositoryOverviewScore,
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

  it("expands a short Korean repository-purpose question to README terms", () => {
    expect(queryTerms("현재의 레포의 목적을 알려줘")).toEqual(
      expect.arrayContaining(["readme", "repository", "template", "purpose"]),
    );
  });

  it("prioritizes the root README introduction for repository-purpose questions", () => {
    expect(
      repositoryOverviewScore(
        "현재의 레포의 목적을 알려줘",
        "README.md",
        "# knowledge-agent\n\nAn AWS-ready template",
      ),
    ).toBe(2);
    expect(
      repositoryOverviewScore(
        "현재의 레포의 목적을 알려줘",
        "docs/template-readiness.md",
        "# Template readiness",
      ),
    ).toBe(0);
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
    expect(
      isUsableKnowledgeSource("apps/web/.next-e2e/dev/static/chunk.js"),
    ).toBe(false);
    expect(isUsableKnowledgeSource("packages/trpc/src/router/agent.ts")).toBe(
      true,
    );
  });
});
