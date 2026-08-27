import { describe, expect, it, vi } from "vitest";

import { createConfiguredLiveCapabilities } from "./live-capabilities";
import { createLiveCapabilityMcpTools } from "./mcp-tools";

const context = {
  headers: new Headers({ authorization: "Bearer test" }),
  roles: ["member"],
  subject: "user-1",
};

describe("createLiveCapabilityMcpTools", () => {
  it("requires workspace membership before returning live rows", async () => {
    const assertMember = vi.fn(async () => {});
    const [tool] = createLiveCapabilityMcpTools({
      assertMember,
      liveCapabilities: createConfiguredLiveCapabilities(
        JSON.stringify({
          notices: [
            {
              id: "notice-1",
              publishedAt: "2026-08-27T00:00:00.000Z",
              summary: "Maintenance",
              title: "Maintenance notice",
            },
          ],
        }),
      ),
    });

    await expect(
      tool?.authorize?.(context, { workspaceId: "workspace-1" }),
    ).resolves.toBe(true);
    const result = await tool?.execute(context, {
      limit: 50,
      workspaceId: "workspace-1",
    });
    expect(result).toMatchObject({
      available: true,
      capability: "notices.listRecent",
      rows: [{ id: "notice-1" }],
    });
    expect(assertMember).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
  });

  it("does not expose rows when authorization fails", async () => {
    const liveCapabilities = createConfiguredLiveCapabilities(
      JSON.stringify({
        soldVehicles: [
          {
            id: "vehicle-1",
            make: "Example",
            model: "One",
            price: 1,
            soldAt: "2026-08-26T00:00:00.000Z",
            year: 2024,
          },
        ],
      }),
    );
    const [, tool] = createLiveCapabilityMcpTools({
      assertMember: async () => {
        throw new Error("not a member");
      },
      liveCapabilities,
    });

    await expect(
      tool?.authorize?.(context, { workspaceId: "workspace-1" }),
    ).resolves.toBe(false);
  });

  it("records availability without returning private fields", async () => {
    const recordAccess = vi.fn(async () => {});
    const [tool] = createLiveCapabilityMcpTools({
      assertMember: async () => {},
      liveCapabilities: createConfiguredLiveCapabilities(),
      recordAccess,
    });
    const result = await tool?.execute(context, { workspaceId: "workspace-1" });
    expect(result).toMatchObject({
      available: false,
      capability: "notices.listRecent",
      rows: [],
    });
    expect(recordAccess).toHaveBeenCalledWith(
      { userId: "user-1", workspaceId: "workspace-1" },
      { available: false, capability: "notices.listRecent" },
    );
  });

  it("rejects malformed workspace and limit inputs", async () => {
    const [noticeTool] = createLiveCapabilityMcpTools({
      assertMember: async () => {},
      liveCapabilities: createConfiguredLiveCapabilities(
        JSON.stringify({
          notices: [
            {
              id: "notice-1",
              publishedAt: "2026-08-27T00:00:00.000Z",
              summary: "Maintenance",
              title: "Maintenance notice",
            },
          ],
        }),
      ),
    });
    await expect(
      noticeTool?.authorize?.(context, { workspaceId: "" }),
    ).resolves.toBe(false);
    await expect(
      noticeTool?.execute(context, {
        limit: "many",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("limit must be a number");
  });

  it("bounds vehicle date ranges and rejects reversed dates", async () => {
    const [_, vehicleTool] = createLiveCapabilityMcpTools({
      assertMember: async () => {},
      liveCapabilities: createConfiguredLiveCapabilities(
        JSON.stringify({
          soldVehicles: [
            {
              id: "vehicle-1",
              make: "Example",
              model: "One",
              price: 1,
              soldAt: "2026-08-26T00:00:00.000Z",
              year: 2024,
            },
          ],
        }),
      ),
    });
    const result = await vehicleTool?.execute(context, {
      from: "2026-08-25T00:00:00.000Z",
      limit: 50,
      to: "2026-08-27T00:00:00.000Z",
      workspaceId: "workspace-1",
    });
    expect(result).toMatchObject({
      available: true,
      capability: "vehicles.listSold",
      rows: [{ id: "vehicle-1" }],
    });
    await expect(
      vehicleTool?.execute(context, {
        from: "2026-08-27T00:00:00.000Z",
        to: "2026-08-25T00:00:00.000Z",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("from must be before to");
    await expect(
      vehicleTool?.execute(context, {
        from: "not-a-date",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("from and to must be valid dates");
  });
});
