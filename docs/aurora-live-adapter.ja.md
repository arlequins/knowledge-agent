# Aurora リアルタイム capability アダプター

テンプレートに業務テーブルの SQL は含めません。派生アプリケーションから
`createAuroraLiveCapabilities({ queries })` に Drizzle/Aurora の
`listRecentNotices` と `listSoldVehicles` を注入します。両方に認証済みの
`workspaceId` と上限付きの日付・件数を渡します。アダプターは公開用の通知・車両
形へ投影し、URL・テキスト・日時を正規化し、所有者メールなどの個人情報を返しません。

注入する SQL は workspace 範囲を強制し、tRPC/MCP のメンバーシップ確認後に実行して
ください。ローカルテストでは fixture を使い、実スキーマと認可テストが揃ってから
Aurora を有効化します。リアルタイム行には観測時刻を表示し、静的文書の引用と
混在させません。
