# Watchlist Weather Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 관심 선박의 예상 항로 통과 시각에 실제 파고·바람 예보를 연결하고 목록·지도·시간축에 표시한다.

**Architecture:** 기존 Python 서버가 관심 등록을 검사하고 예상 항로에서 향후 72시간 이내 최대 12개 지점을 추출한다. Open-Meteo Forecast/Marine 시간별 예보는 서버 메모리에 캐시한다. React는 화면이 열린 동안 관심 선박 전체를 순차 조회하며 선택 선박만 상세 표시한다. 기상 보정 ETA 및 자동 감속은 이번 단계에 포함하지 않는다.

**Tech Stack:** 기존 FastAPI, urllib, SQLite 관심 원장(스키마 변경 없음), React, MapLibre, Thinking Orbs. 신규 의존성 없음.

**Spec:** ../specs/2026-10-09-vessel-eta-workflow-design.md §기상·API·데이터 경계와 2026-10-09 사용자 승인: 관심 선박 대상, 해커톤 평가용.

## Global Constraints

- feature/vessels-tracking의 기존 승인 작업을 이어서 진행. 사용자 변경 보존, main 변경·커밋·push 없음.
- 실제 예보와 합성 표본 분리. 누락을 0이나 안전으로 해석하지 않는다.
- 기본 ETA·화물·접안·하역·재고 원장 변경 없음. 신뢰 구간이나 감속률을 임의 생성하지 않는다.
- 무료 API는 비상업 해커톤 시연. 사용자가 확인했다. 회사 운영 전 이용 조건 재검토.
- 지도 스타일·카메라 유지, 라이트/다크·모바일 지원, 전역 CSS 변경 없음.
- DB 추가 없음. 시간은 내부 UTC epoch, 화면 KST. 공급자 발표시각 미제공이면 null.

## Review Focus

1. 관심 해제·목적항 변경·늦게 도착한 응답: 이전 선박이나 목적항 예보를 표시하지 않는다.
2. 오래된 AIS·정박·경로망 오차: 통과 시각 예보를 임의 생성하지 않는다.
3. 부분 API 실패·예보 끝·null: 누락과 이전 캐시 사용을 명시한다.
4. 좌표 격자·날짜변경선·단위·풍향: 위치·시각과 m/kn/도 단위를 검증한다.
5. 다수 관심 선박·반복 갱신: 공급자 요청 예산, 캐시, 순차 큐와 취소로 호출 폭증을 제한한다.

### Task 1 — 서버 예보와 통과 시각 매칭

Files: create backend/src/midterm/vessels/weather.py, backend/tests/test_vessel_weather.py; modify backend/src/midterm/web/vessels_api.py.

Interfaces: GET /api/vessels/weather/{owner}/{source}/{mmsi}?destination=... → source,mmsi,destinationId,status,reason,fetchedAt,observedAt,horizonHours,points. points contain longitude,latitude,passageAt,forecastAt,waveM,windKn,gustKn,windFromDeg,waveFromDeg,wavePeriodS and per-provider freshness.

- [x] Tests first: observation-anchored passage times, 72h horizon, date line, invalid/stale AIS, missing hours, null preservation, cache reuse/failure, membership denied before network.
- [x] Implement route sampling (max12 points), confirmed destination, SOG/position guards, per-provider grid cache (0.25°, 3h TTL, max1024 entries), stale fallback <=6h explicitly marked.
- [x] Bound network reads/timeouts; provider-wide 60s error cooldown; account local weighted coordinate budget 300/min, 2000/hour, 9000/day, 250000/30days. Limits are POC policy, not a paid guarantee; restart resets counters.
- [x] Add GET endpoint behind existing owner membership lookup; no MMSI/name sent to weather provider, only grid coordinates.
- [x] Run backend/.venv/Scripts/python.exe -m pytest tests/test_vessel_weather.py tests/test_vessel_ais.py tests/test_vessel_navigation.py.

### Task 2 — 관심 목록 조회와 상세 UI

Files: create src/features/vessels/vessel-weather.ts, useVesselWeather.ts, VesselForecastPanel.tsx; modify useVesselNavigation.ts (expose confirmed destinations), VesselWorkspace.tsx, vessel-workflow.css and map marker renderers only as necessary.

Interfaces: useVesselWeather(catalog, interests, destinations, owner, ready, voyageStates) → get(vessel), busy, refresh. GET requests sequential; refresh pass every5min; removed/changed keys abort and hide obsolete responses. Source+MMSI+destination identify data.

- [x] Add browser fixture proving non-selected interests fetched, no catalog-wide fetch, destination switches/removal and failures.
- [x] Show list weather state; selected panel with map toggle, per-passage timeline, values and provider credits, fetched time and missing state. Route points are samples, not a global weather field or typhoon warning.
- [x] Preserve synthetic weather UX for demo ships. Actual ships show no invented sample weather.
- [x] Thinking Orb only after250ms network wait. Current basic ETA remains explicitly weather-unadjusted.
- [x] Run npm.cmd test, npm.cmd run build, npm.cmd run test:ui and inspect actual panel in light/dark/mobile.

### Task 3 — 실제 연결·사용 안내·리뷰

Files: docs/VESSEL_API.md, src/features/vessels/README.md, THIRD_PARTY_NOTICES.md; this plan execution ledger.

- [x] Smoke-test actual providers using a public sea coordinate, report observed response/failure honestly. Never register fixture vessels with the user's collector.
- [x] Fresh read-only review and address important findings; git diff --check and staged diff inspection.
- [x] User restarted the same AIS-key PowerShell backend. Weather endpoint registration and rejection of non-member requests verified. No extra API key for noncommercial endpoint.
- [ ] User confirms each watched vessel's destination in the UI and checks its actual forecast; this requires a recent, moving AIS position.

## Execution ledger

- Ruling: implement inline on the existing feature branch — user explicitly requested planning and starting; no repeat approval or new clone needed for this continuation.
- Ruling: first release covers forecast exposure, not weather-adjusted ETA — weather-to-speed model is unvalidated and current SOG already includes environmental effects.
- Baseline: prior tests69 frontend /14 vessel backend; UI52 with one map timing test repaired and retested.
- Implemented: all eligible watched vessels are queried sequentially while the vessel page is open. The selected vessel exposes a passage timeline and map markers; no weather-adjusted ETA or new database schema.
- Validation: npm.cmd test (70 passed); npm.cmd run build (passed); npm.cmd run test:ui (54 passed). Backend weather/AIS/navigation regression suite: 22 passed. Light/dark/mobile forecast panels inspected.
- Provider smoke test: both real Open-Meteo endpoints returned 192 hourly records at public sea coordinate 125°E, 35°N; wind kn, wave m, direction degrees validated. No fixture vessels registered with the user's collector.
- Independent review addressed: expire fallback using original provider fetch times; recompute cached routes when the vessel is more than 5 nm off the route. Both regression tests failed before the fixes and passed afterward.
- git diff --check passed; staged diff empty. Existing unrelated work preserved; no commit, push or PR.
- Deployment check: user confirmed restart; running server OpenAPI contains the weather endpoint, and an unregistered owner/vessel request returned the expected 404 before upstream access. Actual user-vessel forecast delivery remains to be checked with a confirmed destination and fresh moving AIS position.

## 승인된 후속 작업 — 시연용 기상 보정 ETA

최초 예보 표시 작업 이후 사용자가 기상 보정 ETA 추가와 **시연용 모델**을 승인했다. 위 최초 작업의 범위 기록은 유지하며, 현재 기능은 다음과 같다.

- `vessel-weather-eta.ts`, `VesselWeatherEta.tsx`: 기본 ETA와 별도 보정 ETA·추가 지연·보정/미보정 시간을 비교한다. 감속 가정과 0~1.5배 민감도, 구간별 영향은 펼쳐 확인한다.
- 실제 예보에 미검증 계수를 적용한 1회 감도 분석이다. 현재 기상 부담보다 나빠지는 구간만 추가 감속하고, 누락·오래된 예보·모델 범위 밖 구간은 부분 보정으로 명시한다. 지연 후 통과 시각의 기상을 다시 조회하는 반복 모델은 아니다.
- 예보 API는 `speedKn`을 반환한다. 리뷰에서 발견한 최근 속도 변경 문제를 회귀 테스트로 재현하고 수정했다. 기준 속도와 현재 SOG가 허용 차이를 넘으면 갱신 전까지 보정을 보류한다.
- 기존 관심 목록 날짜는 기본 ETA이며 등록 항차·접안·하역·재고는 수정하지 않는다. 새 API 키·의존성·DB 스키마 변경은 없다.
- 검증: `npm.cmd test` 76개, 백엔드 전체 `python -m pytest -q` 77개, `npm.cmd run test:ui` 55개 통과. 빌드 성공, 라이트·다크·모바일 표시 확인, `git diff --check` 통과. 테스트는 계산 정확도와 UI 동작을 검증하며 실제 선박 ETA 예측 정확도 검증은 아니다.
- 사용자 재시작 완료. 8093 서버가 `weather.py` 수정 이후 시작했으며 기상 endpoint 등록을 확인했다. 실제 관심 선박의 보정값은 최신 AIS·확인한 목적항·유효한 기상 응답이 있어야 표시된다.
- 브랜치 `feature/vessels-tracking`. 커밋·push·PR 없음. 자세한 계산·사용법은 [선박 기능 안내](../../../src/features/vessels/README.md#시연용-기상-보정-eta)를 참고한다.
# 승인된 후속 작업: 지도 기상 레이어 (2026-10-10)

사용자 승인: 선박 항로에 풍속·파고·시정·태풍을 함께 표시한다. 시정·태풍 지연 시간을 자동 추가하지 않고 먼저 지도에서 영향을 확인한다. 기존 선박 브랜치에서 변경을 보존하며 이어서 수행한다.

구현 순서:
1. 기존 대기 조회에 시정(m) 추가, 미제공·단위 오류·0값 회귀 검증.
2. GDACS 실제 공개 응답 조사, 최신 advisory timeline 및 방향별 34kt 반경 정규화. 서버 공통 캐시·실패 구분 추가.
3. 선박 통과 표본과 시간·거리 후보 매칭. 날짜변경선·오래된 자료·예보 공백 테스트.
4. 온라인/오프라인 지도에 기상 항목 전환·통과 시간·태풍 예상 경로/실제 제공 반경 추가. 카메라 유지, Thinking Orbs 연결.
5. 라이트/다크·모바일 UI 테스트, 전체 프런트/백엔드 검증과 독립 코드 리뷰. 서버 재시작은 AIS 키가 있는 기존 사용자 창에서 수행.

공급자 조사로 정한 범위: GDACS 최근 재난 피드는 전 세계 태풍을 완전히 포괄하지 않는다. 임의 위험 반경이나 불확실성 cone은 생성하지 않는다. 시정은 격자 예보이며 넓은 해역 안개 면적으로 보간하지 않는다. 속도 가정·72h 표본 범위·시각 매칭 허용오차를 UI와 API 문서에 표시한다.

검증 완료 (2026-10-10):
- `npm.cmd test`: 78개 통과. `npm.cmd run build`: 통과.
- `.\.venv\Scripts\python.exe -m pytest -q` (backend 폴더): 80개 통과.
- `npm.cmd run test:ui`: 57개 통과. 첫 실행 세션 연결이 끊겨 최종 결과를 단정하지 않고 전체 재실행했으며, `.tooling-tmp/weather-layers-full-ui.log`에 성공 결과를 남겼다.
- 실제 Open-Meteo 시정 단위 m 및 192시간 표본 수신, 실제 GDACS 태풍 4개 타임라인 수신, 사용자 재시작 후 8093 서버 API ready 확인. 개인 AIS·관심 목록을 외부 태풍 API로 보내지 않았다.
- 라이트/다크/모바일과 온라인/오프라인 표시, 카메라 유지, 키보드 포커스, 예보 공백 및 날짜변경선을 검증했다. UI 스크린샷의 태풍·선박은 격리된 모의 응답이다.
- 독립 리뷰의 기상 표식 포커스 소실 P2를 실패 재현 테스트 후 수정하고 리뷰 재확인했다. `git diff --check` 통과. 커밋·push·PR 없음.
