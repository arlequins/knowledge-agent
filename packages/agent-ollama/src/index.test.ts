import { describe, expect, it } from "vitest";

import {
  createOllamaEmbeddingProvider,
  createOllamaModelProvider,
} from "./index";

describe("createOllamaModelProvider", () => {
  it("streams Ollama chat chunks and uses the configured local model", async () => {
    const requests: Request[] = [];
    const provider = createOllamaModelProvider({
      baseUrl: "http://127.0.0.1:11434",
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(
          '{"message":{"content":"Hello"}}\n{"message":{"content":" world"},"done":true}\n',
          { status: 200 },
        );
      },
      model: "qwen3:4b",
    });

    const chunks: string[] = [];
    for await (const chunk of provider.streamText({
      messages: [{ role: "user", content: "Hi" }],
    }))
      chunks.push(chunk);

    expect(chunks.join("")).toBe("Hello world");
    expect(requests[0]?.url).toBe("http://127.0.0.1:11434/api/chat");
    const body = (await requests[0]?.json()) as {
      messages: Array<{ content: string; role: string }>;
    };
    expect(body).toMatchObject({
      model: "qwen3:4b",
      options: { num_predict: 768, seed: 42, temperature: 0.1 },
      stream: true,
      think: false,
    });
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("rejects remote endpoints to keep local conversations local", () => {
    expect(() =>
      createOllamaModelProvider({ baseUrl: "https://example.com" }),
    ).toThrow("loopback");
  });

  it("includes Ollama error details in a failed request", async () => {
    const provider = createOllamaModelProvider({
      fetch: async () =>
        new Response('{"error":"template rejected the prompt"}', {
          status: 400,
        }),
    });

    await expect(async () => {
      for await (const _chunk of provider.streamText({
        messages: [{ role: "user", content: "Question" }],
      })) {
        // No chunks are expected from an error response.
      }
    }).rejects.toThrow('400): {"error":"template rejected the prompt"}');
  });

  it("removes tagged Qwen reasoning from user-facing output", async () => {
    const provider = createOllamaModelProvider({
      fetch: async () =>
        new Response(
          [
            '{"message":{"content":"<thi"}}',
            '{"message":{"content":"nk>private reasoning"}}',
            '{"message":{"content":"</think>Final answer"},"done":true}',
          ].join("\n"),
        ),
    });
    const chunks: string[] = [];
    for await (const chunk of provider.streamText({
      messages: [{ role: "user", content: "Question" }],
    }))
      chunks.push(chunk);
    expect(chunks.join("")).toBe("Final answer");
  });

  it("keeps an ordinary answer when the model emits no reasoning tag", async () => {
    const provider = createOllamaModelProvider({
      fetch: async () =>
        new Response('{"message":{"content":"Grounded answer"},"done":true}\n'),
    });
    const chunks: string[] = [];
    for await (const chunk of provider.streamText({
      messages: [{ role: "user", content: "Question" }],
    }))
      chunks.push(chunk);
    expect(chunks.join("")).toBe("Grounded answer");
  });

  it("embeds batches through the local Ollama endpoint", async () => {
    const provider = createOllamaEmbeddingProvider({
      baseUrl: "http://localhost:11434",
      fetch: async () =>
        new Response(
          JSON.stringify({
            embeddings: [
              [0.1, 0.2],
              [0.3, 0.4],
            ],
          }),
        ),
      model: "nomic-embed-text",
    });
    await expect(
      provider.embed({ input: ["first", "second"] }),
    ).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });
});
