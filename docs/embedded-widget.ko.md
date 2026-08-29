# 임베디드 채팅 위젯

`/embed`는 인증된 채팅과 워크스페이스 이력을 재사용하는 iframe 진입점입니다.
`NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS`에 정확히 등록된 부모 origin에서만 화면을
표시합니다. 이 검사는 화면 노출을 위한 것이며 권한 검사가 아닙니다. API는
기존 bearer 세션, 워크스페이스 멤버십, rate limit, CORS를 계속 강제합니다.

예시:

```text
NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS=https://portal.example.com
API_CORS_ORIGINS=https://portal.example.com,https://app.example.com
```

`<iframe src="https://agent.example.com/embed" ...>`로 삽입합니다. 위젯은
독립 사이트와 같은 Google/OIDC 로그인을 사용합니다. 브라우저가 서드파티
스토리지를 차단할 수 있으므로 운영 전에는 상위 창 팝업 콜백 또는 호환되는
사이트 구성을 마련해야 합니다. 검증되지 않은 `postMessage`로 access token을
보내지 마세요. 콜백이 필요하면 정확한 `targetOrigin`, 짧은 일회성 코드,
state/nonce 검증, 감사 로그를 사용합니다.
