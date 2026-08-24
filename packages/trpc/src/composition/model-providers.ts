import { createBedrockModelProvider } from "@arlequins/agent-bedrock";
import type {
  EmbeddingProviderPort,
  ModelProviderPort,
} from "@arlequins/agent-core";
import { createGeminiModelProvider } from "@arlequins/agent-gemini";
import { createMlxModelProvider } from "@arlequins/agent-mlx";
import {
  createOllamaEmbeddingProvider,
  createOllamaModelProvider,
} from "@arlequins/agent-ollama";
import {
  createOpenAIEmbeddingProvider,
  createOpenAIModelProvider,
} from "@arlequins/agent-openai";
import { serverEnv } from "@arlequins/env";
import { createAwsBedrockConversePort } from "../adaptors/bedrock-converse";
import type { ModelCredentialRepository } from "../adaptors/model-credential";

export type ModelProviderId =
  | "bedrock"
  | "gemini"
  | "mlx"
  | "ollama"
  | "openai";

export type ModelCatalog = {
  defaultModel?: {
    label: string;
    modelId: string;
    provider: ModelProviderId;
  };
  providers: Array<{
    id: ModelProviderId;
    label: string;
    models: Array<{ id: string; label: string }>;
    requiresApiKey: boolean;
    supportsCustomModel: boolean;
  }>;
};

type ConfiguredModel = {
  model: ModelProviderPort;
  modelId: string;
  provider: ModelProviderId;
};

export class ModelSelectionError extends Error {
  override readonly name = "ModelSelectionError";
}

const MODEL_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const MODEL_PROVIDER_HEADER = "x-agent-model-provider";
const MODEL_ID_HEADER = "x-agent-model";

function validatedModelId(value: string | null, fallback: string) {
  const modelId = value?.trim() || fallback;
  if (modelId.length > 96 || !MODEL_ID_PATTERN.test(modelId))
    throw new ModelSelectionError("Invalid model ID");
  return modelId;
}

function configuredServerModels(): ConfiguredModel[] {
  const models: ConfiguredModel[] = [];
  if (serverEnv.MLX_BASE_URL && serverEnv.MLX_MODEL) {
    models.push({
      model: createMlxModelProvider({
        baseUrl: serverEnv.MLX_BASE_URL,
        model: serverEnv.MLX_MODEL,
      }),
      modelId: serverEnv.MLX_MODEL,
      provider: "mlx",
    });
  }
  if (serverEnv.OPENAI_API_KEY) {
    const modelId = serverEnv.OPENAI_MODEL ?? "gpt-5.6-luna";
    models.push({
      model: createOpenAIModelProvider({
        apiKey: serverEnv.OPENAI_API_KEY,
        baseUrl: serverEnv.OPENAI_BASE_URL,
        model: modelId,
      }),
      modelId,
      provider: "openai",
    });
  }
  if (serverEnv.BEDROCK_MODEL_ID) {
    models.push({
      model: createBedrockModelProvider({
        client: createAwsBedrockConversePort(),
        modelId: serverEnv.BEDROCK_MODEL_ID,
      }),
      modelId: serverEnv.BEDROCK_MODEL_ID,
      provider: "bedrock",
    });
  }
  if (serverEnv.OLLAMA_BASE_URL) {
    const modelId = serverEnv.OLLAMA_MODEL ?? "knowledge-agent-gemma3:12b";
    models.push({
      model: createOllamaModelProvider({
        baseUrl: serverEnv.OLLAMA_BASE_URL,
        model: modelId,
      }),
      modelId,
      provider: "ollama",
    });
  }
  return models;
}

function providerLabel(provider: ModelProviderId) {
  if (provider === "ollama") return "로컬 Ollama";
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Google Gemini";
  if (provider === "mlx") return "로컬 MLX";
  return "Amazon Bedrock";
}

function modelCatalog(serverModels: ConfiguredModel[]): ModelCatalog {
  const defaultModel = serverModels[0];
  const configured = serverModels.map((item) => ({
    id: item.provider,
    label: providerLabel(item.provider),
    models: [{ id: item.modelId, label: item.modelId }],
    requiresApiKey: false,
    supportsCustomModel: item.provider === "ollama",
  }));
  return {
    ...(defaultModel
      ? {
          defaultModel: {
            label: `${providerLabel(defaultModel.provider)} · ${defaultModel.modelId}`,
            modelId: defaultModel.modelId,
            provider: defaultModel.provider,
          },
        }
      : {}),
    providers: [
      ...configured,
      {
        id: "gemini",
        label: "Google Gemini · 개인 키",
        models: [
          { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
          { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
          { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
        ],
        requiresApiKey: true,
        supportsCustomModel: true,
      },
      {
        id: "openai",
        label: "OpenAI · 개인 키",
        models: [
          { id: "gpt-5-mini", label: "GPT-5 mini" },
          { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
          { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
        ],
        requiresApiKey: true,
        supportsCustomModel: true,
      },
    ],
  };
}

async function selectedModel(
  headers: Headers,
  serverModels: ConfiguredModel[],
  userId: string | undefined,
  credentials: ModelCredentialRepository,
) {
  const requestedProvider = headers.get(MODEL_PROVIDER_HEADER)?.trim();
  if (!requestedProvider) return serverModels[0];
  if (
    requestedProvider !== "bedrock" &&
    requestedProvider !== "gemini" &&
    requestedProvider !== "mlx" &&
    requestedProvider !== "ollama" &&
    requestedProvider !== "openai"
  )
    throw new ModelSelectionError("Unknown model provider");

  if (requestedProvider === "gemini") {
    if (!userId) throw new ModelSelectionError("Authentication is required");
    const saved = await credentials.get(userId, "gemini");
    if (!saved)
      throw new ModelSelectionError("A saved Gemini API key is required");
    const modelId = validatedModelId(
      headers.get(MODEL_ID_HEADER),
      saved.modelId,
    );
    if (modelId !== saved.modelId)
      throw new ModelSelectionError("Save the Gemini model before using it");
    return {
      model: createGeminiModelProvider({
        apiKey: saved.apiKey,
        model: modelId,
      }),
      modelId,
      provider: requestedProvider,
    } satisfies ConfiguredModel;
  }

  if (requestedProvider === "openai" && userId) {
    const saved = await credentials.get(userId, "openai");
    if (saved) {
      const modelId = validatedModelId(
        headers.get(MODEL_ID_HEADER),
        saved.modelId,
      );
      if (modelId !== saved.modelId)
        throw new ModelSelectionError("Save the OpenAI model before using it");
      return {
        model: createOpenAIModelProvider({
          apiKey: saved.apiKey,
          model: modelId,
        }),
        modelId,
        provider: requestedProvider,
      } satisfies ConfiguredModel;
    }
  }

  if (requestedProvider === "openai") {
    const configured = serverModels.find(
      (candidate) => candidate.provider === requestedProvider,
    );
    if (!configured)
      throw new ModelSelectionError("A saved OpenAI API key is required");
    const modelId = validatedModelId(
      headers.get(MODEL_ID_HEADER),
      configured.modelId,
    );
    if (modelId !== configured.modelId)
      throw new ModelSelectionError(
        "A saved API key is required to change the OpenAI model",
      );
    return {
      model: configured.model,
      modelId,
      provider: requestedProvider,
    } satisfies ConfiguredModel;
  }

  const configured = serverModels.find(
    (candidate) => candidate.provider === requestedProvider,
  );
  if (!configured)
    throw new ModelSelectionError("The selected model provider is unavailable");
  if (requestedProvider === "bedrock" || requestedProvider === "mlx")
    return configured;
  const modelId = validatedModelId(
    headers.get(MODEL_ID_HEADER),
    configured.modelId,
  );
  if (requestedProvider === "ollama")
    return {
      model: createOllamaModelProvider({
        baseUrl: serverEnv.OLLAMA_BASE_URL,
        model: modelId,
      }),
      modelId,
      provider: requestedProvider,
    } satisfies ConfiguredModel;
  if (modelId !== configured.modelId)
    throw new ModelSelectionError(
      "A personal API key is required to change the OpenAI model",
    );
  return configured;
}

function embeddingProvider(): EmbeddingProviderPort | undefined {
  if (serverEnv.OPENAI_API_KEY)
    return createOpenAIEmbeddingProvider({
      apiKey: serverEnv.OPENAI_API_KEY,
      baseUrl: serverEnv.OPENAI_BASE_URL,
      model: serverEnv.OPENAI_EMBEDDING_MODEL,
    });
  if (serverEnv.OLLAMA_BASE_URL)
    return createOllamaEmbeddingProvider({
      baseUrl: serverEnv.OLLAMA_BASE_URL,
      model: serverEnv.OLLAMA_EMBEDDING_MODEL,
    });
  return undefined;
}

export async function resolveModelProviders(
  headers: Headers,
  userId: string | undefined,
  credentials: ModelCredentialRepository,
) {
  const serverModels = configuredServerModels();
  const selected = await selectedModel(
    headers,
    serverModels,
    userId,
    credentials,
  );
  return {
    catalog: modelCatalog(serverModels),
    embedding: embeddingProvider(),
    model: selected?.model,
    modelId: selected ? `${selected.provider}:${selected.modelId}` : undefined,
  };
}

export const modelSelectionHeaders = {
  model: MODEL_ID_HEADER,
  provider: MODEL_PROVIDER_HEADER,
} as const;
