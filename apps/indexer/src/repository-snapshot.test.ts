import { describe, expect, it } from "vitest";
import { staleRepositoryDocumentIds } from "./repository-snapshot";

describe("repository snapshot pruning", () => {
  it("returns only active documents missing from the completed scan", () => {
    expect(
      staleRepositoryDocumentIds(
        [
          { filename: "README.md", id: "keep" },
          { filename: "removed.ts", id: "remove" },
        ],
        new Set(["README.md", "src/current.ts"]),
      ),
    ).toEqual(["remove"]);
  });
});
