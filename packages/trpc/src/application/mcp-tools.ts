import type {
  McpRequestContext,
  McpToolDefinition,
} from "@arlequins/agent-core";
import type { LiveCapabilityId, LiveCapabilityPort } from "./live-capabilities";

type WorkspaceActor = { userId: string; workspaceId: string };

type LiveCapabilityMcpDependencies = {
  assertMember: (actor: WorkspaceActor) => Promise<void>;
  liveCapabilities: LiveCapabilityPort;
  recordAccess?: (
    actor: WorkspaceActor,
    input: { available: boolean; capability: LiveCapabilityId },
  ) => Promise<void>;
};

type WorkspaceInput = { workspaceId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function workspaceInput(value: unknown): WorkspaceInput {
  if (
    !isRecord(value) ||
    typeof value.workspaceId !== "string" ||
    value.workspaceId.length < 1 ||
    value.workspaceId.length > 128
  )
    throw new Error("workspaceId is required");
  return { workspaceId: value.workspaceId };
}

function boundedLimit(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("limit must be a number");
  return Math.max(1, Math.min(20, Math.floor(value)));
}

function actorFor(context: McpRequestContext, workspaceId: string) {
  if (!context.subject || context.subject.length > 256)
    throw new Error("Authenticated subject is required");
  return { userId: context.subject, workspaceId };
}

function available(
  dependencies: LiveCapabilityMcpDependencies,
  capability: LiveCapabilityId,
) {
  return Boolean(
    dependencies.liveCapabilities
      .catalog()
      .find((entry) => entry.id === capability)?.available,
  );
}

async function authorizeWorkspace(
  dependencies: LiveCapabilityMcpDependencies,
  context: McpRequestContext,
  input: unknown,
) {
  try {
    const { workspaceId } = workspaceInput(input);
    await dependencies.assertMember(actorFor(context, workspaceId));
    return true;
  } catch {
    return false;
  }
}

/**
 * Maps the app's read-only live capabilities to MCP tools. The adapter keeps
 * workspace membership and audit logging at the application boundary so a
 * remote MCP caller cannot bypass the same checks as tRPC.
 */
export function createLiveCapabilityMcpTools(
  dependencies: LiveCapabilityMcpDependencies,
): McpToolDefinition[] {
  const noticeTool: McpToolDefinition = {
    authorize: (context, input) =>
      authorizeWorkspace(dependencies, context, input),
    description: "List recent notices visible to the authenticated workspace.",
    execute: async (context, input) => {
      const { workspaceId } = workspaceInput(input);
      const actor = actorFor(context, workspaceId);
      await dependencies.assertMember(actor);
      const isAvailable = available(dependencies, "notices.listRecent");
      await dependencies.recordAccess?.(actor, {
        available: isAvailable,
        capability: "notices.listRecent",
      });
      if (!isAvailable)
        return {
          available: false,
          capability: "notices.listRecent",
          rows: [],
        };
      const rows = await dependencies.liveCapabilities.listRecentNotices(
        actor,
        { limit: boundedLimit(isRecord(input) ? input.limit : undefined, 10) },
      );
      return {
        available: true,
        capability: "notices.listRecent",
        observedAt: new Date().toISOString(),
        rows,
      };
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        limit: { maximum: 20, minimum: 1, type: "number" },
        workspaceId: { maxLength: 128, minLength: 1, type: "string" },
      },
      required: ["workspaceId"],
      type: "object",
    },
    name: "notices.listRecent",
  };

  const vehicleTool: McpToolDefinition = {
    authorize: (context, input) =>
      authorizeWorkspace(dependencies, context, input),
    description:
      "List sold vehicles in a bounded date range visible to the authenticated workspace.",
    execute: async (context, input) => {
      const record = isRecord(input) ? input : {};
      const { workspaceId } = workspaceInput(input);
      const actor = actorFor(context, workspaceId);
      await dependencies.assertMember(actor);
      const isAvailable = available(dependencies, "vehicles.listSold");
      await dependencies.recordAccess?.(actor, {
        available: isAvailable,
        capability: "vehicles.listSold",
      });
      if (!isAvailable)
        return {
          available: false,
          capability: "vehicles.listSold",
          rows: [],
        };
      const to = record.to ? new Date(String(record.to)) : new Date();
      const from = record.from
        ? new Date(String(record.from))
        : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1_000);
      if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()))
        throw new Error("from and to must be valid dates");
      if (from > to) throw new Error("from must be before to");
      const rows = await dependencies.liveCapabilities.listSoldVehicles(actor, {
        from: from.toISOString(),
        limit: boundedLimit(record.limit, 20),
        to: to.toISOString(),
      });
      return {
        available: true,
        capability: "vehicles.listSold",
        observedAt: new Date().toISOString(),
        rows,
      };
    },
    inputSchema: {
      additionalProperties: false,
      properties: {
        from: { format: "date-time", type: "string" },
        limit: { maximum: 20, minimum: 1, type: "number" },
        to: { format: "date-time", type: "string" },
        workspaceId: { maxLength: 128, minLength: 1, type: "string" },
      },
      required: ["workspaceId"],
      type: "object",
    },
    name: "vehicles.listSold",
  };

  return [noticeTool, vehicleTool];
}
