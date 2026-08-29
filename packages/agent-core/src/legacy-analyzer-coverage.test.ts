import { describe, expect, it } from "vitest";

import {
  createLegacyAnalyzerRegistry,
  type LegacyAnalyzerPort,
} from "./legacy-analyzer";

const multiLanguageAnalyzer: LegacyAnalyzerPort = {
  analyze: async (input) => ({
    analyzerId: "coverage",
    confidence: 0.5,
    dataModels: [],
    diagnostics: ["  warning  ", ""],
    language: input.language ?? "csharp",
    provenance: {
      analyzedAt: "2026-08-27T00:00:00.000Z",
      sourceUri: input.sourceUri,
    },
    routes: [
      {
        handler: "  Handler  ",
        location: { endLine: 3.9, startLine: 2.1 },
        method: " get ",
        path: " /items ",
      },
      { location: {}, method: "", path: "" },
    ],
    symbols: [
      { kind: "class", location: { endLine: 4 }, name: "Item" },
      { kind: "unknown", location: {}, name: "" },
    ],
  }),
  id: "coverage",
  languages: ["csharp", "java", "ruby"],
  supports: (input) =>
    [".cs", ".csproj", ".java", ".rb"].some((suffix) =>
      input.filename.endsWith(suffix),
    ) || input.filename.endsWith("Gemfile"),
};

describe("legacy analyzer edge coverage", () => {
  it("detects C#, Ruby project files, and rejects unknown filenames", () => {
    const registry = createLegacyAnalyzerRegistry([multiLanguageAnalyzer]);
    for (const filename of ["Program.cs", "project.csproj", "Gemfile"]) {
      expect(
        registry.detect({
          filename,
          content: "",
          sourceUri: `git://${filename}`,
        }),
      ).toBe(filename === "Gemfile" ? "ruby" : "csharp");
    }
    expect(
      registry.detect({
        content: "",
        filename: "notes.txt",
        language: "java",
        sourceUri: "git://notes.txt",
      }),
    ).toBeUndefined();
    expect(
      registry.detect({
        content: "",
        filename: "notes.txt",
        sourceUri: "git://notes.txt",
      }),
    ).toBeUndefined();
  });

  it("normalizes empty optional fields and invalid locations", async () => {
    const result = await createLegacyAnalyzerRegistry([
      multiLanguageAnalyzer,
    ]).analyze({
      content: "",
      filename: "Program.cs",
      sourceUri: "git://Program.cs",
    });
    expect(result.diagnostics).toEqual(["warning"]);
    expect(result.routes[0]).toMatchObject({
      handler: "Handler",
      method: "GET",
      path: "/items",
    });
    expect(result.routes[0]?.location).toEqual({ endLine: 3, startLine: 2 });
    expect(result.routes[1]?.location).toBeUndefined();
    expect(result.symbols[0]?.location).toEqual({
      endLine: 4,
      startLine: undefined,
    });
    expect(result.symbols[1]?.location).toBeUndefined();
  });

  it("rejects an analyzer without declared languages", () => {
    expect(() =>
      createLegacyAnalyzerRegistry([
        { ...multiLanguageAnalyzer, languages: [] },
      ]),
    ).toThrow("no languages");
  });
});
