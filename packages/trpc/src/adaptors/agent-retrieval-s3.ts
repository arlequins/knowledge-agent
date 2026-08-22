import type {
  EmbeddingProviderPort,
  KnowledgeSearchPort,
  MemorySearchPort,
} from "@arlequins/agent-core";
import type { S3AgentPlatformRepository } from "./agent-platform-s3";

const MAX_RESULTS = 8;

function terms(value: string) {
  const normalized = value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1);
  const aliases = [
    ["채팅", "chat"],
    ["엔드포인트", "endpoint"],
    ["엔드포인트", "api"],
    ["임베딩", "embedding"],
    ["모델", "model"],
  ] as const;
  for (const term of normalized)
    for (const [prefix, alias] of aliases)
      if (term.startsWith(prefix)) normalized.push(alias);
  return new Set(normalized);
}

function keywordScore(query: string, content: string) {
  const expected = terms(query);
  if (!expected.size) return 0;
  const actual = terms(content);
  let matches = 0;
  for (const term of expected) if (actual.has(term)) matches += 1;
  return Math.min(1, matches / Math.min(expected.size, 4));
}

function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (!leftMagnitude || !rightMagnitude) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function createS3MemorySearch(
  repository: S3AgentPlatformRepository,
): MemorySearchPort {
  return {
    async search({ query, workspaceId }) {
      return (await repository.listApprovedMemories(workspaceId))
        .map((memory) => ({
          content: memory.content,
          id: memory.id,
          importance: memory.importance,
          score: keywordScore(query, memory.content),
        }))
        .filter((memory) => memory.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || right.importance - left.importance,
        )
        .slice(0, MAX_RESULTS)
        .map(({ score: _, ...memory }) => memory);
    },
  };
}

export function createS3KnowledgeSearch(
  repository: S3AgentPlatformRepository,
  options: { embedding?: EmbeddingProviderPort } = {},
): KnowledgeSearchPort {
  return {
    async search({ query, workspaceId }) {
      const chunks = await repository.listKnowledgeChunks(workspaceId);
      let queryEmbedding: number[] | undefined;
      if (
        options.embedding &&
        chunks.some((chunk) => chunk.embedding?.length)
      ) {
        try {
          [queryEmbedding] = await options.embedding.embed({ input: [query] });
        } catch {
          queryEmbedding = undefined;
        }
      }
      return chunks
        .map((chunk) => ({
          citation: {
            chunkId: chunk.chunkId,
            documentId: chunk.documentId,
            label: chunk.label,
            ...(chunk.locator ? { locator: chunk.locator } : {}),
          },
          content: chunk.content,
          score:
            queryEmbedding && chunk.embedding
              ? cosineSimilarity(queryEmbedding, chunk.embedding) +
                keywordScore(query, chunk.label) * 1.25 +
                keywordScore(query, chunk.content) * 0.35
              : keywordScore(query, `${chunk.label}\n${chunk.content}`),
        }))
        .filter((chunk) => chunk.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, MAX_RESULTS);
    },
  };
}
