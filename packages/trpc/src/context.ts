import type {
  DocumentExtractionPort,
  EmbeddingProviderPort,
  KnowledgeSearchPort,
  MemorySearchPort,
  ModelProviderPort,
} from "@arlequins/agent-core";
import type { AuthSession, TRPCAuth } from "@arlequins/auth";
import type { Logger, Telemetry } from "@arlequins/logger";
import type { createAgentPlatformRepository } from "./adaptors/agent-platform";
import type { ModelCredentialRepository } from "./adaptors/model-credential";
import type { LiveCapabilityPort } from "./application/live-capabilities";
import type { ModelCatalog } from "./composition/model-providers";

export type TRPCServices = {
  agent: ReturnType<typeof createAgentPlatformRepository>;
  model?: ModelProviderPort;
  modelId?: string;
  modelCatalog: ModelCatalog;
  modelCredentials: ModelCredentialRepository;
  embedding?: EmbeddingProviderPort;
  documentExtraction: DocumentExtractionPort;
  knowledgeSearch: KnowledgeSearchPort;
  memorySearch: MemorySearchPort;
  liveCapabilities: LiveCapabilityPort;
};

export type TRPCContext = {
  authApi: TRPCAuth;
  logger: Logger;
  telemetry: Telemetry;
  session: AuthSession | null;
  services: TRPCServices;
};

export type CreateTRPCContextOptions = {
  headers: Headers;
  logger: Logger;
  telemetry: Telemetry;
};
