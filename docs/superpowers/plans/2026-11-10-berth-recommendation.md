# 접안 추천(여러 안 비교) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 입항 예정 항차의 부두·접안 시각을 MILP로 풀어 세 안(체선 최소·균형·재고 우선)을 추천한다. 현재 계획과 함께 API, 운영 도우미, 통합 시뮬레이션 "접안 추천" 탭에서 보인다.

**Architecture:**
- `backend/src/midterm/berth_plan/`에 네 파일을 둔다.
  - `inputs.py`: 입력 모으기
  - `solve.py`: 시간 색인 MILP와 일정 평가
  - `explain.py`: 원인 판정
  - `plan.py`: 세 안 조립
- API(`web/berth_plan_api.py`)와 도우미 도구는 모두 `plan.recommend_berth_plan` 하나를 부른다.
- 프런트는 둘로 나눈다.
  - `src/domain/berth-plan.ts`: 타입, 응답 검증, 호출
  - `src/features/berth-plan/`: 화면
- `App.tsx`가 탭으로 연결한다.

**Tech Stack:** Python 3 · FastAPI · `scipy.optimize.milp`(내부 HiGHS) · React/TypeScript · node:test · Playwright

**Spec:** `docs/superpowers/specs/2026-11-10-berth-recommendation-design.md`

## Global Constraints

- **읽기 전용.** 항차 원장, 수급 원장, 기준재고에 쓰지 않는다. 공용 ZGX API에 쓰기 시험을 하지 않는다.
- **새 의존성 없음.** MILP는 `scipy.optimize.milp`(HiGHS)를 쓴다.
  - 판정: 설계 6절의 "HiGHS"는 지킨다. 다만 `highs_backend.Backend`는 롤링 창 전용이고 로컬에 `highspy`가 없을 수 있어 scipy 경로를 쓴다.
- **기본값:**

  | 항목 | 값 |
  |---|---|
  | 기간 | 14일 (API 1~30, 화면 7·14·30) |
  | 벌점 단가 | 20,000 USD/그룹·일 |
  | C안 벌점 | 벌점 단가 × 10 |
  | 풀이 제한 | 안마다 30초 |
  | `danger_days`·`normal_days` | 수급 설정값 (기본 7·15) |

- **하역 시간** = `ceil(화물량 / unload_tph / work_hours_per_day × 24)` 시간. 슬롯은 1시간, 시각은 KST.
- **저탄장 그룹:** `{'1': 'g14', '2': 'g58', '3': 'g910'}` (`supply.YARD_GROUP`).
- **빈 자료는 지어내지 않는다.** 체선료, 허용정박, 제원, 기준재고가 없으면 `gaps`에 적고 계산에서 뺀다. 실패를 합성 값으로 대신하지 않는다.
- **사용자에게 보이는 글은 한국어.** 고정 문구:
  - "현재 계획", "A. 체선 최소", "B. 균형", "C. 재고 우선", "추천"
  - "세 안 같음 · 체선·재고 차이 없음", "기간 안 입항 예정 선박 없음"
  - "부두 능력 시연용 가정값", "선형 제한 미적용(선박 제원 없음)", "ETA 기산 가정", "위험 기준을 지킬 수 없음"
- **프런트 규칙:**
  - 화면끼리 직접 import하지 않는다.
  - 기능 CSS는 `src/features/berth-plan/`에 두고 전용 클래스(`gf-bp-` 접두어)를 쓴다.
  - `App.tsx` 변경은 PR에 통합 담당자 검토 대상으로 표시한다.
- **검증:**
  - `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:ui`, backend `pytest`
  - `test:ui` 전에 PowerShell에서 `$env:PATH = "<repo>\backend\.venv\Scripts;" + $env:PATH`를 실행한다.
  - 새 단위 시험은 `package.json`의 "test" 목록에, 새 UI 시험은 `playwright.config.ts`의 `testMatch`에 추가한다.

## Review Focus

1. **이미 도착한 배**(ETA < 기준시각): 시작은 기준시각부터 잡고, 체선은 원래 ETA부터 센다. → Task 2 `test_arrived_before_as_of_counts_wait_from_eta`
2. **하역이 기간 끝을 넘는 배**: 부두 점유는 기간 뒤까지 막는다. 기간 밖 입하는 재고에 넣지 않는다. → Task 2 `test_unload_past_horizon_blocks_berth_but_not_stock`
3. **고정 점유 끝 미확인**: 그 부두를 격자 끝까지 막고 `gaps`에 `fixed_end_unknown`을 적는다. → Task 1 `test_fixed_without_end_blocks_to_grid_end`
4. **고정 점유와 겹치는 lock**: 422가 아니라 그 안이 "해 없음"(status `infeasible`)이 된다. → Task 3 `test_conflicting_lock_gives_infeasible_option`
5. **API 실패·빈 응답 화면**: 오류 문구만 보이고 숫자·카드는 그리지 않는다. → Task 7 UI 시험 "오류 시 카드 없음"

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `backend/src/midterm/berth_plan/__init__.py` | `recommend_berth_plan` 내보내기 |
| `backend/src/midterm/berth_plan/inputs.py` | 부두 자료, 대상·고정 항차, 하역 시간, 재고 계열, gaps |
| `backend/src/midterm/berth_plan/solve.py` | 한 안의 MILP 구성·풀이, 일정 평가(KPI) |
| `backend/src/midterm/berth_plan/explain.py` | 체선 원인 사후 판정 |
| `backend/src/midterm/berth_plan/plan.py` | 세 안·현재 계획·합치기·순위·결과 JSON |
| `backend/src/midterm/web/berth_plan_api.py` | `POST /api/berth-plan/recommend` |
| `backend/src/midterm/web/app.py` | 라우터 등록 1줄 |
| `backend/src/midterm/assistant/tools.py` | `optimize_berth_schedule` 도구 |
| `backend/tests/test_berth_plan_inputs.py`, `test_berth_plan_solve.py`, `test_berth_plan.py`, `test_berth_plan_api.py` | 시험 |
| `src/domain/berth-plan.ts` | 타입, `parseBerthPlan`, `fetchBerthPlan`, 표시 도우미 |
| `tests/berth-plan.test.ts` | 단위 시험 |
| `src/features/berth-plan/BerthPlanWorkspace.tsx`, `BerthGantt.tsx`, `berth-plan.css` | 화면 |
| `src/App.tsx` | 통합 시뮬레이션 탭 "접안 추천" |
| `tests/berth-plan-ui.spec.ts` | Playwright |

---

### Task 1: 입력 모으기 (`inputs.py`)

**Files:**
- Create: `backend/src/midterm/berth_plan/__init__.py` (빈 파일로 시작), `backend/src/midterm/berth_plan/inputs.py`
- Test: `backend/tests/test_berth_plan_inputs.py`

**Interfaces:**
- Produces:
  ```python
  @dataclass(frozen=True)
  class Berth:
      id: str; unload_tph: float; work_hours_per_day: float; yards: tuple[str, ...]

  @dataclass(frozen=True)
  class Outage:
      berth: str; start: datetime; end: datetime

  @dataclass(frozen=True)
  class Voyage:
      voyage_no: str; voyage_number: str | None; vessel_name: str | None; yard: str | None
      group: str | None; tonnes: float; eta: datetime; laytime_hours: float | None
      demurrage_usd_per_day: float | None; allowed: tuple[str, ...]
      current_berth: str | None; current_berth_at: datetime | None; current_unload_end: datetime | None

  @dataclass(frozen=True)
  class Fixed:
      voyage_no: str; voyage_number: str | None; vessel_name: str | None; yard: str | None
      berth: str; until: datetime | None

  @dataclass(frozen=True)
  class StockSeries:
      base: dict[str, list[float]]   # 그룹 → 날짜별(하루 끝) 재고 t. 대상 항차 입하는 뺀 값
      denom: dict[str, list[float]]  # 그룹 → 날짜별 다음 7일 사용 평균 t/일

  @dataclass(frozen=True)
  class BerthInputs:
      as_of: datetime; t0: datetime; midnight: datetime; horizon_days: int
      berths: dict[str, Berth]; outages: list[Outage]; voyages: list[Voyage]; fixed: list[Fixed]
      stock: StockSeries | None; danger_days: float; normal_days: float; gaps: list[dict]

  def load_berths(path: Path | None = None) -> tuple[dict[str, Berth], list[Outage]]
  def unload_hours(tonnes: float, berth: Berth) -> int
  def build_inputs(registry: dict, berths: dict[str, Berth], outages: list[Outage], stock: StockSeries | None,
                   as_of: datetime, horizon_days: int, danger_days: float = 7., normal_days: float = 15.,
                   stock_gap: str | None = None) -> BerthInputs
  def read_stock(as_of: datetime, horizon_days: int, exclude_voyages: set[str]) -> tuple[StockSeries | None, str | None, dict]
  def load_inputs(db_path: Path, as_of: datetime, horizon_days: int) -> BerthInputs
  ```
- `gaps`의 원소는 `{"kind": str, "voyage_no": str | None, "message": str}`이다. `kind`는 다음 중 하나다.
  - `no_eta`, `no_tonnes`, `no_yard`, `no_demurrage`, `fixed_end_unknown`, `stock_unknown`
  - `no_vessel_size`: 항상 1회 적는다.

- [ ] **Step 1: 실패하는 시험 작성**

  `REGISTRY` 고정자료를 쓴다.
  - ships 1척
  - voyages 6개: planned, underway, arrived 각 1개, berthed 1개, completed 1개, simulation 1개
  - cargo는 당진과 다른 발전소를 섞는다.

  시험 목록:
  - `test_load_berths_reads_dummy_file`:
    - BD-1 `unload_tph == 1800`, BD-1 `yards == ('1','2')`
    - outage 1개 (BD-2, 2026-11-20T08:00+09:00 ~ 11-21T20:00+09:00)
  - `test_unload_hours`:
    - `unload_hours(36000, BD-1) == 24` (36000/1800/20×24)
    - `unload_hours(1, BD-3) == 1`
  - `test_targets_and_fixed_selection`:
    - planned, underway, arrived만 `voyages`에 들어간다.
    - berthed는 `fixed`에 들어간다.
    - completed와 simulation은 빠진다.
    - `planned_arrival`이 `as_of + horizon_days` 이후면 빠진다.
  - `test_tonnes_use_bl_then_planned_dangjin_only`: 당진 화물만 합산하고, `bl_t`를 먼저 쓴다.
  - `test_missing_eta_and_tonnes_go_to_gaps`: kind `no_eta`, `no_tonnes`가 적히고, 해당 항차는 `voyages`에 없다.
  - `test_yard_limits_allowed_berths`:
    - yard `'3'` → `allowed == ('BD-2','BD-3')`
    - yard 없음 → 세 부두 모두 허용, gap `no_yard`
  - `test_missing_demurrage_kept_with_gap`: `demurrage_usd_per_day`가 없으면 `voyages`에 남고 gap `no_demurrage`가 적힌다.
  - `test_fixed_without_end_blocks_to_grid_end`: berthed인데 `planned_unload_end`가 없으면 `Fixed.until is None`이고 gap `fixed_end_unknown`이 적힌다.
  - `test_vessel_size_gap_once`: kind `no_vessel_size`가 정확히 1개, message는 "선형 제한 미적용(선박 제원 없음)".
  - `test_stock_unknown_gap`: `stock=None, stock_gap="기준재고 없음"`이면 gap `stock_unknown`이 적힌다.

- [ ] **Step 2: 실행해 실패 확인**

  Run: `cd backend; .venv\Scripts\python -m pytest tests/test_berth_plan_inputs.py -q`
  Expected: `ModuleNotFoundError: midterm.berth_plan`

- [ ] **Step 3: 구현**
  - 시각:
    - `t0`는 `as_of`를 시 단위로 올린 값, `midnight`는 `as_of`의 KST 자정이다.
    - 시각 문자열은 `supply.timestamp`로 읽는다.
  - `read_stock`:
    - `web.supply_api.build_dashboard(h, as_of, None, adjust)`를 부른다. `h`는 30이고, 기간이 23일을 넘으면 60이다.
    - `adjust`는 `data['registry_planned']`에서 `exclude_voyages` 항차를 뺀다.
    - `base`는 결과의 `forecast[d].groups[g].stock`이다. `stock_days`는 하루 끝 값이다.
    - `denom[g][d]`는 `forecast[d+1..d+7].groups[g].burn`의 평균이다.
    - 다음 중 하나면 `(None, 사유, result)`를 돌려준다.
      - 어느 그룹이라도 기간 안 `stock`이나 `burn`이 `None`이다.
      - 어느 그룹이라도 `groups[].stale`이다.
    - 세 번째 값은 `danger_days`·`normal_days`를 꺼내는 데 쓴다. 결과에 config가 없으면 `supply.DEFAULTS`를 쓴다.
  - `load_inputs`:
    - `voyage_registry.snapshot(db_path)`로 1차 대상을 정한다.
    - 이어서 `read_stock`을 부르고 `build_inputs`를 호출한다.

- [ ] **Step 4: 통과 확인**

  같은 명령을 다시 실행한다. Expected: 전부 PASS

- [ ] **Step 5: 커밋**

  `git add backend/src/midterm/berth_plan/__init__.py backend/src/midterm/berth_plan/inputs.py backend/tests/test_berth_plan_inputs.py`
  메시지: `feat(berth-plan): collect berth recommendation inputs`

### Task 2: MILP와 일정 평가 (`solve.py`)

**Files:**
- Create: `backend/src/midterm/berth_plan/solve.py`
- Test: `backend/tests/test_berth_plan_solve.py`

**Interfaces:**
- Consumes: Task 1의 `BerthInputs`, `Voyage`, `Berth`, `Outage`, `unload_hours`
- Produces:
  ```python
  @dataclass
  class Assignment:
      voyage_no: str; berth_id: str | None; berth_at: datetime | None; unload_end: datetime | None
      fixed: bool = False

  @dataclass
  class OptionResult:
      status: str            # 'optimal' | 'time_limit' | 'infeasible'
      gap_pct: float | None; assignments: list[Assignment]; danger_violated: bool; message: str | None

  def occupancy(v: Voyage, berth: Berth, start: datetime, outages: list[Outage]) -> datetime  # 하역완료 시각
  def solve_option(inputs: BerthInputs, caution_weight_usd: float, locks: list[dict] = (),
                   time_limit_s: float = 30.) -> OptionResult
  def evaluate(inputs: BerthInputs, assignments: list[Assignment]) -> dict
  ```
- `evaluate`의 반환 키: `demurrage_hours`, `demurrage_usd`, `min_days`, `caution_days`, `danger_days`, `per_voyage`.
  - `per_voyage`는 `{voyage_no: {"demurrage_hours", "demurrage_usd"}}`이다.
  - 재고를 모르면 `min_days`, `caution_days`, `danger_days`는 `None`이다.
- `locks`의 원소는 `{"voyage_no": str, "berth_id": str, "berth_at": datetime}`이다. 검증은 Task 3·4에서 한다.

- [ ] **Step 1: 실패하는 시험 작성**

  `make_inputs(...)` 도우미로 `BerthInputs`를 직접 만든다. 재고는 `StockSeries`를 손으로 준다.
  - `test_hand_example_three_ships_two_berths`:
    - 부두 X·Y: 각 1000 t/h, 24 h/일
    - 배 a: ETA 0시, 24000 t, 허용정박 0, 24,000 USD/일
    - 배 b: ETA 0시, 24000 t, 허용정박 0, 48,000 USD/일
    - 배 c: ETA 0시, 12000 t, 허용정박 0, 24,000 USD/일
    - 기대:
      - b와 c가 0시에 서로 다른 부두에서 시작하고, a는 c와 같은 부두에서 12시에 시작한다.
      - 최소 체선료는 a의 12시간 × 1,000 USD/h = 12,000 USD다. 비교로, b·a를 먼저 넣으면 c가 24시간 기다려 24,000 USD가 된다.
      - `status == 'optimal'`
      - `evaluate(...)["demurrage_usd"] == 12000`
  - `test_caution_penalty_changes_order`:
    - 한 부두, 배 p(그룹 g14, ETA 0시, 체선료 큼)와 q(그룹 g58, ETA 1시, 체선료 작음).
    - g58 재고만 `normal_days` 아래로 떨어지게 `base`·`denom`을 정한다.
    - `caution_weight_usd=0`이면 p가 먼저다.
    - `caution_weight_usd=20000`이면 q가 먼저이고, `evaluate`의 `caution_days`가 더 적다.
  - `test_no_start_before_eta`
  - `test_berth_yard_rule`: yard '3' 배는 BD-1에 가지 않는다.
  - `test_outage_forbids_start_and_extends_unload`:
    - 정비 2~4시, 6시간 하역을 1시에 시작하면 `occupancy == 1시 + 6 + 2 = 9시`.
    - 정비 중에는 시작하지 않는다.
  - `test_fixed_occupancy_blocks_berth`: 고정 점유 끝이 10시면 그 부두의 시작은 10시 이후다.
  - `test_arrived_before_as_of_counts_wait_from_eta`: ETA = as_of − 5 h, 허용정박 0이면 시작은 `t0`이고 체선 시간은 5 이상이다.
  - `test_unload_past_horizon_blocks_berth_but_not_stock`:
    - 10시간 하역을 기간 끝 2시간 전에 시작한다.
    - 부두는 기간 뒤 8시간까지 막힌다.
    - 그 입하는 `base`에 더해지지 않는다.
  - `test_missing_demurrage_excluded_from_cost_but_assigned`: 그 배는 `assignments`에 있고, `per_voyage` 체선료는 `None`이다.
  - `test_danger_relaxed_when_unavoidable`: 0일차 재고가 이미 위험이면 `danger_violated is True`, status는 `optimal`이다.
  - `test_lock_respected`: lock의 시각과 부두가 그대로 나온다.

- [ ] **Step 2: 실패 확인**

  Run: `pytest tests/test_berth_plan_solve.py -q`
  Expected: ImportError

- [ ] **Step 3: 구현**
  - **변수** `x[v,b,s]` (이진): 배 v가 부두 b에서 슬롯 s에 하역을 시작한다.
  - **시작 후보:**
    - 범위는 `max(ceil(eta), t0)`부터 `min(t0 + 24·horizon_days − 1, 그 시각 + 168 h)`까지.
    - 정비 시간은 뺀다. `allowed` 부두만 쓴다.
  - **격자:** 기간 + 7일까지 둔다(기간 뒤 점유 계산용).
  - **제약:**
    - 배마다 Σx = 1.
    - 부두·시각마다 그 시각을 점유하는 x 합 ≤ 1 − 고정점유(0/1). `until is None`이면 격자 끝까지 점유로 본다.
    - lock은 해당 x 하나만 남긴다.
  - **체선 계수** = `max(0, s − eta − laytime) / 24 × rate`. `laytime`이나 `rate` 중 하나라도 없으면 0.
  - **재고식:** 그룹 g, 날짜 d마다 `base[g][d] + Σ tonnes·x`. 하역완료 날짜 ≤ d이고 하역완료 < 기간 끝인 x만 더한다.
  - **주의·위험 변수** (`denom > 0`인 날만 둔다):
    - `y[g,d]` (주의, 이진): 재고식 + `normal·denom·y ≥ normal·denom`, 비용 `caution_weight_usd`.
    - `z[g,d]` (위험 위반, 이진): 재고식 + `danger·denom·z ≥ danger·denom`, 비용 1e8.
    - 판정: 설계 4.1-6의 "풀 수 없으면 벌점으로 다시 풀기"를 큰 벌점 z로 한 번 푸는 것으로 대신한다. 풀 수 있는 경우에는 같은 답이 나온다.
    - `danger_violated = any(z)`.
    - 재고가 `None`이면 y·z를 두지 않는다.
  - **풀이:** `scipy.optimize.milp(..., options={"time_limit": time_limit_s})`

    | 결과 | status | gap_pct |
    |---|---|---|
    | status 0 | `optimal` | 0 |
    | status 1이고 해 있음 | `time_limit` | `res.mip_gap × 100` |
    | 해 없음 | `infeasible` | `None` |

- [ ] **Step 4: 통과 확인**

  Expected: PASS

- [ ] **Step 5: 커밋**

  메시지: `feat(berth-plan): time-indexed MILP and schedule evaluation`

### Task 3: 원인 판정과 세 안 조립 (`explain.py`, `plan.py`)

**Files:**
- Create: `backend/src/midterm/berth_plan/explain.py`, `backend/src/midterm/berth_plan/plan.py`
- Modify: `backend/src/midterm/berth_plan/__init__.py`에 `from .plan import recommend_berth_plan`
- Test: `backend/tests/test_berth_plan.py`

**Interfaces:**
- Consumes: Task 1·2 전부
- Produces:
  ```python
  def reasons(inputs: BerthInputs, assignments: list[Assignment]) -> dict[str, list[str]]
      # voyage_no → ['berth_busy' | 'outage' | 'stock_priority:<voyage_number>']
  def current_plan(inputs: BerthInputs) -> list[Assignment]
  def recommend_berth_plan(inputs: BerthInputs, penalty_usd: float = 20000., locks: list[dict] = (),
                           time_limit_s: float = 30.) -> dict   # 설계 5절 JSON
  ```

- [ ] **Step 1: 실패하는 시험 작성**
  - **원인 판정 3종:** `test_reasons_berth_busy`, `test_reasons_outage`, `test_reasons_stock_priority_names_other_voyage`. 일정을 손으로 주고 원인을 확인한다. 정의:

    | 원인 | 조건 |
    |---|---|
    | `berth_busy` | 체선이 있고, ETA~접안 사이 모든 허용 부두의 매 시각이 다른 배나 고정 점유로 차 있다 |
    | `outage` | 고른 부두에서 ETA~접안 사이에 정비 시간이 있다 |
    | `stock_priority:<번호>` | ETA가 더 늦은 다른 배가 같은 허용 부두에서 이 배보다 먼저 시작했다 |

  - `test_current_plan_uses_registry_values`:
    - `current_berth`·`current_berth_at`이 있는 배는 그 값을 그대로 쓴다.
    - 하역완료는 `current_unload_end`, 없으면 `occupancy`로 계산한다.
    - 값이 비어 있으면 `berth_id None`(미배정)이다.
  - `test_three_options_and_ranking`:
    - 결과 `options`의 id 순서는 `['B','A','C']`(또는 합쳐진 것)이다.
    - B, 또는 B를 포함한 합친 안이 `rank == 1`이다.
    - 라벨은 "B. 균형" 등이다.
  - `test_identical_options_merged`: 체선·재고 차이가 없는 입력이면 `options`는 1개, `merged == ['A','B','C']`, label은 "세 안 같음 · 체선·재고 차이 없음".
  - `test_stock_unknown_only_option_a`: `inputs.stock is None`이면 options는 A 하나이고 `kpis.min_days is None`이다.
  - `test_no_targets_returns_empty_options`: 대상이 0척이면 `options == []`, `message == "기간 안 입항 예정 선박 없음"`.
  - `test_changed_flag_and_delta`:
    - 현재 계획과 부두가 다르거나 접안 시각이 1시간 이상 다르면 `changed True`.
    - `kpis.demurrage_usd_delta` = 안 체선료 − 현재 체선료.
  - `test_fixed_assignments_included`: 고정 점유 항차가 각 안의 `assignments`에 `fixed: true`로 들어 있다.
  - `test_conflicting_lock_gives_infeasible_option`: 고정 점유 시간대로 lock을 걸면 그 안은 `status == 'infeasible'`이고 `message`가 있으며 예외가 나지 않는다.
  - `test_assumptions_and_gaps`:
    - `assumptions`에 "부두 능력: 시연용 가정값", "ETA 기산 가정", "벌점 단가 20,000 USD/그룹·일(가정값)"이 있다.
    - 위험 기준을 어긴 안의 `warnings`에 "위험 기준을 지킬 수 없음"이 있다.

- [ ] **Step 2: 실패 확인**

  Run: `pytest tests/test_berth_plan.py -q`
  Expected: ImportError

- [ ] **Step 3: 구현**
  - **안 정의:** `[("A","A. 체선 최소",0), ("B","B. 균형",penalty), ("C","C. 재고 우선",10·penalty)]`. 재고를 모르면 A만 푼다.
  - **같은 안 판정:** 키는 `(voyage_no, berth_id, berth_at)` 집합이다.
  - **합친 라벨:** 두 안이면 `"A·B 같음"` 식, 세 안이면 위 고정 문구.
  - **순위:** B를 포함한 안이 1순위, 나머지는 A, C 순.
  - **시각:** `isoformat()` (KST 오프셋 포함).
  - **source:** `{"berths": "dummy", "voyages": "registry", "stock": "supply_ledger"}`
  - **assignment 필드:** 설계 5절 그대로 (`tonnes`, `eta`, `yard`, `vessel_name`, `voyage_number`, `reasons`, `changed`, `fixed`).

- [ ] **Step 4: 통과 확인**

  Expected: PASS

- [ ] **Step 5: 커밋**

  메시지: `feat(berth-plan): compare three objective options against current plan`

### Task 4: API (`web/berth_plan_api.py`)

**Files:**
- Create: `backend/src/midterm/web/berth_plan_api.py`
- Modify: `backend/src/midterm/web/app.py` (`stacking_router` 등록 바로 아래)
- Test: `backend/tests/test_berth_plan_api.py`

**Interfaces:**
- Consumes: `inputs.load_inputs(db_path, as_of, horizon_days)`, `plan.recommend_berth_plan(inputs, penalty_usd, locks)`
- Produces:
  - `router = APIRouter(prefix="/api/berth-plan")`
  - `get_berth_plan_path(request) -> Path` (stacking의 `get_stacking_paths`와 같은 방식)
  - `POST /recommend`

- [ ] **Step 1: 실패하는 시험 작성**

  `test_stacking_api.py`처럼 `from test_supply_api import client`를 재사용한다. `berth_plan_api.load_inputs`는 고정 `BerthInputs`를 돌려주도록 monkeypatch한다.
  - `test_requires_login`: 로그인하지 않으면 401.
  - `test_default_body`: `{}` → 200, `horizon_days == 14`, `options`가 있다.
  - `test_invalid_inputs_422` (parametrize), 다음 각 경우 422:
    - `horizon_days`가 0, 31, "x"
    - `penalty_usd`가 −1
    - `locks`가 리스트가 아니다.
    - `locks` 원소가 모르는 항차다.
    - `locks` 원소가 모르는 부두다.
    - `locks` 원소의 부두가 저탄장과 맞지 않는다.
    - `locks` 원소의 시각이 ETA 전이다.
    - `locks` 원소의 시각 형식이 틀렸다.
  - `test_does_not_write`: `voyage_registry.commit`, `voyage_registry.purge`, `stock_baseline` 저장 함수를 호출되면 실패하도록 monkeypatch한 뒤에도 200.
  - `test_registry_error_is_reported`: `load_inputs`가 `RegistryError`를 내면 그 status와 문구를 돌려주고, 합성 결과는 없다.

- [ ] **Step 2: 실패 확인**

  Run: `pytest tests/test_berth_plan_api.py -q`
  Expected: 404 또는 ImportError

- [ ] **Step 3: 구현**
  - 로그인을 확인하고 rate limit을 건다 (`"berth-plan:"+user_id`, 20회/60초).
  - `as_of = supply.now()`.
  - 입력 검증 실패는 422.
  - 그 밖의 예외는 로그를 남기고 500 "내부 오류(서버 로그 확인)".

- [ ] **Step 4: 통과 확인**

  Expected: PASS

- [ ] **Step 5: 커밋**

  메시지: `feat(berth-plan): read-only recommend API`

### Task 5: 운영 도우미 도구 `optimize_berth_schedule`

**Files:**
- Modify: `backend/src/midterm/assistant/tools.py` (`recommend_stacking` ToolSpec 다음)
- Test: `backend/tests/test_assistant_tools.py`에 시험 추가

**Interfaces:**
- Consumes: `load_inputs`, `recommend_berth_plan`, `ToolContext.db_path`, `ToolContext.now`, `_ok`, `_fail`
- Produces:
  - 도구 이름 `optimize_berth_schedule`
  - 인자 `{horizon_days?: int 1~30, penalty_usd?: number ≥ 0}`
  - 반환 `_ok(as_of, "berth_plan", result)`

- [ ] **Step 1: 실패하는 시험 작성**

  `test_optimize_berth_schedule_tool`: `load_inputs`를 monkeypatch한 뒤 확인한다.
  - `run_tool("optimize_berth_schedule", {}, ctx)` → `ok True`, `data.options[0].rank == 1`
  - `{"horizon_days": 40}` → `ok False`
  - 도구 설명에 "읽기 전용"과 "1순위"가 들어 있다.

- [ ] **Step 2: 실패 확인**

  Run: `pytest tests/test_assistant_tools.py -q -k berth`
  Expected: FAIL

- [ ] **Step 3: 구현**
  - 설명 문구: "입항 예정 배의 부두·접안 시각을 체선료와 재고 위험으로 세 안 추천한다(읽기 전용). 답은 1순위 안을 중심으로 하고 다른 안의 차이와 gaps를 함께 말한다."
  - `test_assistant_tools.py`에 도구 수나 이름 목록을 단정하는 시험이 있으면 함께 갱신한다.

- [ ] **Step 4: 통과 확인**

  Run: backend 전체 `pytest -q`
  Expected: PASS

- [ ] **Step 5: 커밋**

  메시지: `feat(assistant): optimize_berth_schedule tool`

### Task 6: 프런트 도메인 (`src/domain/berth-plan.ts`)

**Files:**
- Create: `src/domain/berth-plan.ts`, `tests/berth-plan.test.ts`
- Modify: `package.json`의 "test" 목록에 `tests/berth-plan.test.ts` 추가

**Interfaces:**
- Produces:
  ```ts
  export interface BerthAssignment { voyage_no: string; voyage_number: string | null; vessel_name: string | null;
    yard: string | null; berth_id: string | null; eta: string; berth_at: string | null; unload_end: string | null;
    tonnes: number; demurrage_hours: number | null; demurrage_usd: number | null; reasons: string[];
    changed: boolean; fixed: boolean }
  export interface BerthKpis { demurrage_hours: number; demurrage_usd: number; min_days: number | null;
    caution_days: number | null; danger_days: number | null; demurrage_usd_delta?: number }
  export interface BerthOption { id: string; rank: number; label: string; merged: string[];
    status: 'optimal' | 'time_limit' | 'infeasible'; gap_pct: number | null; message?: string | null;
    kpis: BerthKpis | null; warnings: string[]; assignments: BerthAssignment[] }
  export interface BerthGap { kind: string; voyage_no: string | null; message: string }
  export interface BerthPlanResult { as_of: string; horizon_days: number; source: Record<string, string>;
    assumptions: string[]; gaps: BerthGap[]; message?: string | null;
    current: { label: string; kpis: BerthKpis; assignments: BerthAssignment[] } | null; options: BerthOption[] }

  // 형식이 다르면 Error('접안 추천 응답 형식이 올바르지 않습니다')
  export function parseBerthPlan(raw: unknown): BerthPlanResult
  export function fetchBerthPlan(body: { horizon_days?: number; penalty_usd?: number }, signal?: AbortSignal): Promise<BerthPlanResult>
  // berth_busy → "부두 모두 사용 중", outage → "정비", stock_priority:N → "재고 우선(N 먼저)"
  export function reasonLabel(code: string): string
  // rank 1 안의 id, 없으면 null
  export function defaultOptionId(r: BerthPlanResult): string | null
  ```
- `fetchBerthPlan`은 `authJson('/api/berth-plan/recommend', {method:'POST', ...})`를 부른 뒤 `parseBerthPlan`을 거친다.

- [ ] **Step 1: 실패하는 시험 작성**
  - 정상 응답은 통과한다.
  - `options`가 없거나 `kpis.demurrage_usd`가 문자열이면 throw한다.
  - `reasonLabel('stock_priority:26-2-003') === '재고 우선(26-2-003 먼저)'`
  - `defaultOptionId`는 rank 1 안의 id를 돌려준다. options가 비어 있으면 null이다.

- [ ] **Step 2: 실패 확인**

  Run: `npm.cmd test`
  Expected: 모듈 없음

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인**

  Run: `npm.cmd test`
  Expected: PASS

- [ ] **Step 5: 커밋**

  메시지: `feat(berth-plan): frontend domain types and API client`

### Task 7: 화면과 탭 연결

**Files:**
- Create: `src/features/berth-plan/BerthPlanWorkspace.tsx`, `src/features/berth-plan/BerthGantt.tsx`, `src/features/berth-plan/berth-plan.css`, `tests/berth-plan-ui.spec.ts`
- Modify:
  - `src/App.tsx`: 통합 시뮬레이션 탭 줄 (822행 부근)
  - `playwright.config.ts`: `testMatch`에 `"berth-plan-ui.spec.ts"` 추가

**Interfaces:**
- Consumes: Task 6 전부, `fetchStacking`(`src/domain/stacking-api.ts`), `StackingOptions`(`src/components/stacking/StackingOptions.tsx`), `ProcessingOrb`(`state="solving"`)
- Produces:
  - `export function BerthPlanWorkspace({ theme }: { theme: 'light' | 'dark' })`
  - `export function BerthGantt({ result, option, theme }: { result: BerthPlanResult; option: BerthOption; theme: 'light'|'dark' })`

- [ ] **Step 1: 실패하는 UI 시험 작성**

  `tests/integration-ui.spec.ts`의 로그인과 `page.route` 모킹 방식을 따른다.
  - `/api/berth-plan/recommend`: 고정 응답 (현재 계획 + A·B·C, B rank 1, gaps 2개)
  - `/api/stacking/recommend`: 적치 고정 응답

  시험 목록:
  - **"탭 진입"**: `#simulation`에서 "접안 추천" 탭을 누른다.
    - 카드 4개(현재 계획·B·A·C)가 보인다.
    - "추천" 표시는 B 카드에 있다.
    - "부두 능력 시연용 가정값"이 보인다.
  - **"카드 전환"**: A 카드를 누른다.
    - 표의 부두·접안 값이 A 응답으로 바뀐다.
    - 간트 막대 수가 A assignments 수와 같다.
  - **"합친 안"**: options 1개(`merged` 3개) 응답이면 "세 안 같음 · 체선·재고 차이 없음"이 보인다.
  - **"적치 추천 열기"**: 행의 "적치 추천"을 누르면 `voyage_no` 본문으로 호출하고 `StackingOptions` 내용이 보인다.
  - **"가정·빠진 자료"**: 접힘 칸을 열면 gaps 문구가 보인다.
  - **"오류 시 카드 없음"**: 500 응답이면 오류 문구만 보인다. 카드·간트가 없고 숫자 0도 표시되지 않는다.
  - **"빈 결과"**: `options: []`와 `message` 응답이면 "기간 안 입항 예정 선박 없음"이 보인다.
  - **"다시 계산"**: 기간 7일을 고르고 "다시 계산"을 누르면 요청 본문이 `horizon_days: 7`이다.
  - **"레이아웃"**:
    - 다크 테마에서 카드가 보인다.
    - 390px 폭에서 `document.documentElement.scrollWidth <= 390`이다(간트는 내부 가로 스크롤).
    - 1920×1080에서 카드와 간트가 첫 화면 안에 있다.

- [ ] **Step 2: 실패 확인**

  Run: `npm.cmd run test:ui -- berth-plan-ui.spec.ts`
  Expected: 탭이 없어 FAIL

- [ ] **Step 3: 구현**
  - **`App.tsx`:**
    - `simulationView: 'plan' | 'berth'` 상태를 둔다.
    - 탭 줄에서 "저장된 발전·수급 계획" 다음에 `<button aria-pressed={simulationView==='berth'}>접안 추천</button>`을 둔다.
    - 기존 첫 버튼은 `aria-pressed={simulationView==='plan'}`로 바꾼다.
    - `'berth'`이면 `PlanningWorkspace` 대신 `<BerthPlanWorkspace theme={theme}/>`를 그린다.
  - **`BerthPlanWorkspace`:**
    - 진입하면 한 번 계산한다.
    - 조회 막대:
      - 기준시각 `as_of`(KST)
      - 기간 선택 7·14·30
      - 벌점 단가 숫자 입력과 "가정값" 표시
      - "다시 계산"
    - 계산 중에는 `ProcessingOrb`를 보인다.
    - 카드 내용:
      - 이름, 추천 표시
      - 체선 시간·체선료
      - 최저 재고일수 (`null`이면 "미확인")
      - 주의·위험 일수
      - 현재 대비 체선료 차이
      - `status`가 `time_limit`이면 "최선해 · 차이 {gap}%", `infeasible`이면 "해 없음"과 `message`
    - 표 열: 항차번호, 선박, 저탄장, 물량, ETA, 부두, 접안, 하역완료, 체선(시간·USD), 원인, 변경.
    - 고정 점유 행은 "고정"으로 표시한다.
    - 행마다 "적치 추천" 버튼을 둔다. 누르면 행 아래에 `StackingOptions compact`를 연다.
    - `<details>` "가정·빠진 자료"를 둔다.
  - **`BerthGantt`** (SVG):
    - 부두 3줄, 선택한 안의 막대(저탄장별 색)
    - 현재 계획 막대는 흐린 테두리로 겹친다.
    - 정비는 빗금 패턴, ETA는 점, 체선 구간은 줄무늬, 고정 점유는 회색.
    - 바깥 `div.gf-bp-gantt-scroll`에 `overflow-x: auto`를 준다.
  - **CSS**는 기존 토큰 변수만 쓰고, 라이트/다크 모두 확인한다.

- [ ] **Step 4: 통과 확인**

  Run: `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:ui`
  Expected: 전부 PASS. 브라우저에서 라이트·다크 화면을 직접 본다.

- [ ] **Step 5: 커밋**

  메시지: `feat(berth-plan): berth recommendation tab on integrated simulation`
  PR 본문에 `App.tsx`, `playwright.config.ts`, `package.json` 변경을 통합 담당자 검토 대상으로 표시한다.

### Task 8: ZGX 사본 풀이 시간 확인과 마무리

**Files:** 없음. 측정 결과는 PR 본문에 적는다.

- [ ] **Step 1: 사본 준비**

  ZGX DB를 읽기 전용으로 로컬 임시 폴더(scratchpad)에 복사한다. ZGX에는 쓰지 않는다.

- [ ] **Step 2: 측정**

  사본 경로로 `load_inputs` + `recommend_berth_plan`을 14일·30일로 실행한다. 다음을 기록한다.
  - 안별 풀이 시간
  - 대상 척수
  - status
  - gaps 종류

  목표: 14일에서 각 안 30초 안.
  - 주의: `read_stock`은 기본 DB 경로(`database.DATABASE`)를 읽는다. 측정할 때만 환경변수나 monkeypatch로 사본을 가리키게 하고, 그 방법을 PR에 적는다.

- [ ] **Step 3: 결과 판단**
  - 30초를 넘으면 시작 후보 창(168 h)을 줄이지 않는다. `time_limit` 결과와 gap %를 PR에 그대로 적는다.
  - 세 안이 합쳐지면 그 사실과 원인(더미 허용정박 72~120 h)을 적는다.

- [ ] **Step 4: 전체 검증**

  Run: backend `pytest -q`, `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:ui`, `git diff --check`
  Expected: 전부 통과
