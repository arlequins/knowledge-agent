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
      max_tokens: 512,
      repetition_context_size: 128,
      repetition_penalty: 1.12,
      stream: true,
      temperature: 0.1,
    });
  });

  it("rejects non-loopback servers", () => {
    expect(() =>
      createMlxModelProvider({
        baseUrl: "https://example.com/v1",
        model: "remote",
      }),
    ).toThrow("localhost");
  });
});
