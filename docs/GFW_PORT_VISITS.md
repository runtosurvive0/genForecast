# GFW 과거 기항 기록 연결

## 화면과 범위

선박 추적에서 실제/직접 등록 관심 선박을 선택하면 상세정보 아래 **기항 기록**을 조회한다.
기본 최근 30일, 선택 최근 90일이다. 선택한 선박만 조회하며 일반 AIS 검색 목록 20,000척을 일괄 요청하지 않는다.
합성 예시에는 실제 GFW 기록을 붙이지 않는다. 관심 등록만 되어 있으면 현재 위치 미수신 선박도 조회할 수 있다.

- 항만명, 국가 코드, 추정 입항·출항 시각(KST), GFW 신뢰도 2/3/4를 낮음/보통/높음으로 표시한다.
- 출항 시각 null은 **출항 미확인**이다. 현재 정박 중이라는 의미로 해석하지 않는다.
- 직전 기항지가 석탄 선적항 또는 현재 항차의 출발항이라는 보장은 없다.
- 원본 위치 좌표/과거 항적을 가져오지 않으며 항차·Cargo·ETA·입하·재고를 자동 수정하지 않는다.
- 약 72시간은 GFW 안내상 기항 자료 반영 지연이다. 서버의 조회 시각은 원천의 마지막 관측 시각 또는 완전한 자료 기준 시각이 아니다.
- 없음, 식별 충돌, 토큰 미설정, 401/403/429, 통신 오류를 구분한다. 실패 시 실제 기록 대신 합성 데이터를 넣지 않는다.

## 토큰 설정

[GFW Quick Start](https://globalfishingwatch.org/our-apis/documentation/docs/quick-start)에 따라
계정과 API Access Token을 만든다. 비상업용·출처 표시·계정 조건을 확인한다.
해커톤·평가용 시연에서 사용하며 실제 회사 운영은 별도의 이용 조건 확인이 필요하다.

키는 채팅, Git, 프런트 환경변수(`VITE_`), 브라우저 저장소에 넣지 않는다.
AIS 키가 설정된 기존 PowerShell에서 서버를 Ctrl+C로 종료하고 아래를 실행한다.
`backend` 폴더 기준이며 첫 줄 실행 후 마스킹되는 입력 프롬프트에 토큰을 붙여넣는다.

```powershell
$gfwSecret = Read-Host 'GFW API token' -AsSecureString
$env:GFW_API_TOKEN = [System.Net.NetworkCredential]::new('', $gfwSecret).Password
Remove-Variable gfwSecret
.\.venv\Scripts\python.exe -m midterm serve --port 8093
```

Python은 루트 `.env`를 자동으로 읽지 않는다. 같은 PowerShell 창의 AIS 키는 유지된다.
토큰 변경은 서버 재시작이 필요하다. 신규 의존성이나 DB 마이그레이션은 없다.

## 구현 계약

`GET /api/vessels/port-visits/{owner}/{source}/{mmsi}?days=30`

- source는 aisstream/digitraffic, days는 30/90이다. 등록 소유자 UUID와 MMSI를 기존 관심 등록 테이블에서 검사한다.
  이 UUID는 현재 POC의 브라우저 식별자이며 로그인 인증·권한 체계가 아니다.
- GFW `vessels/search`에서 MMSI를 검색한 뒤 `selfReportedInfo.ssvid`를 정확히 대조한다.
  서버 수신 IMO가 있으면 함께 검사한다. 다른 MMSI로 변경되기 전 이력까지 추적하는 기능은 포함하지 않는다.
  조회 기간과 겹치는 여러 GFW ID를 합치되, 알려진 IMO 충돌 또는 지나치게 많은 후보는 자동 연결을 보류한다.
  IMO 미제공 후보는 MMSI만 대조한 것으로 표시한다.
- `events`에서 `public-global-port-visits-events:latest`, `PORT_VISIT`을 요청한다.
  검색 후보 최대 50건/연결 ID 최대 20개, 이벤트 최대 5페이지×100건이다. 누락·한도 초과는 partial로 표시한다.
  이벤트는 ID로 중복을 제거하고 입항 시각 역순으로 표시한다. 항만은 intermediateAnchorage를 우선한다.
- 정상 응답과 기록 없음은 서버 메모리 1시간 캐시(최대 200개 검색 조합). 다른 사용자도 같은 식별자/기간이면 공유한다.
  실제 선박 선택/기간 변경/확인 버튼에서 요청하며 자동 주기 갱신은 하지 않는다.
- 동시 조회는 직렬화하고 동일 캐시를 재사용한다. 오류 시 전체 제공처 재시도를 60초, 429는 15분 억제한다.
  캐시가 24시간 이내이면 이전 성공 기록을 stale로 표시하고 조회 시각을 갱신하지 않는다.
  서버 재시작 시 캐시가 비워진다. 제공처 API 토큰/원문 오류/인증 헤더는 응답에 노출하지 않는다.
- 응답에는 provider, mmsi, days, status, message, fetchedAt, windowStart, windowEnd, delayHours,
  matchBasis, truncated, datasets, visits가 있다. 프런트는 MMSI·기간·상태·시각을 검사하고 선박 전환 시 요청을 취소한다.
- UI 기항 표는 5개씩 펼친다. 조회 중에는 250ms 후 Thinking Orbs를 표시하고 완료/오류 시 중지한다.

## 출처와 검증

- [선박 검색](https://globalfishingwatch.org/our-apis/documentation/docs/v3/vessels/search)
- [기항 이벤트 예시](https://globalfishingwatch.org/our-apis/documentation/docs/examples/events/get-example4)
- [데이터 제공 지연](https://globalfishingwatch.org/global-fishing-watch-data-availability/)
- [이용 조건·호출 한도](https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits)

백엔드 회귀 테스트: `backend`에서 `.\.venv\Scripts\python.exe -m pytest tests/test_vessel_port_visits.py -q`.
브라우저 회귀 테스트: 저장소 루트에서 `npm.cmd run test:ui -- --grep GFW`.
테스트의 항만·선박 데이터는 fixture이며 실제 GFW 수신 검증을 대신하지 않는다.
