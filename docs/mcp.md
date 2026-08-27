# Remote MCP / 원격 MCP / リモート MCP

## English

The API exposes an OAuth-protected, JSON-RPC MCP endpoint at `POST /mcp`.
It is disabled by default. Enable it only after configuring the API's OIDC
issuer/audience and reviewing the live-data adapter:

```dotenv
MCP_ENABLED=true
```

Every request must carry the same bearer access token used by tRPC. The API
resolves the authenticated subject before dispatching a tool. Each tool then
checks workspace membership again, bounds the result to 20 rows, returns only
the allowlisted fields, and writes a capability-access audit record. No SQL is
accepted from MCP callers and private fields such as owner email are never
returned.

The initial tools are:

- `notices.listRecent` — recent workspace notices (`workspaceId`, optional
  `limit` 1–20).
- `vehicles.listSold` — sold vehicles (`workspaceId`, optional ISO `from`/`to`
  and `limit` 1–20; defaults to the last seven days).

Clients should call `initialize`, `tools/list`, then `tools/call`. The endpoint
returns `202` for the `notifications/initialized` notification. Tool failures
are intentionally returned as generic JSON-RPC errors so database details do
not cross the boundary.

## 한국어

API는 `POST /mcp`에 OAuth bearer 토큰으로 보호된 JSON-RPC MCP 엔드포인트를
제공합니다. 기본값은 비활성화이며, OIDC issuer/audience와 실시간 데이터
어댑터를 검토한 뒤 `.env.localhost` 또는 보호된 배포 환경에서만
`MCP_ENABLED=true`로 켜야 합니다.

호출자는 tRPC와 동일한 bearer 토큰을 보내야 합니다. API가 로그인 주체를
확인한 뒤 도구마다 워크스페이스 멤버십을 다시 확인하고, 결과를 최대 20건으로
제한하며, 허용된 필드만 반환하고, 조회 감사 로그를 남깁니다. MCP에서 SQL을
직접 전달할 수 없고 소유자 이메일 같은 개인정보도 반환하지 않습니다.

현재 도구는 `notices.listRecent`와 `vehicles.listSold`입니다. 먼저
`initialize`와 `tools/list`를 호출한 후 `tools/call`을 사용하세요. 데이터가
구성되지 않았으면 빈 결과와 `available: false`를 반환합니다.

## 日本語

API は `POST /mcp` に OAuth bearer トークンで保護された JSON-RPC MCP
エンドポイントを提供します。既定では無効です。OIDC の issuer/audience と
ライブデータアダプターを確認した後、保護された環境でのみ
`MCP_ENABLED=true` を設定してください。

API は認証済み subject を解決し、各ツールでワークスペース所属を再確認し、
最大20件に制限した許可済みフィールドだけを返し、アクセス監査ログを記録
します。MCP 呼び出しから SQL を受け取らず、所有者メールなどの個人情報も
返しません。`initialize`、`tools/list` の後に `tools/call` を実行します。

## Minimal request / 최소 요청 / 最小リクエスト

```bash
curl -sS http://localhost:5000/mcp \
  -H 'Authorization: Bearer <access-token>' \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"notices.listRecent","arguments":{"workspaceId":"<workspace-id>","limit":10}}}'
```

For production, replace the local JSON live-capability fixture with the
workspace-scoped Aurora/tRPC adapter while retaining this authorization and
output-policy boundary.
