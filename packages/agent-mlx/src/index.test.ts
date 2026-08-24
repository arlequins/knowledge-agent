import { describe, expect, it, vi } from "vitest";
import { createMlxModelProvider } from ".";

describe("MLX model provider", () => {
  it("streams OpenAI-compatible chat completion deltas", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          'data: {"choices":[{"delta":{"content":"교정"}}]}\n\ndata: [DONE]\n\n',
          { status: 200 },
        ),
      );
    const provider = createMlxModelProvider({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch,
      model: "local-tuned",
    });
    const chunks: string[] = [];
    for await (const chunk of provider.streamText({
      messages: [{ content: "질문", role: "user" }],
    }))
      chunks.push(chunk);
    expect(chunks).toEqual(["교정"]);
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 384,
      repetition_context_size: 512,
      repetition_penalty: 1.18,
      stream: true,
      temperature: 0.1,
    });
  });

  it("hides reasoning and stops a repeated answer before the duplicate", async () => {
    const sentence = "하나 둘 셋 넷 다섯 여섯 일곱 여덟";
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          [
            'data: {"choices":[{"delta":{"content":"<think>내부 추론</think>"}}]}',
            `data: {"choices":[{"delta":{"content":"${sentence}. "}}]}`,
            `data: {"choices":[{"delta":{"content":"${sentence}. 계속"}}]}`,
            "data: [DONE]",
            "",
          ].join("\n"),
          { status: 200 },
        ),
      );
    const provider = createMlxModelProvider({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch,
      model: "local",
    });
    const chunks: string[] = [];
    for await (const chunk of provider.streamText({
      messages: [{ content: "질문", role: "user" }],
    }))
      chunks.push(chunk);
    expect(chunks.join("")).toBe(`${sentence}. `);
  });

  it("rejects non-loopback servers", () => {
    expect(() =>
      createMlxModelProvider({
        baseUrl: "https://example.com/v1",
        model: "remote",
      }),
    ).toThrow("localhost");
  });

  it("uses the reviewed non-thinking coding profile for Ornith", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n', {
        status: 200,
      }),
    );
    const provider = createMlxModelProvider({
      baseUrl: "http://127.0.0.1:8000/v1",
      fetch,
      model: "ornith-ai/Ornith-1.5-9B-MLX-4bit",
    });
    for await (const _chunk of provider.streamText({ messages: [] })) {
      // Consume the stream so the request is made.
    }
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      chat_template_kwargs: { enable_thinking: false },
      repetition_penalty: 1,
      temperature: 0.6,
      top_k: 20,
      top_p: 0.95,
    });
  });
});
