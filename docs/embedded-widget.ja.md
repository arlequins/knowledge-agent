# 埋め込みチャットウィジェット

`/embed` は認証済みチャットとワークスペース履歴を再利用する iframe の入口です。
親 origin が `NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS`（カンマ区切りの完全一致）に
登録されている場合だけ表示します。これは表示ゲートであり認可ではありません。
API は従来どおり bearer セッション、ワークスペース所属、レート制限、CORS を
強制します。

例:

```text
NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS=https://portal.example.com
API_CORS_ORIGINS=https://portal.example.com,https://app.example.com
```

`<iframe src="https://agent.example.com/embed" ...>` で埋め込みます。ウィジェットは
スタンドアロンサイトと同じ Google/OIDC ログインを使います。ブラウザによっては
サードパーティストレージが制限されるため、本番ではトップレベルのポップアップ
コールバック、または互換性のあるホスト構成を用意してください。未検証の
`postMessage` で access token を渡さず、厳密な `targetOrigin`、短命の一回限りコード、
state/nonce 検証、監査ログを必須にします。
