import type {
  ModelMessage,
  ModelProviderPort,
  StreamTextRequest,
} from "@arlequins/agent-core";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const MODEL_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;

export type GeminiProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  model?: string;
  requestTimeoutMs?: number;
};

function configuredSettings(options: GeminiProviderOptions) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("Gemini API key is required");
  const model = options.model?.trim() || DEFAULT_MODEL;
  if (model.length > 96 || !MODEL_ID_PATTERN.test(model))
    throw new Error("Gemini model ID is invalid");
  const url = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
  if (url.protocol !== "https:")
    throw new Error("Gemini base URL must use HTTPS");
  return {
    apiKey,
    baseUrl: url.toString().replace(/\/$/, ""),
    fetch: options.fetch ?? globalThis.fetch,
    model,
    requestTimeoutMs: options.requestTimeoutMs ?? 120_000,
  };
}

function requestSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function errorMessage(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string")
      return `Gemini request failed (${status}): ${parsed.error.message}`;
  } catch {
    // Provider error bodies are not guaranteed to be JSON.
  }
  return `Gemini request failed (${status})`;
}

async function* readServerSentEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      const events = buffered.split("\n\n");
      buffered = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        const parsed = JSON.parse(data) as unknown;
        if (parsed && typeof parsed === "object")
          yield parsed as Record<string, unknown>;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function geminiRequest(messages: ModelMessage[]) {
  const systemText = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    contents: messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        parts: [{ text: message.content }],
        role: message.role === "assistant" ? "model" : "user",
      })),
    ...(systemText
      ? { systemInstruction: { parts: [{ text: systemText }] } }
      : {}),
  };
}

/** Gemini Generate Content streaming adapter. The caller owns and supplies the API key. */
export function createGeminiModelProvider(
  options: GeminiProviderOptions,
): ModelProviderPort {
  const configured = configuredSettings(options);
  return {
    async *streamText(input: StreamTextRequest) {
      const response = await configured.fetch(
        `${configured.baseUrl}/models/${encodeURIComponent(configured.model)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": configured.apiKey,
          },
          body: JSON.stringify(geminiRequest(input.messages)),
          signal: requestSignal(configured.requestTimeoutMs, input.signal),
        },
      );
      if (!response.ok)
        throw new Error(errorMessage(response.status, await response.text()));
      if (!response.body)
        throw new Error("Gemini returned an empty response body");
      for await (const event of readServerSentEvents(response.body)) {
        const candidates = event.candidates;
        if (!Array.isArray(candidates)) continue;
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== "object") continue;
          const content = (candidate as { content?: unknown }).content;
          if (!content || typeof content !== "object") continue;
          const parts = (content as { parts?: unknown }).parts;
          if (!Array.isArray(parts)) continue;
          for (const part of parts) {
            if (!part || typeof part !== "object") continue;
            const value = part as { text?: unknown; thought?: unknown };
            if (
              value.thought !== true &&
              typeof value.text === "string" &&
              value.text.length > 0
            )
              yield value.text;
          }
        }
      }
    },
  };
}

export {
  DEFAULT_BASE_URL as DEFAULT_GEMINI_BASE_URL,
  DEFAULT_MODEL as DEFAULT_GEMINI_MODEL,
};
