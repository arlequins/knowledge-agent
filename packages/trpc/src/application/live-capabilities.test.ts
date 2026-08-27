import { describe, expect, it } from "vitest";
import {
  classifyLiveQuestion,
  createConfiguredLiveCapabilities,
  liveEvidenceForQuestion,
} from "./live-capabilities";

const actor = { userId: "user-1", workspaceId: "workspace-1" };

describe("live capabilities", () => {
  it("classifies only explicit business-data questions", () => {
    expect(classifyLiveQuestion("새 공지사항 알려줘")).toBe(
      "notices.listRecent",
    );
    expect(classifyLiveQuestion("일주일 이내 판매된 차량 목록")).toBe(
      "vehicles.listSold",
    );
    expect(classifyLiveQuestion("React 훅스란?")).toBeUndefined();
  });

  it("bounds and redacts configured records", async () => {
    const port = createConfiguredLiveCapabilities(
      JSON.stringify({
        notices: [
          {
            id: "notice-1",
            publishedAt: "2026-08-27T00:00:00.000Z",
            summary: "서비스 점검",
            title: "점검 공지",
            url: "https://example.com/notice-1",
          },
        ],
        soldVehicles: [
          {
            id: "vehicle-1",
            soldAt: "2026-08-26T00:00:00.000Z",
            make: "OpenAI Motors",
            model: "Pilot",
            price: 12345678.4,
            year: 2024,
            ownerEmail: "private@example.com",
          },
        ],
      }),
    );
    expect(port.catalog().every((item) => item.available)).toBe(true);
    const result = await liveEvidenceForQuestion(
      port,
      actor,
      "일주일 이내 판매된 차량 목록을 보여줘",
    );
    expect(result.available).toBe(true);
    expect(result.evidence[0]).toContain("OpenAI Motors Pilot");
    expect(result.evidence[0]).not.toContain("private@example.com");
  });

  it("returns an explicit unknown when a live capability is unavailable", async () => {
    const result = await liveEvidenceForQuestion(
      createConfiguredLiveCapabilities(),
      actor,
      "새 공지사항 알려줘",
    );
    expect(result.available).toBe(false);
    expect(result.evidence[0]).toContain("구성되지 않았습니다");
  });
});
