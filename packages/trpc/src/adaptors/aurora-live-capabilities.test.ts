import { describe, expect, it, vi } from "vitest";

import { createAuroraLiveCapabilities } from "./aurora-live-capabilities";

describe("createAuroraLiveCapabilities", () => {
  it("passes the workspace boundary to every query and projects safe fields", async () => {
    const listRecentNotices = vi.fn(async () => [
      {
        id: "notice-1",
        publishedAt: "2026-08-27T00:00:00.000Z",
        summary: "Maintenance",
        title: "Service notice",
        url: "http://private.example/notice",
      },
    ]);
    const listSoldVehicles = vi.fn(async () => [
      {
        id: "vehicle-1",
        make: "Maker",
        model: "Model",
        price: 1_234.7,
        soldAt: "2026-08-26T00:00:00.000Z",
        year: 2024,
      },
    ]);
    const port = createAuroraLiveCapabilities({
      queries: { listRecentNotices, listSoldVehicles },
    });
    const actor = { userId: "user-1", workspaceId: "tenant-a" };
    const notices = await port.listRecentNotices(actor, { limit: 25 });
    expect(notices).toEqual([expect.objectContaining({ id: "notice-1" })]);
    expect("url" in (notices[0] ?? {})).toBe(false);
    await expect(
      port.listSoldVehicles(actor, {
        from: "2026-08-20T00:00:00.000Z",
        limit: 25,
        to: "2026-08-27T00:00:00.000Z",
      }),
    ).resolves.toEqual([expect.objectContaining({ price: 1235 })]);
    expect(listRecentNotices).toHaveBeenCalledWith({
      limit: 20,
      workspaceId: "tenant-a",
    });
    expect(listSoldVehicles).toHaveBeenCalledWith({
      from: "2026-08-20T00:00:00.000Z",
      limit: 20,
      to: "2026-08-27T00:00:00.000Z",
      workspaceId: "tenant-a",
    });
  });

  it("can fail closed while Aurora is unavailable", () => {
    const port = createAuroraLiveCapabilities({
      isAvailable: () => false,
      queries: {
        listRecentNotices: async () => [],
        listSoldVehicles: async () => [],
      },
    });
    expect(port.catalog().every((entry) => !entry.available)).toBe(true);
  });
});
