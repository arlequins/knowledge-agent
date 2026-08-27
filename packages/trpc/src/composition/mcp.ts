import { createMcpServer } from "@arlequins/agent-core";
import { db } from "@arlequins/db-backbone/client";
import { serverEnv } from "@arlequins/env";
import { createAgentPlatformRepository } from "../adaptors/agent-platform";
import { createConfiguredLiveCapabilities } from "../application/live-capabilities";
import { createLiveCapabilityMcpTools } from "../application/mcp-tools";

/** Builds the opt-in authenticated MCP surface from the same boundaries as tRPC. */
export function createKnowledgeMcpServer() {
  const agent = createAgentPlatformRepository(db);
  const liveCapabilities = createConfiguredLiveCapabilities(
    serverEnv.LIVE_CAPABILITIES_JSON,
  );
  return createMcpServer({
    name: "knowledge-agent",
    tools: createLiveCapabilityMcpTools({
      assertMember: agent.assertMember,
      liveCapabilities,
      recordAccess: agent.recordLiveCapabilityAccess,
    }),
    version:
      process.env.npm_package_version ??
      serverEnv.OTEL_SERVICE_VERSION ??
      "unknown",
  });
}
