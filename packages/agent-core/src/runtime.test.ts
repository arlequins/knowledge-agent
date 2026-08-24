import { describe, expect, it } from "vitest";

import { createAgentRuntime } from "./runtime";

describe("createAgentRuntime", () => {
  it("keeps workspace-scoped memory and knowledge in the model context", async () => {
    const runtime = createAgentRuntime({
      knowledgeSearch: {
        async search() {
          return [
            {
              citation: {
                chunkId: "chunk-1",
                documentId: "doc-1",
                label: "Policy",
              },
              content: "The refund period is 14 days.",
              score: 0.9,
            },
          ];
        },
      },
      memorySearch: {
        async search() {
          return [
            {
              content: "The user prefers concise answers.",
              id: "memory-1",
              importance: 1,
            },
          ];
        },
      },
      model: {
        async *streamText(input) {
          expect(input.messages[0]?.content).toContain("concise answers");
          expect(input.messages[0]?.content).toContain("refund period");
          expect(input.messages[0]?.content).toContain("[source: Policy]");
          yield "Fourteen days.";
        },
      },
    });

    const events = [];
    for await (const event of runtime.run({
      history: [],
      profile: {
        id: "assistant",
        instructions: "Be helpful.",
        name: "Assistant",
        workspaceId: "workspace-1",
      },
      question: "What is the refund period?",
      workspaceId: "workspace-1",
    }))
      events.push(event);

    expect(events).toEqual([
      {
        type: "retrieval-complete",
        citations: [
          { chunkId: "chunk-1", documentId: "doc-1", label: "Policy" },
        ],
      },
      { type: "text-delta", text: "Fourteen days." },
      {
        type: "complete",
        citations: [
          { chunkId: "chunk-1", documentId: "doc-1", label: "Policy" },
        ],
      },
    ]);
  });

  it("bounds retrieved context before calling a small local model", async () => {
    const runtime = createAgentRuntime({
      knowledgeSearch: {
        async search() {
          return Array.from({ length: 6 }, (_, index) => ({
            citation: {
              chunkId: `chunk-${index}`,
              documentId: `doc-${index}`,
              label: `Source ${index}`,
            },
            content: "x".repeat(100_000),
            score: 1,
          }));
        },
      },
      memorySearch: {
        async search() {
          return [];
        },
      },
      model: {
        async *streamText(input) {
          expect(input.messages[0]?.content.length).toBeLessThan(11_000);
          yield "Bounded.";
        },
      },
    });

    for await (const _event of runtime.run({
      history: [],
      profile: {
        id: "assistant",
        instructions: "Be precise.",
        name: "Assistant",
        workspaceId: "workspace-1",
      },
      question: "Question",
      workspaceId: "workspace-1",
    })) {
      // Drain the run to exercise the model boundary.
    }
  });
});
