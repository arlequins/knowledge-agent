import { describe, expect, it } from "vitest";

import {
  createLegacyAnalyzerRegistry,
  type LegacyAnalyzerPort,
} from "./legacy-analyzer";

const javaAnalyzer: LegacyAnalyzerPort = {
  analyze: async (input) => ({
    analyzerId: "java-spring",
    confidence: 4,
    dataModels: [{ fields: ["id", "email"], name: "Customer" }],
    diagnostics: [],
    language: "java",
    projectType: "Spring MVC",
    provenance: {
      analyzedAt: "2026-08-27T00:00:00.000Z",
      sourceUri: input.sourceUri,
    },
    routes: [{ method: "get", path: "/customers" }],
    symbols: [{ kind: "class", name: "CustomerController" }],
  }),
  id: "java-spring",
  languages: ["java"],
  supports: (input) => input.filename.endsWith(".java"),
};

describe("createLegacyAnalyzerRegistry", () => {
  it("detects by filename and returns bounded, normalized analysis", async () => {
    const registry = createLegacyAnalyzerRegistry([javaAnalyzer]);
    const source = {
      content: "class CustomerController {}",
      filename: "CustomerController.java",
      sourceUri: "git://example/repo/CustomerController.java",
    };
    expect(registry.detect(source)).toBe("java");
    const result = await registry.analyze(source);
    expect(result.confidence).toBe(1);
    expect(result.routes[0]?.method).toBe("GET");
    expect(result.provenance.sourceUri).toContain("git://");
  });

  it("orders analyzers and rejects duplicate ids", () => {
    const first = { ...javaAnalyzer, id: "z-java" };
    const second = { ...javaAnalyzer, id: "a-java" };
    expect(
      createLegacyAnalyzerRegistry([first, second])
        .list()
        .map((a) => a.id),
    ).toEqual(["a-java", "z-java"]);
    expect(() =>
      createLegacyAnalyzerRegistry([javaAnalyzer, javaAnalyzer]),
    ).toThrow("Duplicate");
  });
  it("fails closed when no parser supports the source", async () => {
    const registry = createLegacyAnalyzerRegistry([javaAnalyzer]);
    expect(
      registry.detect({
        content: "puts :ok",
        filename: "script.rb",
        sourceUri: "git://example/repo/script.rb",
      }),
    ).toBeUndefined();
    await expect(
      registry.analyze({
        content: "puts :ok",
        filename: "script.rb",
        sourceUri: "git://example/repo/script.rb",
      }),
    ).rejects.toThrow("No legacy analyzer");
  });
});
