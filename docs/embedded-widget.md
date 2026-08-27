# Embedded chat widget

`/embed` is a compact iframe entry point that reuses the authenticated chat
and workspace history. It is disabled unless the browser parent origin is an
exact member of `NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS` (comma-separated origins).
The API still enforces the normal bearer session, workspace membership, rate
limits, and CORS checks; the client-side gate is not an authorization control.

Example:

```text
NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS=https://portal.example.com
API_CORS_ORIGINS=https://portal.example.com,https://app.example.com
```

Embed with `<iframe src="https://agent.example.com/embed" ...>`. The widget
owns the same Google/OIDC login flow as the standalone site. Browsers may block
third-party identity storage, so a derived application should provide a
top-level popup callback or host the widget and API on compatible sites before
enabling production traffic. Never send access tokens through an unvalidated
`postMessage`; if a host callback is added, require an exact `targetOrigin`, a
short-lived one-time code, state/nonce validation, and audit logging.

See [Japanese](embedded-widget.ja.md) and [Korean](embedded-widget.ko.md).
