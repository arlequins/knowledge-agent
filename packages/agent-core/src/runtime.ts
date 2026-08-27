import type {
  KnowledgeSearchPort,
  MemorySearchPort,
  ModelProviderPort,
} from "./ports";
import type { AgentInput, AgentRun, ModelMessage } from "./types";

const MAX_CONTEXT_ITEMS = 6;
const MAX_KNOWLEDGE_CHARS = 10_000;

function boundedKnowledge(items: string[]) {
  const selected: string[] = [];
  let remaining = MAX_KNOWLEDGE_CHARS;
  for (const item of items) {
    if (remaining <= 0) break;
    const bounded = item.slice(0, remaining);
    if (bounded) selected.push(bounded);
    remaining -= bounded.length;
  }
  return selected;
}

function contextMessage(
  input: AgentInput,
  memories: string[],
  knowledge: string[],
): ModelMessage {
  const sections = [
    input.profile.instructions,
    input.conversationSummary
      ? `Conversation summary:\n${input.conversationSummary}`
      : undefined,
    input.liveEvidence?.length
      ? `Live business evidence (observed now; do not infer beyond these rows):\n${input.liveEvidence.join("\n\n")}`
      : undefined,
    memories.length > 0
      ? `Relevant memory:\n${memories.join("\n")}`
      : undefined,
    knowledge.length > 0
      ? `Retrieved knowledge:\n${boundedKnowledge(knowledge).join("\n\n")}`
      : undefined,
    "Use retrieved knowledge as evidence and distinguish project sources from official documentation. If it is insufficient or a static source cannot prove current business state, say what is unknown instead of inventing facts. Refer to the supplied source labels when explaining an answer.",
  ].filter((section): section is string => Boolean(section));

  return { role: "system", content: sections.join("\n\n") };
}

export function createAgentRuntime(dependencies: {
  knowledgeSearch: KnowledgeSearchPort;
  memorySearch: MemorySearchPort;
  model: ModelProviderPort;
}): { run(input: AgentInput): AgentRun } {
  return {
    async *run(input) {
      const [matches, memories] = await Promise.all([
        dependencies.knowledgeSearch.search({
          query: input.retrievalQuery ?? input.question,
          workspaceId: input.workspaceId,
        }),
        dependencies.memorySearch.search({
          query: input.retrievalQuery ?? input.question,
          workspaceId: input.workspaceId,
        }),
      ]);
      const selectedMatches = matches.slice(0, MAX_CONTEXT_ITEMS);
      const selectedMemories = memories.slice(0, MAX_CONTEXT_ITEMS);
      const citations = selectedMatches.map((match) => match.citation);

      yield { type: "retrieval-complete", citations };

      const messages: ModelMessage[] = [
        contextMessage(
          input,
          selectedMemories.map((memory) => memory.content),
          selectedMatches.map(
            (match) =>
              `[source: ${match.citation.label}${
                match.citation.locator ? ` · ${match.citation.locator}` : ""
              }]\n${match.content}`,
          ),
        ),
        ...input.history,
        { role: "user", content: input.question },
      ];

      for await (const text of dependencies.model.streamText({
        messages,
        ...(input.abortSignal ? { signal: input.abortSignal } : {}),
      })) {
        yield { type: "text-delta", text };
      }

      yield { type: "complete", citations };
    },
  };
}
