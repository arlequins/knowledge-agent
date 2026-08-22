import type {
  ModelProviderPort,
  StreamTextRequest,
} from "@arlequins/agent-core";

export type MlxProviderOptions = {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  model: string;
  requestTimeoutMs?: number;
};

function settings(options: MlxProviderOptions) {
  const url = new URL(options.baseUrl);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1")
    throw new Error("MLX_BASE_URL must target localhost");
  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    fetch: options.fetch ?? globalThis.fetch,
    model: options.model.trim(),
    requestTimeoutMs: options.requestTimeoutMs ?? 180_000,
  };
}

async function* events(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        yield JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: unknown } }>;
          error?: { message?: unknown };
        };
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

export function createMlxModelProvider(
  options: MlxProviderOptions,
): ModelProviderPort {
  const configured = settings(options);
  if (!configured.model) throw new Error("MLX_MODEL is required");
  return {
    async *streamText(input: StreamTextRequest) {
      const response = await configured.fetch(
        `${configured.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            max_tokens: 512,
            messages: input.messages,
            model: configured.model,
            repetition_context_size: 128,
            repetition_penalty: 1.12,
            stream: true,
            temperature: 0.1,
          }),
          signal: input.signal
            ? AbortSignal.any([
                input.signal,
                AbortSignal.timeout(configured.requestTimeoutMs),
              ])
            : AbortSignal.timeout(configured.requestTimeoutMs),
        },
      );
      if (!response.ok)
        throw new Error(`MLX request failed (${response.status})`);
      if (!response.body) throw new Error("MLX returned an empty response");
      for await (const event of events(response.body)) {
        if (typeof event.error?.message === "string")
          throw new Error("MLX response generation failed");
        const content = event.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) yield content;
      }
    },
  };
}
