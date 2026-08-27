/**
 * Provider-neutral extension point for analysing legacy applications.
 *
 * Parsers stay outside the core package. A derived application can register a
 * Java/Spring, Ruby/Rails, C#/ASP.NET, or any other analyser without changing
 * retrieval, chat, or persistence contracts.
 */
export type LegacyLanguage = "csharp" | "java" | "ruby";

export type LegacySource = {
  content: string;
  filename: string;
  language?: LegacyLanguage;
  sourceUri: string;
};

export type LegacyLocation = {
  endLine?: number;
  startLine?: number;
};

export type LegacySymbol = {
  kind: "class" | "constant" | "method" | "module" | "struct" | "unknown";
  location?: LegacyLocation;
  name: string;
};

export type LegacyRoute = {
  handler?: string;
  location?: LegacyLocation;
  method: string;
  path: string;
};

export type LegacyDataModel = {
  fields: string[];
  location?: LegacyLocation;
  name: string;
};

export type LegacyAnalysis = {
  analyzerId: string;
  confidence: number;
  dataModels: LegacyDataModel[];
  diagnostics: string[];
  language: LegacyLanguage;
  projectType?: string;
  provenance: {
    analyzedAt: string;
    sourceUri: string;
  };
  routes: LegacyRoute[];
  symbols: LegacySymbol[];
};

export type LegacyAnalyzerPort = {
  analyze(input: LegacySource): Promise<LegacyAnalysis>;
  id: string;
  languages: LegacyLanguage[];
  supports(input: LegacySource): boolean;
};

export type LegacyAnalyzerRegistry = {
  analyze(input: LegacySource): Promise<LegacyAnalysis>;
  detect(input: LegacySource): LegacyLanguage | undefined;
  list(): LegacyAnalyzerPort[];
};

const MAX_DIAGNOSTICS = 20;
const MAX_FIELDS = 50;
const MAX_ITEMS = 100;
const MAX_TEXT = 2_048;

function text(value: string, max = MAX_TEXT) {
  return value.trim().slice(0, max);
}
function location(value?: LegacyLocation): LegacyLocation | undefined {
  if (!value) return undefined;
  const startLine = Number.isFinite(value.startLine)
    ? Math.max(1, Math.floor(value.startLine ?? 1))
    : undefined;
  const endLine = Number.isFinite(value.endLine)
    ? Math.max(startLine ?? 1, Math.floor(value.endLine ?? startLine ?? 1))
    : undefined;
  return startLine || endLine ? { endLine, startLine } : undefined;
}

function boundedAnalysis(value: LegacyAnalysis): LegacyAnalysis {
  const confidence = Number.isFinite(value.confidence)
    ? Math.max(0, Math.min(1, value.confidence))
    : 0;
  return {
    analyzerId: text(value.analyzerId, 128),
    confidence,
    dataModels: value.dataModels.slice(0, MAX_ITEMS).map((model) => ({
      fields: model.fields
        .slice(0, MAX_FIELDS)
        .map((field) => text(field, 256))
        .filter(Boolean),
      location: location(model.location),
      name: text(model.name, 256),
    })),
    diagnostics: value.diagnostics
      .slice(0, MAX_DIAGNOSTICS)
      .map((diagnostic) => text(diagnostic, 512))
      .filter(Boolean),
    language: value.language,
    ...(value.projectType ? { projectType: text(value.projectType, 256) } : {}),
    provenance: {
      analyzedAt: new Date(value.provenance.analyzedAt).toISOString(),
      sourceUri: text(value.provenance.sourceUri, 2_048),
    },
    routes: value.routes.slice(0, MAX_ITEMS).map((route) => ({
      ...(route.handler ? { handler: text(route.handler, 256) } : {}),
      location: location(route.location),
      method: text(route.method, 32).toUpperCase(),
      path: text(route.path, 512),
    })),
    symbols: value.symbols.slice(0, MAX_ITEMS).map((symbol) => ({
      kind: symbol.kind,
      location: location(symbol.location),
      name: text(symbol.name, 256),
    })),
  };
}

function languageFromFilename(filename: string): LegacyLanguage | undefined {
  const lower = filename.toLocaleLowerCase();
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".rb") || lower.endsWith("gemfile")) return "ruby";
  if (lower.endsWith(".cs") || lower.endsWith(".csproj")) return "csharp";
  return undefined;
}

/** Create a deterministic analyser registry with duplicate-id protection. */
export function createLegacyAnalyzerRegistry(
  analyzers: LegacyAnalyzerPort[],
): LegacyAnalyzerRegistry {
  const byId = new Set<string>();
  for (const analyzer of analyzers) {
    if (!analyzer.id.trim() || byId.has(analyzer.id))
      throw new Error(`Duplicate or empty legacy analyzer id: ${analyzer.id}`);
    if (!analyzer.languages.length)
      throw new Error(`Legacy analyzer has no languages: ${analyzer.id}`);
    byId.add(analyzer.id);
  }
  const ordered = [...analyzers].sort((a, b) => a.id.localeCompare(b.id));
  return {
    analyze: async (input) => {
      const analyzer = ordered.find((candidate) => candidate.supports(input));
      if (!analyzer) throw new Error("No legacy analyzer supports this source");
      const result = await analyzer.analyze(input);
      return boundedAnalysis(result);
    },
    detect: (input) => {
      const language = input.language ?? languageFromFilename(input.filename);
      if (!language) return undefined;
      return ordered.some(
        (candidate) =>
          candidate.languages.includes(language) && candidate.supports(input),
      )
        ? language
        : undefined;
    },
    list: () => [...ordered],
  };
}
