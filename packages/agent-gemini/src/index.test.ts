import { describe, expect, it, vi } from "vitest";

import { createGeminiModelProvider } from "./index";

function sseResponse(events: unknown[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("createGeminiModelProvider", () => {
  it("streams visible text and maps system and assistant roles", async () => {
    const fetch = vi.fn().mockResolvedValue(
      sseResponse([
        {
          candidates: [
            {
              content: {
                parts: [{ text: "hidden", thought: true }, { text: "안녕" }],
              },
            },
          ],
        },
        { candidates: [{ content: { parts: [{ text: "하세요" }] } }] },
      ]),
    );
    const provider = createGeminiModelProvider({
      apiKey: "gemini-secret",
      fetch,
      model: "gemini-3.5-flash-lite",
    });
    const chunks: string[] = [];

    for await (const chunk of provider.streamText({
      messages: [
        { content: "근거만 사용", role: "system" },
        { content: "이전 답", role: "assistant" },
        { content: "질문", role: "user" },
      ],
    }))
      chunks.push(chunk);

    expect(chunks).toEqual(["안녕", "하세요"]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-goog-api-key": "gemini-secret",
        }),
      }),
    );
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      contents: [
        { parts: [{ text: "이전 답" }], role: "model" },
        { parts: [{ text: "질문" }], role: "user" },
      ],
      systemInstruction: { parts: [{ text: "근거만 사용" }] },
    });
  });

  it("rejects an empty key and unsafe model IDs", () => {
    expect(() => createGeminiModelProvider({ apiKey: " " })).toThrow(
      "Gemini API key is required",
    );
    expect(() =>
      createGeminiModelProvider({
        apiKey: "key",
        model: "../unsafe/model",
      }),
    ).toThrow("Gemini model ID is invalid");
  });
});
