import {
  boundedLiveLimit,
  type LiveCapabilityPort,
  type LiveNotice,
  type SoldVehicle,
  sanitizeLiveNotice,
  sanitizeSoldVehicle,
} from "../application/live-capabilities";
import type { WorkspaceActor } from "./agent-platform";

function defined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/**
 * Query functions supplied by the derived application that owns the Aurora
 * schema. Keeping Drizzle queries out of the template prevents accidental
 * coupling to private business tables while preserving a typed, safe seam.
 */
export type AuroraLiveQueries = {
  listRecentNotices(input: {
    limit: number;
    workspaceId: string;
  }): Promise<LiveNotice[]>;
  listSoldVehicles(input: {
    from: string;
    limit: number;
    to: string;
    workspaceId: string;
  }): Promise<SoldVehicle[]>;
};

export type AuroraLiveCapabilitiesOptions = {
  isAvailable?: () => boolean;
  queries: AuroraLiveQueries;
};

/**
 * Adapts tenant-scoped Aurora/Drizzle queries to the live capability port.
 * Every query receives the authenticated workspace id and the output is
 * projected to the public, PII-free capability shapes before it reaches chat.
 */
export function createAuroraLiveCapabilities(
  options: AuroraLiveCapabilitiesOptions,
): LiveCapabilityPort {
  const available = () => options.isAvailable?.() ?? true;
  return {
    catalog: () => [
      {
        available: available(),
        description: "최근 공지사항을 조회합니다.",
        id: "notices.listRecent",
      },
      {
        available: available(),
        description: "기간 내 판매 차량을 조회합니다.",
        id: "vehicles.listSold",
      },
    ],
    listRecentNotices: async (actor: WorkspaceActor, input) => {
      const rows = await options.queries.listRecentNotices({
        limit: boundedLiveLimit(input.limit),
        workspaceId: actor.workspaceId,
      });
      return rows
        .map(sanitizeLiveNotice)
        .filter(defined)
        .slice(0, boundedLiveLimit(input.limit));
    },
    listSoldVehicles: async (actor: WorkspaceActor, input) => {
      const rows = await options.queries.listSoldVehicles({
        from: input.from,
        limit: boundedLiveLimit(input.limit),
        to: input.to,
        workspaceId: actor.workspaceId,
      });
      return rows
        .map(sanitizeSoldVehicle)
        .filter(defined)
        .slice(0, boundedLiveLimit(input.limit));
    },
  };
}
