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
    expect(() =>
      createLegacyAnalyzerRegistry([
        javaAnalyzer,
        { ...javaAnalyzer, id: " java-spring " },
      ]),
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

  it("anchors analyzer identity, language, and provenance to the input", async () => {
    const spoofed = {
      ...javaAnalyzer,
      analyze: async (input) => ({
        ...(await javaAnalyzer.analyze(input)),
        provenance: {
          analyzedAt: "2026-08-27T00:00:00.000Z",
          sourceUri: "git://attacker/other.java",
        },
      }),
    } satisfies LegacyAnalyzerPort;
    const source = {
      content: "class CustomerController {}",
      filename: "CustomerController.java",
      sourceUri: "git://trusted/repo/CustomerController.java",
    };
    const result = await createLegacyAnalyzerRegistry([spoofed]).analyze(
      source,
    );
    expect(result.provenance.sourceUri).toBe(source.sourceUri);

    await expect(
      createLegacyAnalyzerRegistry([
        {
          ...javaAnalyzer,
          analyze: async (input) => ({
            ...(await javaAnalyzer.analyze(input)),
            analyzerId: "other-analyzer",
          }),
        },
      ]).analyze(source),
    ).rejects.toThrow("identity mismatch");
    await expect(
      createLegacyAnalyzerRegistry([
        {
          ...javaAnalyzer,
          analyze: async (input) => ({
            ...(await javaAnalyzer.analyze(input)),
            language: "ruby",
          }),
        },
      ]).analyze(source),
    ).rejects.toThrow("unsupported language");
  });

  it("snapshots registrations and rejects incompatible input languages", async () => {
    const mutable = {
      ...javaAnalyzer,
      languages: [...javaAnalyzer.languages],
    };
    const registry = createLegacyAnalyzerRegistry([mutable]);
    mutable.id = "mutated";
    mutable.languages.length = 0;
    const listed = registry.list();
    listed[0]?.languages.splice(0);

    expect(registry.list()[0]).toMatchObject({
      id: "java-spring",
      languages: ["java"],
    });
    await expect(
      registry.analyze({
        content: "class CustomerController {}",
        filename: "CustomerController.java",
        language: "ruby",
        sourceUri: "git://example/repo/CustomerController.java",
      }),
    ).rejects.toThrow("No legacy analyzer");
  });

  it("rejects invalid analysis timestamps with a stable contract error", async () => {
    const registry = createLegacyAnalyzerRegistry([
      {
        ...javaAnalyzer,
        analyze: async (input) => ({
          ...(await javaAnalyzer.analyze(input)),
          provenance: { analyzedAt: "not-a-date", sourceUri: input.sourceUri },
        }),
      },
    ]);
    await expect(
      registry.analyze({
        content: "class CustomerController {}",
        filename: "CustomerController.java",
        sourceUri: "git://example/repo/CustomerController.java",
      }),
    ).rejects.toThrow("invalid analyzedAt timestamp");
  });

  it("passes immutable source snapshots to adapter hooks", async () => {
    const analyzer: LegacyAnalyzerPort = {
      ...javaAnalyzer,
      analyze: async (input) => {
        expect(Object.isFrozen(input)).toBe(true);
        return javaAnalyzer.analyze(input);
      },
      supports: (input) => {
        expect(Object.isFrozen(input)).toBe(true);
        return javaAnalyzer.supports(input);
      },
    };
    const registry = createLegacyAnalyzerRegistry([analyzer]);
    const source = {
      content: "class CustomerController {}",
      filename: "CustomerController.java",
      sourceUri: "git://example/repo/CustomerController.java",
    };
    expect(registry.detect(source)).toBe("java");
    await expect(registry.analyze(source)).resolves.toMatchObject({
      analyzerId: "java-spring",
      language: "java",
    });
    expect(Object.isFrozen(source)).toBe(false);
  });

  it("supports explicitly declared extension languages", async () => {
    const cobolAnalyzer: LegacyAnalyzerPort = {
      analyze: async (input) => ({
        analyzerId: "cobol-program",
        confidence: 0.8,
        dataModels: [],
        diagnostics: [],
        language: "cobol",
        provenance: {
          analyzedAt: "2026-08-27T00:00:00.000Z",
          sourceUri: input.sourceUri,
        },
        routes: [],
        symbols: [],
      }),
      id: "cobol-program",
      languages: ["cobol"],
      supports: (input) => input.filename.endsWith(".cbl"),
    };
    const registry = createLegacyAnalyzerRegistry([cobolAnalyzer]);
    const source = {
      content: "IDENTIFICATION DIVISION.",
      filename: "CUSTOMER.cbl",
      language: "cobol",
      sourceUri: "git://example/repo/CUSTOMER.cbl",
    };
    expect(registry.detect(source)).toBe("cobol");
    await expect(registry.analyze(source)).resolves.toMatchObject({
      analyzerId: "cobol-program",
      language: "cobol",
    });
    expect(() =>
      createLegacyAnalyzerRegistry([
        { ...cobolAnalyzer, languages: ["COBOL with spaces"] },
      ]),
    ).toThrow("invalid language id");
  });
});
