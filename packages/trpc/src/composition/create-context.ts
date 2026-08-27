import { createTextDocumentExtraction } from "@arlequins/agent-core";
import { authApi } from "@arlequins/auth";
import { db } from "@arlequins/db-backbone/client";
import { serverEnv } from "@arlequins/env";
import { createAgentPlatformRepository } from "../adaptors/agent-platform";
import {
  createDatabaseKnowledgeSearch,
  createDatabaseMemorySearch,
} from "../adaptors/agent-retrieval";
import { createModelCredentialRepository } from "../adaptors/model-credential";
import { deriveTemplateSession } from "../adaptors/oidc-identity";
import { createConfiguredLiveCapabilities } from "../application/live-capabilities";
import type { CreateTRPCContextOptions, TRPCContext } from "../context";
import { resolveModelProviders } from "./model-providers";

function bootstrapAdministratorIdentities() {
  return new Set(
    (serverEnv.AUTH_BOOTSTRAP_ADMIN_IDENTITIES ?? "")
      .split(",")
      .map((identity) => identity.trim())
      .filter(Boolean),
  );
}

const agent = createAgentPlatformRepository(db);
const modelCredentials = createModelCredentialRepository(
  db,
  serverEnv.MODEL_CREDENTIAL_ENCRYPTION_KEY,
);
const liveCapabilities = createConfiguredLiveCapabilities(
  serverEnv.LIVE_CAPABILITIES_JSON,
);

export async function createTRPCContext(
  options: CreateTRPCContextOptions,
): Promise<TRPCContext> {
  const tokenSession = await authApi.getSession({ headers: options.headers });
  const session = tokenSession
    ? deriveTemplateSession(tokenSession, bootstrapAdministratorIdentities())
    : null;
  const providers = await resolveModelProviders(
    options.headers,
    session?.user.id,
    modelCredentials,
  );

  if (session)
    options.logger.info("auth.login.succeeded", {
      issuer: session.user.issuer,
      subject: session.user.subject,
      userId: session.user.id,
    });

  return {
    authApi,
    logger: options.logger,
    telemetry: options.telemetry,
    session,
    services: {
      agent,
      documentExtraction: createTextDocumentExtraction(),
      embedding: providers.embedding,
      knowledgeSearch: createDatabaseKnowledgeSearch(db, {
        embedding: providers.embedding,
      }),
      memorySearch: createDatabaseMemorySearch(db),
      model: providers.model,
      modelId: providers.modelId,
      modelCatalog: providers.catalog,
      modelCredentials,
      liveCapabilities,
    },
  };
}
