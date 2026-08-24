import type {
  EmbeddingProviderPort,
  KnowledgeSearchPort,
  MemorySearchPort,
} from "@arlequins/agent-core";
import type { Database } from "@arlequins/db-backbone/client";
import {
  Document,
  DocumentChunk,
  MemoryRecord,
} from "@arlequins/db-backbone/schema";
import { type AnyColumn, and, desc, eq, ilike, isNull, or } from "drizzle-orm";

const MAX_RESULTS = 6;
const MAX_RESULTS_PER_DOCUMENT = 2;
const GENERATED_SOURCE_SEGMENTS = [
  "/.cache/",
  "/.next/",
  "/.next-",
  "/.turbo/",
  "/dist/",
  "/node_modules/",
] as const;
const cosine = (left: number[], right: number[]) => {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
};
const pattern = (query: string) => `%${query.replace(/[\\%_]/g, "\\$&")}%`;

export function queryTerms(query: string, limit?: number) {
  const terms = query.match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const normalized = terms.map((term) => term.toLocaleLowerCase());
  const aliases = [
    ["채팅", "chat"],
    ["엔드포인트", "endpoint"],
    ["엔드포인트", "api"],
    ["임베딩", "embedding"],
    ["모델", "model"],
    ["개선", "improvement"],
    ["루프", "loop"],
    ["실시간", "real-time"],
    ["실시간", "real"],
    ["파인튜닝", "fine-tuning"],
    ["파인튜닝", "fine"],
    ["파인튜닝", "tuning"],
    ["주기", "daily"],
    ["검증", "evaluation"],
    ["공지", "notices"],
    ["최근", "recent"],
    ["판매", "sold"],
    ["차량", "vehicles"],
    ["조회", "list"],
    ["안전", "authorization"],
    ["공식", "official"],
    ["소스", "sources"],
    ["레포", "readme"],
    ["레포", "repository"],
    ["저장소", "readme"],
    ["저장소", "repository"],
    ["목적", "template"],
    ["목적", "purpose"],
    ["선택", "select"],
    ["마이그레이션", "migrations"],
  ] as const;
  for (const term of normalized)
    for (const [prefix, alias] of aliases)
      if (term.startsWith(prefix)) normalized.push(alias);
  const unique = [...new Set(normalized)];
  return limit ? unique.slice(0, limit) : unique;
}

export function selectDiverseResults<T extends { documentId: string }>(
  rows: T[],
  limit = MAX_RESULTS,
  maximumPerDocument = MAX_RESULTS_PER_DOCUMENT,
) {
  const selected: T[] = [];
  const documentCounts = new Map<string, number>();
  for (const row of rows) {
    if ((documentCounts.get(row.documentId) ?? 0) >= maximumPerDocument)
      continue;
    selected.push(row);
    documentCounts.set(
      row.documentId,
      (documentCounts.get(row.documentId) ?? 0) + 1,
    );
    if (selected.length === limit) break;
  }
  return selected;
}

export function isUsableKnowledgeSource(label: string) {
  const normalized = `/${label.replaceAll("\\", "/")}`;
  return !GENERATED_SOURCE_SEGMENTS.some((segment) =>
    normalized.includes(segment),
  );
}

export function repositoryOverviewScore(
  query: string,
  label: string,
  content: string,
) {
  const terms = new Set(queryTerms(query));
  const asksForRepositoryPurpose =
    (terms.has("repository") || terms.has("readme")) &&
    (terms.has("purpose") || terms.has("template"));
  if (!asksForRepositoryPurpose || label.toLocaleLowerCase() !== "readme.md")
    return 0;
  return /^#\s+\S+/u.test(content.trimStart()) ? 2 : 0.35;
}

function citationLabel(label: string, sourceUri: string) {
  return label.startsWith("[official:") && /^https?:\/\//.test(sourceUri)
    ? `${label} · ${sourceUri}`
    : label;
}

function keywordScore(query: string, content: string) {
  const expected = queryTerms(query, 32);
  if (expected.length === 0) return 0;
  const actual = new Set(queryTerms(content));
  let matches = 0;
  for (const term of expected) if (actual.has(term)) matches += 1;
  return Math.min(1, matches / Math.min(expected.length, 4));
}

function textMatch(column: AnyColumn, query: string) {
  const terms = queryTerms(query, 32);
  return terms.length > 0
    ? or(...terms.map((term) => ilike(column, pattern(term))))
    : ilike(column, pattern(query));
}

export function createDatabaseMemorySearch(
  database: Database,
): MemorySearchPort {
  return {
    search: async ({ query, workspaceId }) =>
      database
        .select({
          content: MemoryRecord.content,
          id: MemoryRecord.id,
          importance: MemoryRecord.importance,
        })
        .from(MemoryRecord)
        .where(
          and(
            eq(MemoryRecord.workspaceId, workspaceId),
            eq(MemoryRecord.status, "approved"),
            isNull(MemoryRecord.expiresAt),
            textMatch(MemoryRecord.content, query),
          ),
        )
        .orderBy(desc(MemoryRecord.importance))
        .limit(MAX_RESULTS),
  };
}

export function createDatabaseKnowledgeSearch(
  database: Database,
  options: { embedding?: EmbeddingProviderPort } = {},
): KnowledgeSearchPort {
  return {
    search: async ({ query, workspaceId }) => {
      if (options.embedding) {
        try {
          const [queryEmbedding] = await options.embedding.embed({
            input: [query],
          });
          if (queryEmbedding) {
            const vectorRows = await database
              .select({
                chunkId: DocumentChunk.id,
                content: DocumentChunk.content,
                documentId: Document.id,
                embedding: DocumentChunk.embedding,
                label: Document.filename,
                locator: DocumentChunk.locator,
                sourceUri: Document.sourceUri,
              })
              .from(DocumentChunk)
              .innerJoin(Document, eq(DocumentChunk.documentId, Document.id))
              .where(
                and(
                  eq(Document.workspaceId, workspaceId),
                  eq(Document.status, "completed"),
                  isNull(Document.deletedAt),
                ),
              );
            const ranked = vectorRows
              .filter((row) => isUsableKnowledgeSource(row.label))
              .filter((row): row is typeof row & { embedding: number[] } =>
                Array.isArray(row.embedding),
              )
              .map((row) => ({
                ...row,
                score:
                  cosine(queryEmbedding, row.embedding) +
                  keywordScore(query, row.label) * 1.25 +
                  keywordScore(query, row.content) * 0.65 +
                  repositoryOverviewScore(query, row.label, row.content),
              }))
              .filter((row) => row.score > 0.2)
              .sort((left, right) => right.score - left.score);
            const selected = selectDiverseResults(ranked);
            if (selected.length > 0)
              return selected.map((row) => ({
                citation: {
                  chunkId: row.chunkId,
                  documentId: row.documentId,
                  label: citationLabel(row.label, row.sourceUri),
                  ...(row.locator ? { locator: row.locator } : {}),
                },
                content: row.content,
                score: row.score,
              }));
          }
        } catch {
          // Local retrieval must remain usable when the optional embedding model is not pulled.
        }
      }
      const rows = await database
        .select({
          chunkId: DocumentChunk.id,
          content: DocumentChunk.content,
          documentId: Document.id,
          label: Document.filename,
          locator: DocumentChunk.locator,
          sourceUri: Document.sourceUri,
        })
        .from(DocumentChunk)
        .innerJoin(Document, eq(DocumentChunk.documentId, Document.id))
        .where(
          and(
            eq(Document.workspaceId, workspaceId),
            eq(Document.status, "completed"),
            isNull(Document.deletedAt),
            textMatch(DocumentChunk.content, query),
          ),
        )
        .limit(MAX_RESULTS * MAX_RESULTS_PER_DOCUMENT * 10);
      return selectDiverseResults(
        rows.filter((row) => isUsableKnowledgeSource(row.label)),
      ).map((row) => ({
        citation: {
          chunkId: row.chunkId,
          documentId: row.documentId,
          label: citationLabel(row.label, row.sourceUri),
          ...(row.locator ? { locator: row.locator } : {}),
        },
        content: row.content,
        score: 1,
      }));
    },
  };
}
