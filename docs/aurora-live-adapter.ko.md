# Aurora 실시간 capability 어댑터

템플릿에는 업무 테이블의 SQL을 넣지 않습니다. 파생 애플리케이션에서
`createAuroraLiveCapabilities({ queries })`로 `listRecentNotices`와
`listSoldVehicles` 두 Drizzle/Aurora 쿼리를 주입합니다. 두 함수 모두 인증된
`workspaceId`와 제한된 날짜·개수 값을 받습니다. 어댑터는 공개용 공지/차량 형태로
투영하고 URL·텍스트·날짜를 정규화하며 소유자 이메일 같은 개인정보를 반환하지
않습니다.

주입 쿼리는 SQL에서 workspace 범위를 강제하고 tRPC/MCP 멤버십 확인 뒤에 실행해야
합니다. 로컬 테스트에는 fixture 어댑터를 사용하고, 실제 스키마와 권한 테스트가
준비된 후에만 Aurora 어댑터를 활성화하세요. 실시간 행에는 관측 시각을 표시하고
정적 문서 인용과 섞어 표시하지 않습니다.
