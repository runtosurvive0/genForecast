# 중장기 발전·연료 계획 서비스

기존 `feat/midlongterm-dangjin`의 수요 LightGBM, 석탄곡선, SciPy/HiGHS MIP,
SQLite 수급 원장과 당진 대시보드를 이관했다. 계산 코드는 보존하고 서비스 루트를
이 폴더로 옮겼다. React 앱의 Pile·선박 합성 데이터와 별도로 실행한다.

## 설치 · 실행

Python 3.12 이상이 필요하다. 이 폴더에서 실행한다.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\serve-poc.ps1
```

로컬 기본 주소는 http://127.0.0.1:8093 이다. 현재 PC의 기존 Python 환경을 재사용할 수 있다.
PYTHONPATH는 항상 이 폴더의 `src`로 지정하므로 기존 설치가 다른 프로젝트를 가리켜도
이 저장소 코드와 데이터를 사용한다.

```powershell
.\serve-poc.ps1 -PythonPath 'D:\mid term milp\.venv\Scripts\python.exe'
```

다른 PC의 clone에는 실행 자료가 없다. 승인된 로컬 자료를 다음 경로에 복원한 뒤 실행한다.
실제 데이터를 Git에 추가하지 않는다. `.env`는 자동으로 읽지 않으며 환경변수로 지정한다.

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

현재 PC에는 이전 프로젝트의 DB·모델·기준자료·저장 결과를 독립 복사했다. 원본들은 보존했다.
LightGBM `.txt` 파일은 LF 줄바꿈을 유지해야 한다. 임의 CRLF 변환은 모델을 손상시킨다.
실적 DB를 다시 수집할 때만 `MIDTERM_SOURCE_DSN` 환경변수 또는 `snapshot --dsn`을 사용한다.
기본 서버는 localhost에 바인딩된다.

## 화면 · API

- `/`: 위험·재고 KPI, 수요/태양광/석탄 전망, 연료 FLOW, 일별·월별 톤, 처별 전망, 계획정지.
- `/planning`: 기존 발전 분석·DB 시나리오·정비·발열량·MIP 실행.
- `/docs`: FastAPI 스키마.
- `GET /api/supply/dashboard`: 저장된 계획과 원장을 사용하는 수급 전망·연료 달력.
- `GET /api/supply/records`: 수급 입력 원장.
- `POST /api/supply/plans`: 외부 원천을 시간·호기별 MW로 정규화하여 등록.
- `PUT /api/fuel-settings`: 기준 발열량·임시 여부·출처 갱신.

DB 사용자 입력은 수급 관리 화면에서 처리한다. 수기 Heat Rate를 우선 적용하고 없으면 기존
2차 열량곡선(또는 선택한 설비군 정격환산 HR)을 사용한다. 전역 5,500 kcal/kg는 사용자 지정
임시 가정이다. 월별 구매 계획은 이 고정 발열량으로 비교하며, 재고전망은 처별 저탄장 평균열량을
사용한다. 일별·월별 시간계획 누락은 0으로 대체하지 않는다.

태양광은 실적 패턴/기상연도 재생 전망이며 독립 ML 모델이 아니다. KPI의 MAPE와 DSS 구분은
검증자료가 연결되지 않은 상태다. 실제 KPX 자동 연결도 미구현이다. 로컬 2027년 저장 결과는
원전/당진 정비가 불완전한 동작 확인용이며 실제 운영 계획이 아니다. 수급 설계는
[당진 POC 설계](docs/dashboard-design.md)에 보존한다.

## 검증

```powershell
.venv\Scripts\python.exe -m pytest -q
```

테스트는 합성 운전특성과 임시 SQLite를 사용한다. 실적·모델 없이도 실행할 수 있다.
보존된 로컬 MIP 결과를 확인하는 한 테스트는 해당 파일이 없으면 skip한다. 새 브랜치 CI에서
기존 React 검증과 Python 검증을 각각 수행한다. 통합 방법과 계약 차이는
[이관 기록](../docs/MIDTERM_INTEGRATION.md)을 참고한다.
