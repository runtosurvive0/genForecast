# 중장기 발전·연료 계획 서비스

기존 `feat/midlongterm-dangjin`의 수요 LightGBM, 석탄곡선, SciPy/HiGHS MIP,
SQLite 수급 원장과 당진 대시보드를 이관했다. 계산 코드는 보존하고 서비스 루트를
이 폴더로 옮겼다. React의 발전소 종합 화면에만 저장 결과와 DB 수급 전망을 제공한다.
저탄장·선박추적을 포함한 다른 메뉴는 기존 기능을 유지한다.

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
17개가 포함된다. 파일별 크기와 SHA-256은 `shared-assets.json`에 기록했다. 저장 결과 조회와
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
| `models/net-demand.*`, `models/coal-curve.*` | 학습 모델·메타데이터 |
| `inputs/` | CLI 시나리오·정비 입력(웹 입력은 DB에서 관리) |
| `inputs/ranking_oh.json` | 배분 백테스트용 월별 과거 정비 가정(`월: 호기명 배열`) |
| `runs/` | 저장된 MIP 실행의 summary/NPZ/재현 시나리오 |

공유한 DB는 해당 시점의 원장 스냅샷이다. 사용자 입력이나 모델·자료를 갱신하면 명세의 체크섬과
달라질 수 있으므로 다음 공유 전에 변경 파일과 명세를 함께 검토한다. 새 실행 결과는 자동으로
Git에 포함하지 않으며 현재 승인된 저장 결과 한 건만 추적한다. CSV는 포함된 JSON 사본에서
자동 복원되며 복원한 CSV는 Git에서 제외된다. 현재 PC의 기존 폴더와 개선 워크트리는 독립 DB를 사용한다.
LightGBM `.txt` 파일은 LF 줄바꿈을 유지해야 한다. 임의 CRLF 변환은 모델을 손상시킨다.
실적 DB를 다시 수집할 때만 `MIDTERM_SOURCE_DSN` 환경변수 또는 `snapshot --dsn`을 사용한다.
기본 서버는 localhost에 바인딩된다.

## 화면 · API

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

루트에서 `npm run dev`를 실행하면 React는 http://127.0.0.1:5173 에 열린다. Vite의 `/api`
프록시는 Python 8093으로 연결하므로 두 서버를 함께 실행한다. 프록시는 개발용이며 배포 시에는
동일 출처 `/api` 라우팅을 구성해야 한다. 단일 HTML 파일을 직접 열면 기존 합성 데모로 시작한다.
React의 이번 연결은 저장 결과 조회이고 계산 요청·DB 입력 편집은 후속 범위다.

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
