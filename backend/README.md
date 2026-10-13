# 중장기 발전·연료 계획 서비스

기존 `feat/midlongterm-dangjin`의 수요 LightGBM, 석탄곡선, SciPy/HiGHS MIP,
SQLite 수급 원장과 당진 대시보드를 이관했다. 계산 코드는 보존하고 서비스 루트를
이 폴더로 옮겼다. React의 발전소 종합과 저탄장 현황은 같은 저장 결과·수급 DB를 조회한다.
데이터/관리자의 MILP 업로드 탭에서 입력 저장·계산 실행·가상 시작재고 등록을 관리한다.
저탄장 약도·패널과 선박추적의 기존 화면은 유지한다.

## 설치 · 실행

Python 3.12 이상이 필요하다. 이 폴더에서 실행한다.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock -e ".[dev]"
.venv\Scripts\python.exe scripts/verify_shared_assets.py
.\serve-poc.ps1
```

로컬 기본 주소는 http://127.0.0.1:8093 이다. 현재 PC의 기존 Python 환경을 재사용할 수 있다.
PYTHONPATH는 항상 이 폴더의 `src`로 지정하므로 기존 설치가 다른 프로젝트를 가리켜도
이 저장소 코드와 데이터를 사용한다.

```powershell
.\serve-poc.ps1 -PythonPath 'D:\mid term milp\.venv\Scripts\python.exe'
```

clone에는 2026-10-08 공개 승인을 받은 기준자료·실적·두 모델·입력·SQLite DB·저장 결과
17개와 2026-10-13 공유 요청한 가상 연계 초기 DB 1개가 포함된다. 파일별 크기와 SHA-256은
`shared-assets.json`에 기록했다. 저장 결과 조회와
모델 예측에는 원천 DB 연결정보가 필요 없다. Python의 연결정보는 프로세스 환경변수로 지정하며
`.env`를 자동으로 읽지 않는다. 실제 `.env`와 추가 로컬 자료·가상환경·출력은 계속 제외한다.

| 경로 | 내용 |
|---|---|
| `data/coal_units.csv` / `.csv.json` | 석탄 호기 운전특성·열량곡선 |
| `data/nuclear_units.csv` / `.csv.json` | 원전 호기 마스터 |
| `data/heat_price.csv` / `.csv.json` | 월별 열량단가 |
| `data/history_hourly.csv` / `.csv.json` | 모델 전망용 실적 기온·태양광 패턴 |
| `data/dangjin_actual_hourly.csv` / `.csv.json` | 기존 발전 분석의 실적 추정 자료 |
| `data/planning.sqlite3` | 가정·열량·정비·재고·하역·이탄·원천계획 DB |
| `data/planning-local.sqlite3` | 로컬 입력·MILP 실행 결과·가상 시작재고·입항/체선 원장 (Git 제외) |
| `seeds/fuel-integration-2027.sqlite3` | 재등록 가능한 가상 MILP 결과·64만 톤 초기재고·BD-1 하역 설정 |
| `models/net-demand.*`, `models/coal-curve.*` | 학습 모델·메타데이터 |
| `inputs/` | CLI 시나리오·정비 입력(웹 입력은 DB에서 관리) |
| `inputs/ranking_oh.json` | 배분 백테스트용 월별 과거 정비 가정(`월: 호기명 배열`) |
| `runs/` | 저장된 MIP 실행의 summary/NPZ/재현 시나리오 |

공유한 DB는 해당 시점의 원장 스냅샷이다. 기본 서버는 최초 실행 시 이를 작업 DB로 복사하고
새 입력·결과를 `planning-local.sqlite3`에 저장한다. `MIDTERM_PLANNING_DB`로 작업 경로를 지정할 수 있다.
새 실행 결과는 자동으로
Git에 포함하지 않으며 승인된 파일 결과와 가상 연계 초기 DB만 추적한다. CSV는 포함된 JSON 사본에서
자동 복원되며 복원한 CSV는 Git에서 제외된다. 현재 PC의 기존 폴더와 개선 워크트리는 독립 DB를 사용한다.
LightGBM `.txt` 파일은 LF 줄바꿈을 유지해야 한다. 임의 CRLF 변환은 모델을 손상시킨다.
실적 DB를 다시 수집할 때만 `MIDTERM_SOURCE_DSN` 환경변수 또는 `snapshot --dsn`을 사용한다.
기본 서버는 localhost에 바인딩된다.

## 연료수급 연계 초기 DB 등록

새 클론의 작업 DB에는 어제 개발 PC에서 등록한 입력·재고·계산 결과가 자동으로 전달되지 않는다.
아래 명령으로 포함된 가상 자료를 한 번 등록한다. 재계산 없이 연간 MILP 결과·초기 재고·하역을 조회한다.

```powershell
.venv\Scripts\python.exe -m midterm seed-demo
# 별도 격리 DB를 지정할 때
.venv\Scripts\python.exe -m midterm seed-demo --database data/integration-test.sqlite3
```

기존 실적·설정·원장은 보존하며 반복 실행해도 중복 등록하지 않는다. 같은 계산 ID/기준재고 시각이
이미 있으면 전체 등록을 취소한다. 기본 DB는 `MIDTERM_PLANNING_DB` 또는 `data/planning-local.sqlite3`다.
계정·세션·AIS 데이터는 포함되지 않으며 서버 계정 초기화와 로그인은 별도다.
로컬 서버에 연결한 화면의 데이터/관리자 → MILP 업로드 → **2027 가상입력 → 발전소 종합에서 보기**를
선택해 2027-01-01부터 조회한다. 초기 재고 총 640,000t, 고/저열량 6,000/5,000 kcal/kg,
BD-1 하역 7,000t/일이 연결된다. 가상 미래 재고는 현재 운영재고로 사용하지 않는다.
자료 범위와 검증 방법은 [초기 DB 안내](seeds/README.md)에 있다.
공용 ZGX는 코드 배포 후 해당 서버 DB에 이 명령을 별도로 실행해야 한다. GitHub PR 병합만으로
서버 DB를 변경하지 않으며, ZGX 장애 시 가상 자료로 자동 대체하지 않는다.

## 화면 · API

데이터/관리자의 **수급 배정·시뮬레이션**에서 항차 등록·3개 부두 추천·관리자 배정과
기본/체선 포함 비교를 저장한다. 테이블·API·관측/계획 구분은
[부두·재고 전망 안내](../docs/FUEL_BERTH_PLANNING.md)를 참고한다.

- `/`: 위험·재고 KPI, 수요/태양광/석탄 전망, 연료 FLOW, 일별·월별 톤, 처별 전망, 계획정지.
- `/planning`: 기존 발전 분석·DB 시나리오·정비·발열량·MIP 실행.
- `/docs`: FastAPI 스키마.
- `GET /api/supply/dashboard`: 저장된 계획과 원장을 사용하는 수급 전망·연료 달력.
- `GET /api/supply/records`: 수급 입력 원장.
- `GET /api/runs`: 저장된 MILP 계산 목록.
- `GET /api/planning/runs/{run_id}/snapshot?start=2027-01-01&horizon=30`: React 조회 계약.
  7/30/60/90일, 당진 10개 호기, 일별 발전·고정 기준 연료량, 전체 계획 월별 연료량,
  계산 당시 정지 일정, 전국 모델 전망, DB 재고·입하 전망을 함께 반환한다.
- `POST /api/supply/plans`: 외부 원천을 시간·호기별 MW로 정규화하여 등록.
- `PUT /api/fuel-settings`: 기준 발열량·임시 여부·출처 갱신.

DB 사용자 입력은 수급 관리 화면에서 처리한다. 수기 Heat Rate를 우선 적용하고 없으면 기존
2차 열량곡선(또는 선택한 설비군 정격환산 HR)을 사용한다. 전역 5,500 kcal/kg는 사용자 지정
임시 가정이다. 월별 구매 계획은 이 고정 발열량으로 비교하며, 재고전망은 처별 저탄장 평균열량을
사용한다. 일별·월별 시간계획 누락은 0으로 대체하지 않는다.

루트에서 `npm run dev`를 실행하면 React는 http://127.0.0.1:5173 에 열린다. 기본 `/api`는
공용 ZGX에 연결한다. Python 백엔드를 개발할 때만 `.env.local`에
`MIDTERM_API_TARGET=http://127.0.0.1:8093`을 지정하고 로컬 서버를 함께 실행한다.
이때 기존 `MIDTERM_API_ORIGIN`은 제거한다. 테스트 쓰기는 격리 DB에서 실행한다.
프록시는 개발용이며 배포 시에는 동일 출처 `/api` 라우팅을 구성해야 한다.
단일 HTML 파일을 직접 열면 기존 합성 데모로 시작한다.
React의 데이터/관리자 → MILP 업로드에서 시나리오 JSON·월별 단가·정비 파일을 검증해 저장하고
선택한 입력 ID로 계산한다. 실행 요약과 전체 시간별 결과는 DB에 보존하며, 완료 후 종합 화면으로 이동할 수 있다.
가상 시작재고는 해당 계산 시작일에만 귀속한다. 현재 운영재고와 실제 내부망 발전 실적은 별도 API 입력이다.
AIS 입항·접안·체선은 등록된 화물과 연결하며, 미하역 선박 잔량을 저탄장 재고와 구분한다.
상세 필드와 API는 `../docs/DATA_DICTIONARY.md`를 따른다.
Windows의 `serve` 명령은 Selector 이벤트 루프로 실행해 연결 취소 후 서버 수신이 중단되는 문제를 피한다.

기존 서버를 유지하면서 개발할 때는 별도 Git 워크트리를 사용하고, 실행 자료와 SQLite DB도
해당 워크트리에 독립 복사한다. 루트의 `.env.local`에서 `MIDTERM_DEV_PORT=5174`,
`MIDTERM_API_TARGET=http://127.0.0.1:8094`로 개발 서버를 분리할 수 있다. Python은
`backend` 폴더에서 `.\serve-poc.ps1 -Port 8094`로 실행한다. Vite는 포트가 이미 사용 중이면
종료하므로 기존 서버와 주소가 섞이지 않는다. UI 테스트도 같은 화면 포트 설정을 사용한다.
`.env.local`과 추가 로컬 실행 자료는 Git에서 제외된다.

태양광은 실적 패턴/기상연도 재생 전망이며 독립 ML 모델이 아니다. KPI의 MAPE와 DSS 구분은
검증자료가 연결되지 않은 상태다. 실제 KPX 자동 연결도 미구현이다. 로컬 2027년 저장 결과는
원전/당진 정비가 불완전한 동작 확인용이며 실제 운영 계획이 아니다. 수급 설계는
[당진 POC 설계](docs/dashboard-design.md)에 보존한다.

## 검증

```powershell
.venv\Scripts\python.exe -m pytest -q
```

테스트는 합성 운전특성과 임시 SQLite를 사용한다. 실적·모델 없이도 실행할 수 있다.
보존된 MIP 결과를 확인하는 테스트는 공유한 결과를 검증하며 해당 파일이 없으면 skip한다. CI에서
기존 React 검증과 Python 검증을 각각 수행한다. 통합 방법과 계약 차이는
[이관 기록](../docs/MIDTERM_INTEGRATION.md)을 참고한다.
