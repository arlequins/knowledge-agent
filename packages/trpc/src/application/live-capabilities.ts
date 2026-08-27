import type { WorkspaceActor } from "../adaptors/agent-platform";

export type LiveCapabilityId = "notices.listRecent" | "vehicles.listSold";

export type LiveNotice = {
  id: string;
  publishedAt: string;
  title: string;
  summary: string;
  url?: string;
};

export type SoldVehicle = {
  id: string;
  soldAt: string;
  make: string;
  model: string;
  year: number;
  price: number;
};

export type LiveCapabilityPort = {
  catalog(): Array<{
    id: LiveCapabilityId;
    available: boolean;
    description: string;
  }>;
  listRecentNotices(
    actor: WorkspaceActor,
    input: { limit: number },
  ): Promise<LiveNotice[]>;
  listSoldVehicles(
    actor: WorkspaceActor,
    input: { from: string; to: string; limit: number },
  ): Promise<SoldVehicle[]>;
};

type Config = { notices?: LiveNotice[]; soldVehicles?: SoldVehicle[] };

const CAPABILITIES: Array<{ id: LiveCapabilityId; description: string }> = [
  { id: "notices.listRecent", description: "최근 공지사항을 조회합니다." },
  { id: "vehicles.listSold", description: "기간 내 판매 차량을 조회합니다." },
];

function boundedLimit(limit: number) {
  return Math.max(1, Math.min(20, Math.floor(limit)));
}

function safeNotice(value: LiveNotice): LiveNotice {
  return {
    id: value.id.slice(0, 128),
    publishedAt: new Date(value.publishedAt).toISOString(),
    summary: value.summary.slice(0, 1_000),
    title: value.title.slice(0, 256),
    ...(value.url?.startsWith("https://")
      ? { url: value.url.slice(0, 2_048) }
      : {}),
  };
}

function safeVehicle(value: SoldVehicle): SoldVehicle {
  return {
    id: value.id.slice(0, 128),
    make: value.make.slice(0, 64),
    model: value.model.slice(0, 128),
    price: Math.max(0, Math.round(value.price)),
    soldAt: new Date(value.soldAt).toISOString(),
    year: Math.max(1886, Math.min(2100, Math.round(value.year))),
  };
}

export function createConfiguredLiveCapabilities(
  raw?: string,
): LiveCapabilityPort {
  let config: Config = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Config;
      config = {
        notices: Array.isArray(parsed.notices)
          ? parsed.notices.map(safeNotice)
          : [],
        soldVehicles: Array.isArray(parsed.soldVehicles)
          ? parsed.soldVehicles.map(safeVehicle)
          : [],
      };
    } catch {
      config = {};
    }
  }
  return {
    catalog: () =>
      CAPABILITIES.map((capability) => ({
        ...capability,
        available:
          capability.id === "notices.listRecent"
            ? Boolean(config.notices?.length)
            : Boolean(config.soldVehicles?.length),
      })),
    listRecentNotices: async (_actor, input) =>
      [...(config.notices ?? [])]
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, boundedLimit(input.limit)),
    listSoldVehicles: async (_actor, input) => {
      const from = Date.parse(input.from);
      const to = Date.parse(input.to);
      return [...(config.soldVehicles ?? [])]
        .filter((vehicle) => {
          const soldAt = Date.parse(vehicle.soldAt);
          return soldAt >= from && soldAt <= to;
        })
        .sort((a, b) => Date.parse(b.soldAt) - Date.parse(a.soldAt))
        .slice(0, boundedLimit(input.limit));
    },
  };
}

export function classifyLiveQuestion(
  question: string,
): LiveCapabilityId | undefined {
  const normalized = question.toLocaleLowerCase();
  if (/(공지|announcement|notice)/u.test(normalized))
    return "notices.listRecent";
  const asksForVehicle = ["차량", "자동차", "vehicle", "car"].some((term) =>
    normalized.includes(term),
  );
  const asksForSale = ["판매", "sold", "sale"].some((term) =>
    normalized.includes(term),
  );
  if (asksForVehicle && asksForSale) return "vehicles.listSold";
  return undefined;
}

export async function liveEvidenceForQuestion(
  port: LiveCapabilityPort,
  actor: WorkspaceActor,
  question: string,
) {
  const capability = classifyLiveQuestion(question);
  if (!capability)
    return { capability: undefined, evidence: [] as string[], available: true };
  if (!port.catalog().find((item) => item.id === capability)?.available)
    return {
      capability,
      available: false,
      evidence: [
        "실시간 업무 데이터 capability가 구성되지 않았습니다. 현재 데이터는 확인할 수 없습니다.",
      ],
    };
  if (capability === "notices.listRecent") {
    const rows = await port.listRecentNotices(actor, { limit: 10 });
    return {
      capability,
      available: true,
      evidence: rows.length
        ? rows.map(
            (row) =>
              `[live: notices.listRecent · observedAt=${new Date().toISOString()}]\n${row.title}\n${row.summary}${row.url ? `\nURL: ${row.url}` : ""}`,
          )
        : ["조회 결과가 없습니다."],
    };
  }
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1_000);
  const rows = await port.listSoldVehicles(actor, {
    from: from.toISOString(),
    limit: 20,
    to: to.toISOString(),
  });
  return {
    capability,
    available: true,
    evidence: rows.length
      ? rows.map(
          (row) =>
            `[live: vehicles.listSold · observedAt=${new Date().toISOString()}]\n${row.soldAt} · ${row.year} ${row.make} ${row.model} · ${row.price.toLocaleString()}원`,
        )
      : ["최근 7일 조회 결과가 없습니다."],
  };
}
