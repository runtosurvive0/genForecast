# 실제 선박 검색 · 관심 등록

GFW 과거 기항 기록의 토큰 설정·조회 범위·제한은 [GFW 연결 안내](GFW_PORT_VISITS.md)를 참고한다.

선박 추적 → **관심 선박 구성 → 실제 AIS 검색**에서 제공처를 선택한다.
선박명·IMO·MMSI·AIS 목적지 검색, 선종·운항 상태·위치 관측 시각 필터,
최근 관측순·이름순·속도순 정렬을 지원한다. 결과는 20척씩 표시한다.
기존 합성 표본은 `목록에서 찾기`, 식별자만 아는 배는 `직접 등록`을 사용한다.

## 연결 선택

| 제공처 | 범위와 설정 | 현재 연결 방식 |
|---|---|---|
| AISstream | 기본 전 세계(-90..90, -180..180). 서버 API 키 필요 | WebSocket의 위치·정적 정보를 MMSI로 결합. 일반 20,000척 + 별도 한국행 후보 최대 1,000척 |
| Fintraffic / Digitraffic | 핀란드 해역 공개 AIS. 키 불필요. 한국 해역 대체재가 아님 | 공식 metadata/location REST API 결합. 서버 60초 캐시, 요청 중복 억제 |

무료 AIS는 전체 선박 검색 DB가 아니다. 수신 범위·송신 여부에 따라 누락된다.
‘화물선’(AIS 70–79)만으로 석탄 운반선, 화물량, 한국행 여부를 확정하지 않는다.
묘박·계류 상태도 ‘출항 예정’과 동일하지 않다. 출항 예정은 별도 항차 계획이다.

한국행 선박은 해외에 있을 수 있으므로 현재 좌표로 한국행을 선별하지 않는다.
`목적지 검색 · AIS 입력값`은 선박명과 독립적으로 목적지 문자열만 검색한다.
예를 들어 DANGJIN을 검색하면 현재 호주 해역에 있더라도 목적지가 DANGJIN인 선박을 찾는다.
한국행 후보를 코드·이름으로 분류하되 한국행이나 목적 부두를 확정하지 않는다.
`목적지 미확인`으로 아직 정적 정보를 받지 못했거나 목적지가 비어 있는 배를 따로 확인한다.
전 세계 구독도 전체 선박 DB가 아니며, 캐시 한도·보존 기간을 넘은 레코드는 검색 대상에서 제외된다.
현재 수신 범위는 서버 응답을 그대로 표시한다. 환경변수로 제한한 영역은 `서버 지정 수신 영역`이다.

### 한국행 후보 검색 (2026-10-10)

- AISstream은 [공식 구독 API](https://aisstream.io/documentation)에서 목적지 필터를 제공하지 않는다. 전 세계 구독은 그대로 두고 서버가 **수신 후** 분류한다. 추가 API 비용은 없지만 수신 트래픽은 줄지 않는다.
- 새 서버에서 AIS 검색을 열면 `한국행 후보`가 기본 범위다. `전체`는 일반 목록과 별도 후보를 MMSI로 합쳐 중복을 제거하며, `목적지 미확인`은 목적지 문자열이 비어 있는 선박이다. 목적지가 다른 나라거나 해석 불가능한 비어 있지 않은 값은 `전체`에서 확인한다.
- `korean_destinations.py`는 [UNECE KR UN/LOCODE](https://service.unece.org/trade/locode/kr.htm)의 일부 항만·지역 코드와 관리하는 별칭을 사용한다. 당진·보령·하동·동해·태안·평택·삼척·부산·부산신항·인천·마산·울산·광양·여수·포항·삼천포·호산을 포함한다. **KRHDG는 하동군 지역 코드이며 발전소 부두 코드로 확정하지 않는다.** 전국의 모든 항구나 자유 입력 변형을 포괄하지 않는다.
- 코드(`KRPUS`, `KR PUS`) 또는 이름(`BUSAN`, `PUSAN`, `BUSAN, KOREA`)의 완전 일치를 사용한다. `SGSIN > KRTJI` 같은 명시적 방향은 마지막 목적지만 판별한다. `KRPUS > SGSIN`, `BUSAN/SINGAPORE`, `NOT BUSAN`, `KOREA`, `UKRAINE`은 한국행으로 분류하지 않는다. 철자 오기·복합 목적지·미등록 항만은 누락될 수 있으므로 수동 검색도 유지한다.
- 후보마다 원본 AIS 목적지, 판별한 항만/지역, 코드/이름 일치 근거, **목적지 관측 시각(KST)**을 표시한다. 위치 관측 시각과 분리하며, 현재 위치·국적·선박명으로 목적지를 추정하지 않는다.
- 후보 캐시는 일반 20,000척과 별도로 최대 1,000척을 메모리에 보존한다. 목적지 관측 후 **72시간**이 지나면 제외한다. 위치 메시지나 목적지 없는 정적 메시지는 이 시간을 연장하지 않는다. 최신 목적지 변경·명시적 빈 값도 후보를 해제한다. 한도 초과 시 먼저 수신·갱신된 후보부터 제외한다. 후보에서 제외되어도 일반 캐시에 남아 있으면 `전체`에서 조회된다.
- 위치·정적 정보의 역순 메시지는 각각의 시각을 기준으로 처리한다. 일반 캐시에서 밀려난 후보도 새 좌표를 이어 받으며 관심 등록 시 마지막 관측을 항적 저장기에 전달한다.
- `GET /api/vessels/catalog?provider=aisstream`은 기존 `vessels` 배열에 더해 선택적 `koreaCandidates: {capacity: 1000, retentionHours: 72, entries: [{vessel, portCode, portName, matchedBy: 'code'|'name', destinationObservedAt}]}`를 반환한다. 프런트는 출처·식별자 중복·용량·시각·분류 메타데이터를 검증한다. 구 서버 또는 Digitraffic은 기존 전체 검색으로 동작하며 후보 범위는 비활성화된다.
- 별도 후보 목록도 메모리이므로 **서버 재시작 시 다시 수집**한다. DB·키·유료 API·새 의존성을 추가하지 않는다. 후보 분류/관심 등록은 확정 목적항, 항차, 화물, 입하 원장, 재고를 자동 변경하지 않는다.

## AISstream 키 발급과 실행 (Windows PowerShell)

1. [AISstream](https://aisstream.io/) 로그인 → **Account**에서 API 키를 생성한다.
   새 키는 생성 시 한 번 표시된다. 채팅·소스·GitHub·VITE 환경변수에 넣지 않는다.
2. 기존 Python 서버를 해당 터미널에서 종료한 뒤, 저장소 루트의 새 PowerShell에서 실행한다.

```powershell
$aisSecret = Read-Host 'AISstream API key' -AsSecureString
$env:AISSTREAM_API_KEY = [System.Net.NetworkCredential]::new('', $aisSecret).Password
Remove-Variable aisSecret
.\backend\serve-poc.ps1
```

PowerShell 실행 정책이 `.ps1`을 막으면 같은 창에서 직접 실행한다.

```powershell
Set-Location .\backend
$env:PYTHONPATH = Join-Path $PWD 'src'
$env:OMP_NUM_THREADS = '4'
.\.venv\Scripts\python.exe -m midterm serve --port 8093
```

이미 `backend`에서 서버를 실행 중이면 Ctrl+C 후 마지막 Python 명령만 다시 실행한다.
키는 같은 창에 유지된다. 이전 지역 제한을 직접 설정했다면 재시작 전에
`Remove-Item Env:AISSTREAM_BOUNDING_BOXES -ErrorAction SilentlyContinue`로 기본 전 세계 범위를 복원한다.

3. 다른 터미널에서 `npm.cmd run dev`로 프론트를 실행한다.
   기본 주소는 http://127.0.0.1:5173 이고 Python 서버는 8093이다.
4. 실제 AIS 검색을 열면 서버가 구독을 시작한다. 연결됨·첫 메시지 대기·수신 중 상태를 구별한다.
   메시지가 없다는 사실을 전 세계에 선박이 없다는 뜻으로 해석하지 않는다.

Python은 루트 `.env`를 자동으로 읽지 않는다. 키와 수신 영역 변경은 서버를 재시작해야 한다.
키 없는 실제 목록 체험은 제공처를 **Digitraffic · 핀란드 공개 AIS**로 바꾼다.
수신 영역을 변경할 때는 Python 실행 전에 서버 환경변수 `AISSTREAM_BOUNDING_BOXES`에
`[[[위도,경도],[위도,경도]]]` JSON을 지정한다. 최대 8개 영역. 넓은 해역 구독은 수신 부하를 고려한다.

## 동작과 제한

- 2026-10-10 일반 검색 목록 한도를 4,000척에서 **20,000척**으로 확대했다. 제공처의 전체 선박 수가 아닌 서버의 메모리 보관 한도다. 한도 초과 시 가장 오래 수신되지 않은 선박부터 교체한다. Digitraffic 정규화 목록도 동일한 상한을 사용한다.
- 검색창은 전체 응답을 받은 뒤 브라우저에서 검색·정렬하고 화면에는 20척씩 표시한다. AISstream 조회는 기존 10초 주기다. 서버 검색·페이지 API, DB 보존 확대, 지도 표시·기상 조회 대상 확대는 이번 한도 변경에 포함하지 않는다.

- 같은 서버 프로세스는 AISstream 연결 하나를 공유한다. 압축·연결 유지·지수 백오프 재연결을 사용한다.
  서버는 단일 worker로 실행한다. 복수 worker는 별도 구독을 만든다.
- `GET /api/vessels/catalog?provider=aisstream|digitraffic`는 정규화 목록과 연결 상태,
  수신 범위, 마지막 수신/조회 시각을 반환한다. 키·원본 오류 본문은 반환하지 않는다.
- 검색 목록은 메모리 캐시다. 관심 등록한 실제 MMSI의 마지막 관측·수집 항적은 별도 SQLite에 보존한다.
- AISstream은 Class A `PositionReport`, `ShipStaticData`를 수신한다. 모든 종류의 AIS 메시지를 지원하지 않는다.
- 검색 창이 열려 있을 때만 목록을 주기 조회한다. 실제 HTTP 대기 250ms 이후 Thinking Orb를 표시한다.
  닫기·출처 전환 시 요청을 취소하며, 실패 시 같은 출처의 이전 결과를 유지한다.
- 관심 등록은 식별자와 마지막 관측을 브라우저에 저장하고 서버에 추적 대상을 등록한다.
  선박 화면은 10초 간격으로 최신 관측을 확인한다. 관측 시각을 조회 시각으로 덮어쓰지 않는다.
- 실제 선박의 수신 좌표를 지도에 표시한다. 목적항을 확인하면 선택한 선박의 예상 항로와 수집 항적을 표시한다.
  실제 선박에 합성 화물 항로를 배정하지 않는다. 목적항 선택 후 실제 관측·예상 잔여거리·SOG로 기본 ETA를 표시한다.
  기상 미반영 참고값이며 등록 항차의 계획 ETA·화물·입하 원장을 자동 변경하지 않는다.
- 등록만으로 목적 발전소·항차·화물·ETA·팀 재고를 생성하지 않는다. 항차 가정은 별도 편집하며
  이번 AIS 업데이트는 기존 ETA 가정이나 팀 입하 원장을 변경하지 않는다.
- 로그인·계정 간 동기화는 미구현이다. 브라우저 내보내기/가져오기는 출처·마지막 관측을 포함한다.
- 공개 API 실패 시 샘플로 자동 대체하지 않는다. Digitraffic 출처·CC BY 4.0·결합/정규화 사실을 화면에 표시한다.
- 기본 로컬 실행용이다. 외부 배포 전 기존 서버 인증·접근 제한과 동일 출처 `/api` 라우팅을 별도로 구성한다.

## 개발 경계와 확인

### 관심 선박의 실제 기상 예보

- `GET /api/vessels/weather/{owner}/{source}/{mmsi}?destination=dangjin|boryeong|hadong|donghae`는 해당 브라우저의 관측된 관심 선박만 허용한다. 서버의 마지막 AIS 위치·속도와 예상 해상 항로로 통과 예정 시각을 계산한다.
- 실제 선박의 목적항을 지정하면 선박 화면이 열린 동안 관심 선박 전체를 순차 조회한다. 한 바퀴 완료 후 5분마다 재확인하며 관심 해제·목적항 변경 시 이전 요청 결과를 폐기한다. 페이지를 닫으면 정기 조회가 중단된다.
- 향후 최대 72시간, 최대 12개 항로 표본. 각 통과 시각에 가장 가까운 시간별 예보(30분 이내)를 연결한다. 시간 범위 밖이나 null은 자료 없음이다. 격자 예보를 현장 실측이나 전 세계 연속 기상장으로 표시하지 않는다.
- Open-Meteo Forecast의 풍속·돌풍(kn)·풍향과 Marine의 파고(m)·파향·파주기(s)를 사용한다. 풍향·파향은 불어오는 방향이고 화면 화살표는 향하는 방향이다. 내부 UTC, 화면 KST다.
- 공급자 발표시각은 미제공(null)이다. 화면은 AIS 관측 시각, 예보 유효 시각, 대기·해양 각각의 조회 시각을 구분한다. 서버 응답 시각이 이전 예보의 수명을 연장하지 않는다.
- 0.25° 좌표 캐시를 공유하며 공급자가 선택한 실제 격자 좌표도 응답에 포함한다. 공급자별 최대 합계 1,024개 메모리 캐시, 유효 3시간. 갱신 실패 시 6시간 이내 이전 자료만 `stale`로 제공한다. DB 스키마·의존성 추가 없음.
- 공급자 오류 후 60초 재시도 대기. 좌표 수로 계산하는 보수적 POC 호출 예산은 분당 300, 시간당 2,000, 일당 9,000, 최근 30일 250,000이다. 같은 서버의 API 간 공유값이며 재시작 시 초기화된다. 공급자의 실제 이용 한도 보장이나 다른 앱의 호출량 추적은 아니다.
- 최근 1시간 이내 유효한 항해 AIS가 필요하다. 정박·저속·비정상 속도·경로망 오차는 보류한다. 캐시 항로에서 이탈하면 한 번 재계산하고 새 항로도 맞지 않으면 보류한다.
- 기본 ETA는 기상 미반영 값으로 유지하고, 브라우저가 기존 응답을 이용해 별도의 **시연용 기상 보정 ETA**를 계산한다. 감속 계수·현재 기상 차감·누락 처리·민감도 조절은 [선박 기능 안내](../src/features/vessels/README.md#시연용-기상-보정-eta)에 명시한다. 공식 태풍 경보·위험도, 실제 운항 계획, 입하 원장 변경은 미구현이다. 보정 계산은 추가 API 호출·키를 요구하지 않는다. 예보 응답의 새 `speedKn`은 통과 시각 계산에 쓴 AIS 속도이며 기존 서버는 한 번 재시작해야 한다. 필드가 없거나 최신 SOG와 크게 다르면 보정만 보류하고 예보 지도는 유지한다.
- 비상업 해커톤 시연으로 사용자가 확인했다. 무료 endpoint는 추가 키 없이 사용한다. 상업 운영 전 [이용 조건](https://open-meteo.com/en/pricing)을 다시 검토한다. 외부 제공자에는 좌표만 보내며 선명·MMSI·관심 목록은 보내지 않는다.

적용 후 기존 AIS 키가 있는 PowerShell의 backend 폴더에서 Ctrl+C 후 `.\.venv\Scripts\python.exe -m midterm serve --port 8093`로 재시작한다. 관심 선박을 등록하고 `확인한 목적항`을 선택하면 목록에 기상 상태가 표시된다. 지도 아래 `항로 통과 예보`에서 상세와 지도 표시를 조작한다.

서버: `backend/src/midterm/vessels/`, 검색·관심 추적·항로 라우터 `backend/src/midterm/web/vessels_api.py`.
UI: `src/features/vessels/AisVesselSearch.tsx`, `vessel-discovery.ts` 및 기존 추가 창.
공통 변경: 서버 app 라우터, Python 의존성 선언, `TrackingVessel.source`와 선택적 `ais` 관측.
`websockets`는 기존 requirements.lock의 17.2를 사용하며 직접 의존성으로 선언했다. npm 의존성 추가는 없다.
기존 workspace v1은 그대로 읽는다. 공통 변경은 통합 담당자 리뷰 대상이다.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:ui
.\backend\.venv\Scripts\python.exe -m pytest -q backend/tests/test_vessel_ais.py
.\backend\.venv\Scripts\python.exe -m pytest -q backend/tests/test_vessel_navigation.py
```

공식 자료: [AISstream API](https://aisstream.io/documentation),
[Digitraffic Marine](https://www.digitraffic.fi/en/marine-traffic/),
[API 사용 지침](https://www.digitraffic.fi/en/support/instructions/),
[Digitraffic 이용 조건](https://www.digitraffic.fi/en/terms-of-service/).

## 무료 예상 항로·수집 항적

1. 실제 AIS 선박을 관심 등록하고 선택한다. 위치가 없으면 임의 좌표를 만들지 않고 수신을 기다린다.
2. 지도 위 **확인한 목적항**에서 당진·보령·하동·동해 중 목적항을 선택한다. AIS 목적지 문자열은 참고만 한다.
3. Python [searoute](https://github.com/genthalili/searoute-py)가 해상 항로망으로 **예상 항로(점선)**를 계산한다.
   실제 운항계획·항해용 경로가 아니다. 항만 좌표는 개략 위치이며 항로망과 좌표가 떨어진 거리도 표시한다.
   선박 좌표와 항로망 시작점 사이는 별도의 가는 점 **위치 연결선**으로 표시한다.
   이 안내선은 육지·수심·통항 조건을 검증한 항로가 아니며, 표시 해상거리와 ETA 계산에 포함하지 않는다.
   정밀 입항·접안 경로는 제공하지 않는다.
4. **수집 항적(실선)**은 서버가 관측한 기록이다. 최근 24시간·7일·30일을 선택한다.
   수집 이전 항적을 소급 조회하지 않는다. AIS 수신 공백이 6시간을 넘으면 선을 끊고, 비정상 좌표 이동은 제외한다.
   저장된 마지막 점 이후 더 최신 AIS 관측이 있으면 같은 공백·이동 검증을 거쳐 화면의 항적 끝에 이어 표시한다.
5. 위치 25 nm 이동 또는 계산 후 6시간 경과 시 다음 AIS 갱신에서 재계산한다. **항로·항적 갱신**은 즉시 다시 요청한다.
   실패 시 같은 선박·목적항의 마지막 계산을 유지하고 오류를 표시한다. 목적항이 달라지면 이전 경로를 표시하지 않는다.

API 사용료가 발생하는 경로 서비스를 추가하지 않는다. 로컬 PC/서버 실행·저장 비용은 별도다.
AISstream 무료 수신 범위와 가용성의 제한은 그대로이며, 사용자의 API 키는 서버에만 둔다.

### 설치·재시작

저장소 루트에서 설치한다. Windows 기본 인코딩 때문에 searoute 설치가 실패할 수 있어 UTF-8을 명시한다.

```powershell
$env:PYTHONUTF8 = '1'
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.lock
```

그 후 키를 입력했던 터미널에서 Ctrl+C 후 기존 서버 명령을 재실행한다. 새 의존성은
`searoute==1.6.0`, `geojson==3.3.0`, `networkx==3.7`이며 npm 의존성 추가는 없다.

### 저장·API 계약

- 기본 DB: `backend/data/vessel-tracks.sqlite3` 및 WAL 파일. Git에서 제외된다. `AIS_TRACK_DB`로 경로를 바꿀 수 있다.
- 브라우저별 등록을 합친 MMSI만 수집한다. 관측점은 최소 60초 간격으로 기록하고 5초마다 DB에 저장한다.
  정상 종료 시 잔여 기록을 저장한다. 강제 종료 시 마지막 저장 이후 관측이 유실될 수 있다.
- 등록 정보·마지막 관측은 재시작 후 유지한다. 항적 보관은 30일, 조회당 최근 5,000점, 브라우저당 200척·서버 전체 1,000척 한도다.
- 브라우저를 닫아도 서버가 실행 중이면 등록 선박 수집을 계속한다. 서버/PC를 끈 기간은 수집하지 못한다.
- 관심 해제는 해당 브라우저의 등록을 제거한다. 다른 브라우저 등록과 보관 중인 항적은 삭제하지 않는다.
  브라우저 저장소만 초기화하면 이전 등록이 서버에 남을 수 있다. 먼저 관심 목록에서 해제한다.
- `PUT /api/vessels/tracking/{owner}`: `{vessels:[{source,mmsi}]}`로 브라우저 관심 등록을 동기화한다.
- `GET /api/vessels/tracking/{owner}`: 관심 선박의 마지막 수신 정보. 검색 캐시 20,000척에서 빠져도 유지한다.
- `GET /api/vessels/tracking/{owner}/{source}/{mmsi}?hours=24|168|720`: 구간별 관측점·수·조회 제한 여부.
- `POST /api/vessels/destinations/resolve`: `{destinations:["KR PUS","SGSIN"]}`. 최대 200개·문자열당 100자.
  설치된 searoute 항만 자료의 코드/유일한 이름 및 기존 한국 항만 별칭을 대조한다. 별도 외부 API 호출·키는 없다.
  응답 `destinations[]`의 `raw`, `status=resolved|missing|unresolved|ambiguous`; resolved일 때
  `destinationId=port:KRPUS`, `code`, `name`, `country`, `matchedBy=code|name`을 제공한다.
  `A > B`처럼 명시적인 방향은 마지막 목적지로 읽고, 여러 후보·오타·목록은 임의 추측하지 않는다.
- `GET /api/vessels/route?longitude=…&latitude=…&destination=dangjin|boryeong|hadong|donghae|port:KRPUS`: 목적항 필수.
  `kind=estimated`, 좌표 배열 `[경도,위도]`, 해리 단위 거리와 항로망 끝점 오차를 반환한다.
  기상 API의 `destination`도 같은 항만 ID를 받으며, 등록되지 않은 코드는 422로 거부한다.
- 브라우저의 `AIS 목적지 기준` 설정은 `ais`로 보존하며 수신 목적지에 맞는 항만 ID를 동적으로 사용한다.
  새 문자열이 미해석이면 이전 항로·ETA·기상을 표시하지 않는다. 목적지 해석 실패 시 직접 목적항을 선택한다.
  AIS 입력값과 항만 자료의 일치일 뿐 확정 운항계획·발전소 터미널·화물 계약의 확인이 아니다.
  항만 자료에 없는 목적지와 동명이항은 자동 연결하지 않으며, 실제 최신 목적지는 선사 확인이 필요하다.
- 브라우저 owner UUID는 로그인·권한 검증이 아니다. 현재 로컬 POC용이며 공용 배포에는 인증·사용량 제한이 필요하다.
- 공통 지도 `world-map.tsx`, Python 의존성과 서버 라우터는 통합 담당자 리뷰 대상이다. 공급 계산 계약은 바꾸지 않는다.
# 기상 레이어 확장 (2026-10-10)

`GET /api/vessels/cyclones`는 서버에서 GDACS 공개 자료를 조회하며 개인 위치·MMSI를 GDACS에 보내지 않는다. 응답은 `status: ready | partial | stale | unavailable`, `fetchedAt`, `reason`, `storms[]`다. ready는 조회 성공일 뿐 해역 안전이나 전체 태풍 포괄을 의미하지 않는다.

각 태풍은 `id, name, source, advisoryAt, reportUrl, points[]`를 가진다. 지점의 `at`는 UTC 유효시각, `forecast`는 예보/관측 구분, `longitude/latitude`는 실제 공급자 중심 좌표, `radii34Nm`은 `[NE, SE, SW, NW]` 순서의 34kt 풍속 반경(nm)이다. null은 미제공이며, 0 또는 누락 반경으로 대체 원을 생성하지 않는다. 최신 advisory의 예보와 이전 24시간 관측만 정규화한다. GDACS 인도적 영향 경보 색상은 해상 위험 등급으로 사용하지 않는다.

태풍 외부 응답은 2MB/8초 제한, 상세 조회 전체 35초 제한, 동시 4개/최대 16개 태풍이다. 캐시 30분, 실패 시 최대 6시간 이전 자료와 60초 재시도 제한을 사용한다. 성공한 빈 목록과 조회 실패를 구분한다. 이 공개 엔드포인트는 로그인 기능이 아니다.

기존 `GET /api/vessels/weather/...` 지점에 `visibilityM: number | null`을 추가했다. Open-Meteo `hourly=visibility`를 기존 대기 배치 조회에 포함한다. 단위 오류·미제공은 null로 두며 다른 정상 풍속값을 폐기하지 않는다. UI는 이전 서버에서 필드가 빠져도 자료 없음으로 표시한다. 시정·태풍 정보 자체는 ETA 보정 항을 추가하지 않는다.

출처: [GDACS API](https://www.gdacs.org/gdacsapi/swagger/index.html), [GDACS 이용 안내](https://gdacs.org/About/termofuse.aspx), [Open-Meteo](https://open-meteo.com/en/docs).
