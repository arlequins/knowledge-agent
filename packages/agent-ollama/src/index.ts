import type {
  EmbeddingProviderPort,
  ModelProviderPort,
  StreamTextRequest,
} from "@arlequins/agent-core";

export type OllamaModelProviderOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  model?: string;
  /** Bounds local latency and prevents runaway reasoning from consuming the request timeout. */
  numPredict?: number;
  requestTimeoutMs?: number;
  /** Low deterministic sampling keeps local evaluation reproducible. */
  seed?: number;
  temperature?: number;
  /** Disable model reasoning traces by default; user-facing conversations receive final text only. */
  think?: boolean;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "knowledge-agent-gemma3:12b";
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

function normalizedLocalBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OLLAMA_BASE_URL must use HTTP(S)");
  }
  const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!localHosts.has(url.hostname)) {
    throw new Error("OLLAMA_BASE_URL must target a loopback host");
  }
  return url.toString().replace(/\/$/, "");
}

async function* readNdjson(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield JSON.parse(line) as unknown;
      }
    }
    buffered += decoder.decode();
    if (buffered.trim()) yield JSON.parse(buffered) as unknown;
  } finally {
    reader.releaseLock();
  }
}

async function* visibleAnswerChunks(
  chunks: AsyncIterable<string>,
): AsyncIterable<string> {
  let mode: "answer" | "reasoning" | "unknown" = "unknown";
  let buffered = "";
  for await (const chunk of chunks) {
    if (mode === "answer") {
      yield chunk;
      continue;
    }
    buffered += chunk;
    const normalized = buffered.trimStart();
    if (mode === "unknown") {
      if ("<think>".startsWith(normalized)) continue;
      if (!normalized.startsWith("<think>")) {
        mode = "answer";
        yield buffered;
        buffered = "";
        continue;
      }
      mode = "reasoning";
    }
    const closing = buffered.lastIndexOf("</think>");
    if (closing < 0) continue;
    mode = "answer";
    const answer = buffered.slice(closing + "</think>".length);
    buffered = "";
    if (answer) yield answer;
  }
  if (buffered) yield buffered;
}

function requestSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Local-only Ollama `/api/chat` adapter. No cloud credentials or SDK are involved. */
export function createOllamaModelProvider(
  options: OllamaModelProviderOptions = {},
): ModelProviderPort {
  const baseUrl = normalizedLocalBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const model = options.model?.trim() || DEFAULT_MODEL;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const numPredict = options.numPredict ?? 768;
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  const seed = options.seed ?? 42;
  const temperature = options.temperature ?? 0.1;
  const think = options.think ?? false;

  return {
    async *streamText(input: StreamTextRequest) {
      const response = await fetchImpl(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: input.messages,
          options: { num_predict: numPredict, seed, temperature },
          stream: true,
          think,
        }),
        signal: requestSignal(requestTimeoutMs, input.signal),
      });
      if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 300);
        throw new Error(
          `Ollama request failed (${response.status})${detail ? `: ${detail}` : ""}`,
        );
      }
      if (!response.body)
        throw new Error("Ollama returned an empty response body");

      async function* contentChunks() {
        for await (const item of readNdjson(response.body!)) {
          if (!item || typeof item !== "object") continue;
          const message = (item as { message?: { content?: unknown } }).message;
          if (
            typeof message?.content === "string" &&
            message.content.length > 0
          )
            yield message.content;
        }
      }
      if (think) yield* contentChunks();
      else yield* visibleAnswerChunks(contentChunks());
    },
  };
}

/** Local-only Ollama `/api/embed` adapter. `nomic-embed-text` is small and purpose-built for retrieval. */
export function createOllamaEmbeddingProvider(
  options: {
    baseUrl?: string;
    fetch?: typeof globalThis.fetch;
    model?: string;
    requestTimeoutMs?: number;
  } = {},
): EmbeddingProviderPort {
  const baseUrl = normalizedLocalBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const model = options.model?.trim() || DEFAULT_EMBEDDING_MODEL;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
  return {
    async embed({ input }) {
      if (input.length === 0) return [];
      const response = await fetchImpl(`${baseUrl}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, model }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      if (!response.ok)
        throw new Error(`Ollama embedding request failed (${response.status})`);
      const result = (await response.json()) as { embeddings?: unknown };
      if (
        !Array.isArray(result.embeddings) ||
        result.embeddings.some(
          (embedding) =>
            !Array.isArray(embedding) ||
            embedding.some((value) => typeof value !== "number"),
        )
      )
        throw new Error("Ollama returned invalid embeddings");
      return result.embeddings as number[][];
    },
  };
}

export {
  DEFAULT_BASE_URL as DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_EMBEDDING_MODEL as DEFAULT_OLLAMA_EMBEDDING_MODEL,
  DEFAULT_MODEL as DEFAULT_OLLAMA_MODEL,
};
