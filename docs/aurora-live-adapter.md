# Aurora live capability adapter

The template keeps business-table SQL in the derived application. Use
`createAuroraLiveCapabilities({ queries })` to inject two Drizzle/Aurora query
functions: `listRecentNotices` and `listSoldVehicles`. Both receive the
authenticated `workspaceId` and bounded dates/limits. The adapter projects
results to the public notice/vehicle shapes, strips unsupported URLs, limits
text, normalizes dates, and never returns owner emails or other PII.

The injected queries must enforce workspace scope in SQL and run after the
normal tRPC/MCP membership check. Keep the fixture adapter for local tests;
enable the Aurora adapter only when the real schema and authorization tests are
available. Live rows should be displayed with an observed timestamp and should
not be silently mixed with static document citations.

See [Japanese](aurora-live-adapter.ja.md) and [Korean](aurora-live-adapter.ko.md).
