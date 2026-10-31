# Open Waters Implementation Plan

> Execute inline with superpowers:executing-plans; verify with test-driven-development. No commit/push/deploy without requested scope.

**Goal:** 당진·평택 보조 스트림을 기존 AIS 목록·지도·관심 항적에 통합한다.
**Architecture:** 독립 OpenWatersReceiver → 검증된 AIS payload → AisCatalog의 MMSI 병합 → 기존 SQLite/TrackStore.
**Tech Stack:** Python asyncio/websockets, SQLite, TypeScript/React. 새 의존성 없음.
**Spec:** ../specs/2026-10-31-openwaters-design.md

## Constraints and review focus
12만 척 한도, 기존 계정/ID, ZGX 프록시 유지. 원본 시각 및 출처 보존. 익명 한도 내 구독. 실패 격리, 재시작, 정적/위치 시각 분리, 원본 없는 캐시 재구성 거부 및 출처가 있는 JSON 재인코딩 수용, 비밀키 비노출을 검증한다.

## Tasks
- [x] 수신기 회귀 테스트 작성·실패 확인: 새 위치/역순/정적/synthesized/미래/범위 및 설정.
- [x] backend/src/midterm/vessels/openwaters.py: OpenWatersReceiver(ingest), start/stop/handle; 재연결과 제한 범위.
- [x] ais.py: 수명주기 통합, 위치 출처, 공급원 상태. 기존 persistence/map/tracks 경로 재사용.
- [x] 출처 보존 프런트 계약 및 기존 UI 명칭·링크. 기존 데이터 호환 테스트.
- [x] Python 회귀, npm test/build/test:ui, 격리 실수신·DB·map 확인.
- [x] 운영 활성화 안내·작업 결과/제한 기록. ZGX 파일과 DB는 별도 배포 단계까지 보존.

## Verification (2026-10-31)
- Final Python backend and deployment recovery regression before PR: 154 passed.
- npm test: 143 passed; npm run build: passed.
- Final full UI run before PR: 85 passed (5.1m); light/dark, narrow layouts, map and discovery regressions included.
- Isolated live stream: 108 ships saved and mapped in 25 seconds (AISHub upstream); production DB untouched.
- ZGX deployment bundle verify: 41 passed; existing production hashes matched.
- Independent review completed; two rollback robustness findings fixed and tested.
- Operator applied the verified bundle on ZGX on 2026-10-31. Backend/frontend active; read-only production check found 107 Open Waters positions and a progressing catalog receive timestamp. Databases, credentials and gzip preserved.
- Rollback backup: openwaters-20261031-124628-418842. GitHub delivery is tracked by the feature/vessels-openwaters PR.
