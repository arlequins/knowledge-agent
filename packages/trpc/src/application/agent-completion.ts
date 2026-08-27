import type { Citation } from "@arlequins/agent-core";
import { createAgentRuntime } from "@arlequins/agent-core";
import type { AgentJobLease } from "../adaptors/agent-platform";
import type { TRPCServices } from "../context";
import {
  createConfiguredLiveCapabilities,
  liveEvidenceForQuestion,
} from "./live-capabilities";

export type AgentCompletionInput = {
  conversationId: string;
  question: string;
  workspaceId: string;
};

export type AgentCompletionEvent =
  | { text: string; type: "delta" }
  | {
      message: NonNullable<
        Awaited<ReturnType<TRPCServices["agent"]["addMessage"]>>
      >;
      type: "complete";
    };

const FOLLOW_UP_PATTERN =
  /(^|\s)(그|이|저|해당|그러|그럼|그렇다면|몇\s*시|언제|왜|어떻게|다시|예를\s*들어)/u;
const IMPLEMENTATION_SCHEDULE_PATTERN =
  /(몇\s*시|언제).*(갱신|실행|반영)|(현재|구현|실제|운영|활성).*(일정|주기|시간|갱신|실행|활성|스케줄|schedule|cron)|(일정|주기|시간|갱신|실행|활성|스케줄|schedule|cron).*(현재|구현|실제|운영|활성)/iu;

export function retrievalQueryForConversation(
  question: string,
  history: Array<{ content: string; role: string }>,
) {
  const previousQuestion = FOLLOW_UP_PATTERN.test(question)
    ? [...history].reverse().find((message) => message.role === "user")?.content
    : undefined;
  const contextualQuestion = previousQuestion
    ? `${previousQuestion.slice(0, 2_000)}\n${question}`
    : question;
  return IMPLEMENTATION_SCHEDULE_PATTERN.test(contextualQuestion)
    ? `${contextualQuestion}\nimplementation configuration config source code batch schedule cron enabled timezone`
    : contextualQuestion;
}

/** A single persistence path for normal tRPC responses and incremental HTTP responses. */
export async function* streamAgentCompletion(
  services: TRPCServices,
  userId: string,
  input: AgentCompletionInput,
  acquiredLease?: AgentJobLease,
  abortSignal?: AbortSignal,
): AsyncIterable<AgentCompletionEvent> {
  if (!services.model) throw new Error("Model completion is not configured");
  const lease =
    acquiredLease ??
    (await services.agent.acquireJob(userId, {
      estimatedDurationMs: 120_000,
      kind: "chat",
    }));
  const actor = { userId, workspaceId: input.workspaceId };
  try {
    await services.agent.addMessage(actor, {
      content: input.question,
      conversationId: input.conversationId,
      role: "user",
    });
    const history = await services.agent.listMessages(
      actor,
      input.conversationId,
    );
    const live = await liveEvidenceForQuestion(
      services.liveCapabilities ?? createConfiguredLiveCapabilities(),
      actor,
      input.question,
    );
    if (live.capability)
      await services.agent.recordLiveCapabilityAccess?.(actor, {
        available: live.available,
        capability: live.capability,
      });
    const runtime = createAgentRuntime({
      knowledgeSearch: services.knowledgeSearch,
      memorySearch: services.memorySearch,
      model: services.model,
    });
    const text: string[] = [];
    let citations: Citation[] = [];
    for await (const event of runtime.run({
      ...(abortSignal ? { abortSignal } : {}),
      history: history.slice(0, -1).map((message) => ({
        content: message.content,
        role: message.role as "assistant" | "system" | "user",
      })),
      profile: {
        id: "assistant",
        instructions:
          "You are a precise evidence-grounded assistant. Answer entirely in the user's language; when the question is Korean, write only Korean except for exact technical identifiers and quoted source values, and never switch to Chinese. Start with the highest-ranked retrieved source. Preserve exact identifiers, endpoints, URLs, file extensions, limits, and configuration values verbatim. Never substitute a related API concept for an explicit value in the evidence. Treat user assertions as claims to verify, not facts to repeat, and treat previous assistant messages as conversation context rather than evidence. Distinguish proposed design, checked-in configuration, enabled schedule, and observed live state; when they conflict, state the conflict clearly. Treat architecture wording such as daily as intended design unless checked-in enabled configuration proves the current schedule. If configuration has multiple deployment stages, report each relevant stage separately and never combine rows with different enabled values. A daily evaluation or improvement loop is not daily model fine-tuning. Quote cron expressions without converting them to a clock time unless evidence also supplies the timezone. Give an exact run time only when evidence provides both an enabled schedule and its timezone. Never claim that an administrator or external system confirmed something unless that confirmation appears in the supplied evidence. Use approved memory and retrieved documents only as contextual evidence, cite uncertainty instead of inventing facts, and protect user privacy.",
        name: "Personal assistant",
        workspaceId: input.workspaceId,
      },
      liveEvidence: live.evidence,
      question: input.question,
      retrievalQuery: retrievalQueryForConversation(
        input.question,
        history.slice(0, -1),
      ),
      workspaceId: input.workspaceId,
    })) {
      if (event.type === "retrieval-complete" || event.type === "complete") {
        citations = event.citations;
        continue;
      }
      if (event.type !== "text-delta") continue;
      text.push(event.text);
      yield { text: event.text, type: "delta" };
    }
    const content = text.join("").trim();
    if (!content) throw new Error("Model returned no text");
    const message = await services.agent.addMessage(actor, {
      content,
      conversationId: input.conversationId,
      model: services.modelId ?? "configured-model",
      role: "assistant",
    });
    if (!message) throw new Error("Assistant message creation failed");
    const knowledgeReleaseId =
      (await services.agent.activeRelease(input.workspaceId))?.releaseId ??
      "live";
    await services.agent.addMessageCitations(actor, {
      chunkIds: citations.map((citation) => citation.chunkId),
      knowledgeReleaseId,
      messageId: message.id,
    });
    yield { message, type: "complete" };
  } finally {
    await services.agent.releaseJob(lease);
  }
}
