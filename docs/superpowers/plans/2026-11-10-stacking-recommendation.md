# 하역 대기 화물 적치 추천 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하역 대기 화물(시나리오 선박·원장 항차)에 대해 저탄장 빈 구간·빈 칸 적치안을 최대 3개 추천하고, 같은 계산을 화면 API와 운영 도우미가 함께 쓴다.

**Architecture:** 백엔드 패키지 `midterm.stacking`(배치 설정·빈 곳 계산·추천·원장 변환)을 만들고, `web/stacking_api.py`와 도우미 도구 3개가 이를 호출한다. 프런트는 `src/domain/stacking.ts`에 타입·호출·주소 변환을 두고, 발전소 전망 선박 목록·부두 화면·저탄장 화면이 그것을 쓴다. 화면끼리 import하지 않고 `App.tsx`가 저탄장 이동 주소(`#yard?stack=`)를 넘긴다.

**Tech Stack:** Python 3 / FastAPI / pydantic / pytest, React + TypeScript / Vite, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-10-stacking-recommendation-design.md`

## Global Constraints

- 사용자에게 보이는 문구는 모두 한국어. 코드 식별자·커밋 메시지는 영어.
- 추천은 읽기 전용. 재고·원장·기준재고 저장 함수를 호출하지 않는다.
- 모든 숫자는 계산 결과에서만. 자료가 없으면 합성 값으로 대신하지 않는다.
- 데이터 계약(plant_id, stockpile_id, destination_plant_id, t, kcal/kg, KST)을 바꾸지 않는다.
- 화면끼리 직접 import 금지. 계산·타입은 `src/domain/`, 공통 표시는 `src/components/`, 연결은 `App.tsx`.
- 기능 CSS는 해당 기능 폴더에 전용 클래스명으로. 전역 요소 선택자 금지. 라이트/다크·390px 가로 넘침 없음.
- 새 의존성 금지.
- 시험: 각 단계 시험을 먼저 쓰고 실패를 확인한 뒤 구현. Windows에서는 `npm.cmd`, 백엔드 시험은 `backend` 폴더에서 `X:\IDEWorkspace\ws_codex\Hackathon_EWP\backend\.venv\Scripts\python.exe -m pytest`. `test:ui`는 `AUTH_TEST_PYTHON`을 같은 python으로 지정. 로컬 venv에 `highspy`가 없어 `tests/test_headroom_uc.py`·`test_annual_headroom.py` 2건은 원래 실패한다.
- 이번 작업 파일만 지정해 stage. `git add .` 금지. 커밋 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 추천 결과 옵션 최대 3개, 나눠 내리기 최대 2곳, 제안 길이 0.5 m 단위 올림, 물량 범위 0 초과 1,000,000 t 이하, API 요청 제한 사용자별 60회/60초.

## Review Focus

1. 물량 0 t인 기준재고 원탄 — 자리를 차지하지 않는 것으로 본다(빈 곳). Task 2 시험 `test_zero_tonne_lot_does_not_occupy`.
2. 등급이 비어 있는 이웃 원탄 — 제외하지 않고 경고 "옆 구간 원탄 등급 미확인"을 붙인다. Task 3 시험 `test_unknown_neighbour_grade_warns`.
3. 구간이 Pile 길이를 넘거나(`end_m > length_m`) 서로 겹치는 원탄 — 겹침은 합쳐서 빼고, 길이 밖은 길이에서 자른다. Task 2 시험 `test_overlap_and_out_of_range_intervals`.
4. 같은 항차 번호의 원탄이 이미 있는 빈 구간 옆 — 다른 항차 규정과 무관하게 빈 구간만 쓰므로 허용(같은 항차 판정 불필요). Task 3 시험 `test_same_voyage_neighbour_allowed`.
5. 원장 항차의 화물 `planned_t`·`bl_t`가 모두 없을 때 — 추천하지 않고 "화물 물량 미확인". Task 4 시험 `test_missing_tonnes_blocks`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `backend/src/midterm/stacking/__init__.py` | 공개 함수 재노출 |
| `backend/src/midterm/stacking/layout.json` | 모의 배치 설정(Pile 길이 등) — 프런트 사본 `src/data/fuel-reference/stacking-layout.json`과 같은 내용 |
| `backend/src/midterm/stacking/layout.py` | 설정·반입 경로 읽기 |
| `backend/src/midterm/stacking/space.py` | 기준재고 → Pile 빈 구간·Shed 빈 칸 |
| `backend/src/midterm/stacking/recommend.py` | 후보 필터·배치안·점수·결과 |
| `backend/src/midterm/stacking/registry_cargo.py` | 원장 항차 → CargoRequest, 하역 대기 항차 목록 |
| `backend/src/midterm/web/stacking_api.py` | API 2개 |
| `backend/src/midterm/assistant/tools.py` | 도구 3개 추가 |
| `backend/src/midterm/assistant/checks.py` | 점검 항목 2개 |
| `backend/src/midterm/web/ops_assistant_api.py` | 맥락 키 추가 |
| `src/domain/stacking.ts` | 타입·API 호출·시나리오 변환·주소 변환 |
| `src/components/stacking/StackingOptions.tsx` + `stacking.css` | 추천안 표시(선박 목록·부두 공통) |
| `src/features/forecast/DemoForecast.tsx` | 선박 행 버튼·펼침 |
| `src/features/berth/OperationsBerth.tsx` | 한 줄 추천 |
| `src/features/stockyard/OperationsYard.tsx` + `operations-yard.css` | 제안 구간 안내 칸 |
| `src/App.tsx` | `?stack=` 읽기, 이동 콜백 |

---

### Task 1: 배치 설정과 반입 경로 읽기

**Files:**
- Create: `backend/src/midterm/stacking/__init__.py`, `backend/src/midterm/stacking/layout.json`, `backend/src/midterm/stacking/layout.py`, `src/data/fuel-reference/stacking-layout.json`
- Test: `backend/tests/test_stacking_layout.py`, `tests/operations-workspaces.test.ts`(사본 일치 시험 추가)

**Interfaces:**
- Produces:
  - `load_layout(path: Path | None = None) -> dict` — 키: `classification`("모의"), `piles`(`{"P1": {"length_m": 420}, …, "P8": {"length_m": 720}}`), `default_t_per_m`, `min_gap_m`, `shed_cell_t`, `old_age_days`, `hot_temperature_c`, `sources`(문자열 목록). 값이 없거나 형식이 틀리면 `ValueError`.
  - `load_routes(path: Path | None = None) -> dict[int, set[str]]` — `src/data/fuel-reference/demo-catalog.json`의 `routes`에서 `{1: {"P1",…,"P6","A","B"}, …}`. 엔드포인트 `pile-n` → `"Pn"`, `shed-a` → `"A"`, `shed-b` → `"B"`. 기본 경로는 저장소 루트 기준 `src/data/fuel-reference/demo-catalog.json`(`Path(__file__).resolve().parents[4]`).

- [ ] **Step 1: 실패하는 시험 작성**

```python
# backend/tests/test_stacking_layout.py
from midterm.stacking.layout import load_layout, load_routes

def test_layout_values():
    layout = load_layout()
    assert layout['classification'] == '모의'
    assert [layout['piles'][f'P{i}']['length_m'] for i in range(1, 9)] == [420] * 4 + [720] * 4
    assert layout['default_t_per_m'] == 150 and layout['min_gap_m'] == 5 and layout['shed_cell_t'] == 30000
    assert layout['old_age_days'] == 30 and layout['hot_temperature_c'] == 40

def test_routes_from_catalog():
    routes = load_routes()
    assert routes[1] == {'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'A', 'B'}
    assert routes[2] == routes[3] == {'P1', 'P2', 'P5', 'P6', 'P7', 'P8', 'A', 'B'}

def test_bad_layout_rejected(tmp_path):
    bad = tmp_path / 'layout.json'
    bad.write_text('{"classification": "모의", "piles": {}}', encoding='utf-8')
    import pytest
    with pytest.raises(ValueError):
        load_layout(bad)
```

```ts
// tests/operations-workspaces.test.ts 끝에 추가 (기존 dangjin_berths 사본 시험과 같은 read 도우미 사용)
test('stacking layout copies stay identical', () => {
  assert.deepEqual(read('../backend/src/midterm/stacking/layout.json'), read('../src/data/fuel-reference/stacking-layout.json'));
});
```

- [ ] **Step 2: 실패 확인** — `python -m pytest tests/test_stacking_layout.py -q` → ModuleNotFoundError. `node --experimental-strip-types --test tests/operations-workspaces.test.ts` → 파일 없음.
- [ ] **Step 3: 구현** — 두 JSON 사본을 같은 내용으로 만든다(`sources`에 "P1~P4 길이: yard-snapshot.js 구간 최대 420 m", "P5~P8 길이: yard2-calibration.js lengthM 720", "m당 톤수·Shed 칸 용량: 모의 값"). `layout.py`는 필수 키·양수 검사.
- [ ] **Step 4: 통과 확인** — 위 두 명령 PASS.
- [ ] **Step 5: 커밋** — `feat(stacking): add mock yard layout and berth route loader`

---

### Task 2: 빈 구간·빈 칸 계산

**Files:**
- Create: `backend/src/midterm/stacking/space.py`
- Test: `backend/tests/test_stacking_space.py`

**Interfaces:**
- Consumes: `load_layout()`의 dict.
- Produces:
  - `grade_of(value: str | None) -> "고" | "저" | None` — `"고…"`→`"고"`, `"저…"`→`"저"`.
  - `yard_space(lots: list[dict], layout: dict) -> dict` — 반환:
    - `piles`: `{"P1": {"yard": 1, "length_m": 420, "t_per_m": float, "t_per_m_mock": bool, "lots": [Seg], "gaps": [(from_m, to_m)], "unplaced": bool}, …}`
    - `sheds`: `{"A": {"cells": {1: Seg | None, …, 10: …}}, "B": {…}}`
    - `Seg` = `{"from_m", "to_m", "grade", "age_days", "temperature_c", "voyage_number", "coal_name", "tonnes"}`(Shed는 from/to 없음)
  - 원탄 위치: `location` `P1~P8` → Pile(1~4는 1저탄장, 5~8은 2저탄장), `A1~B10` → Shed 칸. 물량 0 이하 원탄은 무시.

- [ ] **Step 1: 실패하는 시험 작성** — 시험 이름과 기대값:
  - `test_gaps_between_and_at_ends`: P1(420 m)에 [30,110],[230,300] → gaps `[(0,30),(110,230),(300,420)]`.
  - `test_gap_shorter_than_min_dropped`: [0,100],[103,420] → gaps `[]`(3 m < 5 m).
  - `test_overlap_and_out_of_range_intervals`: [100,200],[150,250],[400,450] → gaps `[(0,100),(250,400)]`.
  - `test_t_per_m_from_lots`: P1에 17068 t/[330,420], 6085 t/[230,280] → `t_per_m == (17068+6085)/(90+50)`, `t_per_m_mock is False`.
  - `test_empty_pile_uses_mock_t_per_m`: P5 원탄 없음 → `t_per_m == 150`, `t_per_m_mock is True`, gaps `[(0,720)]`.
  - `test_unplaced_lot_marks_pile`: P6에 `start_m` 없는 원탄 → `piles['P6']['unplaced'] is True`.
  - `test_zero_tonne_lot_does_not_occupy`: P2에 0 t [0,420] → gaps `[(0,420)]`.
  - `test_shed_cells`: A1, A2 원탄, B 없음 → `sheds['A']['cells'][1]`은 Seg, `[3]`은 None, `sheds['B']['cells']` 모두 None.
  - `test_grade_of`: `'고열량'→'고'`, `'저열'→'저'`, `None→None`, `''→None`.
- [ ] **Step 2: 실패 확인** — `python -m pytest tests/test_stacking_space.py -q` → ImportError.
- [ ] **Step 3: 구현** — 구간은 [0,length]로 자른 뒤 정렬·병합해 여집합을 구한다.
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `feat(stacking): compute free pile segments and shed cells from the yard baseline`

---

### Task 3: 추천 계산

**Files:**
- Create: `backend/src/midterm/stacking/recommend.py`
- Modify: `backend/src/midterm/stacking/__init__.py`(재노출)
- Test: `backend/tests/test_stacking_recommend.py`

**Interfaces:**
- Consumes: `yard_space`, `grade_of`, `load_layout`, `load_routes`.
- Produces:
  - `validate_cargo(raw: dict) -> dict` — 3절 CargoRequest 검사. 틀리면 `ValueError`(한국어 메시지). `tonnes` 0 초과 1,000,000 이하, `berth` 1~3, `destination_yard` 1~3 또는 None, `grade` "고"/"저"/None, `source` "scenario"/"registry".
  - `recommend(cargo: dict, baseline: dict, layout: dict, routes: dict[int, set[str]]) -> dict` — `baseline`은 `read_baseline()` 반환값. 결과(스펙 5.4) 키: `as_of`, `cargo`, `options`, `no_fit`, `gaps`, `blocked`.
    - `blocked`: 추천하지 않는 이유 문자열 또는 None. 기준재고 원탄이 없으면 `"기준재고 없음"`, `grade`가 None이면 `"고/저 구분 미확인"`. `blocked`가 있으면 `options == []`, `no_fit is None`.
    - `options[i]`: `{"rank", "placements": [{"yard", "target", "from_m", "to_m", "tonnes"}], "reasons", "warnings", "assumptions"}`. Pile target은 `"Pile 3"`, Shed는 `"Shed A 3칸"`(from/to는 None).
    - `no_fit`: `{"message": "들어갈 빈 곳 없음", "largest": placement | None}`.
    - `gaps`: `"구간 미확인: Pile n"` 등.
  - 상수 `MAX_OPTIONS = 3`.

알고리즘(스펙 5절, 시험이 정하지 않는 부분만):
- 자리 후보 = 반입 경로가 있는 Pile의 gap(Pile `unplaced`면 제외하고 gaps에 추가) + 경로가 있는 Shed의 빈 칸.
- 한 자리 안: Pile은 gap 시작점부터 길이 `ceil(tonnes / t_per_m / 0.5) * 0.5`(gap 길이 이하일 때만), Shed는 `tonnes <= shed_cell_t`.
- 이웃 = Pile에서 제안 구간 `[from, to]`와 `min_gap_m` 이내에 있는 원탄, Shed는 같은 Shed 번호 ±1 칸 원탄.
- 필수: 이웃 중 등급이 화물과 다른 원탄이 있으면 제외. 이웃 등급이 None이면 경고 `"옆 구간 원탄 등급 미확인"`.
- 위험 이웃: `age_days >= old_age_days` 또는 `temperature_c >= hot_temperature_c`. 경고 문구 `"옆 구간 {coal_name} 원탄 적치 {age_days}일"` 또는 `"옆 구간 {coal_name} 원탄 {temperature_c}°C"`.
- 한 자리 안이 하나도 없을 때만 두 자리 안: 같은 저탄장 안의 서로 다른 두 자리(첫 자리는 가득, 나머지를 둘째 자리).
- 정렬 키(오름차순): `(목적지 불일치 0/1, 자리 수, 위험 이웃 있음 0/1, 남는 용량 t)`. 같으면 target 이름순.
- `assumptions`: `"반입 경로 모의 설비"` 항상, Pile을 쓰면 `"Pile 길이 모의 값"`, `t_per_m_mock`인 Pile을 쓰면 `"모의 m당 톤수: Pile n"`, Shed를 쓰면 `"Shed 칸 용량 모의 값"`, 화물 `cv`가 None이면 warnings에 `"열량 미확인"`.
- `reasons`: 목적지 일치 시 `"{n}저탄장(목적지)"`, 한 자리면 `"한 곳에 모두 적치"`, 위험 이웃 없으면 `"옆 구간에 오래되거나 뜨거운 원탄 없음"`.
- `no_fit.largest`: 반입 경로·등급 조건을 지키는 자리 중 용량이 가장 큰 곳(전체 gap 기준 tonnes = 길이×t_per_m).

- [ ] **Step 1: 실패하는 시험 작성** — 기준재고 dict를 직접 만드는 `base(lots, as_of='2026-11-08')` 도우미와 `load_layout()`/`load_routes()` 실제 값 사용. 시험:
  - `test_single_fit_prefers_destination_yard`: 부두 1, 화물 저열 10,000 t, 목적지 2, P1·P5 모두 빈 → 1순위 target `"Pile 5"`, `reasons`에 `"2저탄장(목적지)"`.
  - `test_route_excludes_unreachable_pile`: 부두 2, 빈 곳이 P3뿐 → options 없음, `no_fit.message == "들어갈 빈 곳 없음"`.
  - `test_adjacent_other_grade_excluded_distant_allowed`: P1 [0,100] 고열, 나머지 빈, 화물 저열 6,000 t(t_per_m 150 → 40 m) → 제안 from_m ≠ 100(맞닿는 자리 제외). P1에 [300,420] 고열만 있을 때 [0,40] 제안은 허용.
  - `test_unknown_neighbour_grade_warns`: 이웃 grade None → 옵션 유지, warnings에 `"옆 구간 원탄 등급 미확인"`.
  - `test_same_voyage_neighbour_allowed`: 이웃이 같은 voyage_number·같은 등급 → 옵션 유지.
  - `test_risky_neighbour_ranks_lower`: 같은 조건의 두 gap 중 한쪽 이웃 age_days 40 → 그 안이 2순위, warnings에 `"적치 40일"` 포함.
  - `test_split_into_two_when_no_single_fit`: 1저탄장 빈 곳이 각각 5,000 t짜리 두 개, 화물 8,000 t, 목적지 1 → 1순위 placements 2개, tonnes 합 8,000.
  - `test_no_fit_reports_largest_gap`
  - `test_unplaced_pile_excluded_and_reported`: gaps에 `"구간 미확인: Pile 6"`.
  - `test_shed_empty_cell_and_capacity`: 부두 1, P 모두 가득, A3 빈, 화물 20,000 t → target `"Shed A 3칸"`, assumptions에 `"Shed 칸 용량 모의 값"`.
  - `test_blocked_without_grade_or_baseline`: grade None → `blocked == "고/저 구분 미확인"`; lots [] → `blocked == "기준재고 없음"`.
  - `test_missing_cv_warns`
  - `test_validate_cargo_rejects`: tonnes 0, 1,000,001, berth 4, grade "중" → ValueError.
  - `test_at_most_three_options_and_rounding`: 빈 곳 5곳 → `len(options) == 3`, Pile 제안 길이가 0.5 m 배수.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `feat(stacking): rank empty-space placements for waiting cargo`

---

### Task 4: 원장 항차 변환과 하역 대기 목록

**Files:**
- Create: `backend/src/midterm/stacking/registry_cargo.py`
- Test: `backend/tests/test_stacking_registry.py`

**Interfaces:**
- Consumes: `voyage_registry.snapshot(path)` 반환(`ships`, `voyages`, `cargo`), `read_baseline(path)`, `dummy_data.profiles.load_profiles()`의 `coals[name]['class']`.
- Produces:
  - `cargo_from_voyage(voyage_no: str, register: dict, baseline: dict, profiles: dict) -> tuple[dict | None, str | None]` — (CargoRequest, 막힌 이유). 막힌 이유 문구: `"항차 없음"`, `"당진행 화물 없음"`, `"한 항차 여러 탄종"`, `"부두 미배정"`, `"화물 물량 미확인"`, `"고/저 구분 미확인"`.
    - 물량: 화물마다 `planned_t`, 없으면 `bl_t`. 하나라도 둘 다 없으면 `"화물 물량 미확인"`.
    - 부두: `berth_id` `"BD-1"~"BD-3"` → 1~3.
    - grade: 기준재고에 같은 `coal_name` 원탄의 `grade_of(grade)`, 없으면 프로필 class(`high_cv`→고, `low_cv`→저), 없으면 None → `"고/저 구분 미확인"`.
    - `cv`: 화물 `cv`가 모두 같으면 그 값, 아니면 None. `destination_yard`: 원장 voyage `yard` 문자열에서 숫자 1~3을 읽고 없으면 None.
    - 반환 cargo의 `source` `"registry"`, `ref` voyage_no.
  - `waiting_voyages(register: dict, baseline: dict, profiles: dict) -> list[dict]` — 스펙 6절 조건의 항차마다 `{"voyage_no", "vessel_name", "cargo": dict | None, "blocked": str | None}`. 계획 입항 순.

- [ ] **Step 1: 실패하는 시험 작성** — register dict를 직접 만든다:
  - `test_sums_dangjin_cargo_and_maps_berth`: 화물 2건(당진 40,000 + 30,000, 타 발전소 10,000) → tonnes 70,000, berth 2(`BD-2`).
  - `test_mixed_coal_blocks` → `"한 항차 여러 탄종"`.
  - `test_missing_berth_blocks` → `"부두 미배정"`.
  - `test_missing_tonnes_blocks` → `"화물 물량 미확인"`.
  - `test_grade_from_baseline_then_profile`: 기준재고에 같은 탄종 '저열량' → `"저"`; 없고 프로필 `Glencore`(high_cv) → `"고"`.
  - `test_waiting_excludes_completed_unloaded_and_already_in_baseline`: arrived+berth+미하역 1건만 남고, `actual_unload_end` 있는 것, `status=completed`, 기준재고에 같은 voyage_number가 있는 것은 빠진다.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `feat(stacking): convert registry voyages into cargo requests`

---

### Task 5: API

**Files:**
- Create: `backend/src/midterm/web/stacking_api.py`
- Modify: `backend/src/midterm/web/app.py`(router 등록), `backend/src/midterm/web/auth_api.py:20`(`READ_POST`에 `'/api/stacking/recommend'`)
- Test: `backend/tests/test_stacking_api.py`

**Interfaces:**
- Consumes: Task 1~4 함수, `database.DATABASE`, `get_store(request).rate_limit(key, 60, 60)`.
- Produces:
  - `POST /api/stacking/recommend` — 본문은 CargoRequest 필드 또는 `{"voyage_no": str}`(둘 다 오면 422). 원장 항차가 막히면 `recommend` 대신 `{"as_of", "cargo": None, "options": [], "no_fit": None, "gaps": [], "blocked": 이유}`. 검사 오류 422, 그 밖의 예외는 로그 후 500 `"내부 오류(서버 로그 확인)"`.
  - `GET /api/stacking/candidates` → `{"as_of", "items": waiting_voyages(...)}`.
  - 둘 다 세션 없으면 401, 요청 제한 키 `"stacking:" + user_id`.
  - 경로 의존성 `get_stacking_paths()`(시험에서 격리 DB로 바꿈), 기본값 `database.DATABASE`.

- [ ] **Step 1: 실패하는 시험 작성** — 기존 `test_ops_assistant_api.py`의 앱·세션 준비 방식을 따른다:
  - `test_requires_login`(401 둘 다)
  - `test_recommend_scenario_cargo`(200, `options` 길이 1 이상, `as_of` == 기준재고 as_of)
  - `test_recommend_by_voyage_no_blocked_reason`(부두 없는 항차 → `blocked == "부두 미배정"`)
  - `test_invalid_body_422`(tonnes 0, 두 형식 동시)
  - `test_rate_limited_after_60`
  - `test_does_not_write`(`save_baseline`과 원장 commit 함수를 monkeypatch로 터뜨리는 함수로 바꿔도 200)
  - `test_csrf_required_for_post`: auth_api 경계가 READ_POST POST에 CSRF를 요구하는지(기존 `/api/assistant/ask` 시험과 같은 방식)
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 파일 + `tests/test_ops_assistant_api.py` + `tests/test_auth*.py`
- [ ] **Step 5: 커밋** — `feat(stacking): expose read-only recommendation and waiting-cargo APIs`

---

### Task 6: 운영 도우미 도구·맥락·점검

**Files:**
- Modify: `backend/src/midterm/assistant/tools.py`, `backend/src/midterm/assistant/checks.py`, `backend/src/midterm/web/ops_assistant_api.py:31`, `backend/tests/assistant_eval/questions.jsonl`
- Test: `backend/tests/test_assistant_tools.py`, `backend/tests/test_assistant_checks.py`, `backend/tests/test_ops_assistant_api.py`, `backend/tests/test_assistant_agent.py`

**Interfaces:**
- Consumes: Task 1~4.
- Produces:
  - 도구 `recommend_stacking`(인자: `voyage_no` 또는 CargoRequest 필드 — `vessel_name`, `coal_name`, `grade`, `cv`, `tonnes`, `berth`, `destination_yard`; `source`는 `voyage_no`가 있으면 registry, 없으면 scenario로 서버가 정함). 결과 `_ok(as_of, source, result)`, 막힌 경우도 ok로 돌려주고 `blocked`를 담는다. `cargo_grade` 등 맥락 이름이 아니라 위 이름을 쓴다.
  - 도구 `stacking_candidates`(인자 없음) → `_ok(as_of, "actual", {"items": …})`.
  - 도구 `recommend_blend`(인자 `tonnes`, `target_gcv_arb`, `gcv_tolerance`, `max_tm_ar`, `max_sulfur_ar`, 선택 `lot_ids` 최대 100) — 기준재고 원탄과 `match_lot_quality`로 lots를 만들어 기존 `recommend_blend` 호출(voyage_registry_api의 `blend_baseline_recommend`와 같은 변환을 함수로 뽑아 재사용). source `"actual"`.
  - `CONTEXT_KEYS`에 `vessel`, `voyage_no`, `cargo_grade`, `cargo_cv`, `cargo_t`, `berth`, `dest_yard` 추가.
  - 점검 항목(blend·forecast 화면): `stacking.mock_layout`(kind `dummy`, 제목 `"적치 추천은 모의 Pile 길이·칸 용량을 씁니다"`), `stacking.unplaced`(kind `missing`, 제목 `"구간을 모르는 원탄 {n}건"`, targets 원탄 라벨).
  - 평가 질문 3개: `q_stack_candidates`("지금 하역 대기 중인 항차가 있어?", expect `stacking_candidates`), `q_stack_cargo`("저열량탄 30,000톤을 2부두에서 내리면 어디에 쌓으면 돼?", expect `recommend_stacking`), `q_blend`("발열량 5,500으로 10,000톤 혼탄하려면?", expect `recommend_blend`).

- [ ] **Step 1: 실패하는 시험 작성**
  - `test_recommend_stacking_tool_cargo_args`(격리 기준재고, ok, `data.options`)
  - `test_recommend_stacking_tool_voyage_blocked`(`data.blocked == "부두 미배정"`)
  - `test_stacking_candidates_tool`
  - `test_recommend_blend_tool_uses_baseline_lots`
  - `test_context_accepts_cargo_keys`(AskContext에 7개 키 허용, 모르는 키는 여전히 422)
  - `test_checks_stacking_items`(blend 화면 결과에 `stacking.mock_layout`, 구간 없는 P6 원탄이 있으면 `stacking.unplaced`)
  - `test_agent_numbers_from_stacking_result_pass`(가짜 LLM: recommend_stacking 결과의 tonnes·from_m을 답에 쓰면 재작성 없이 통과)
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 위 시험 파일 전체 + `tests/test_assistant_eval_format.py`
- [ ] **Step 5: 커밋** — `feat(assistant): add stacking and blend recommendation tools`

---

### Task 7: 프런트 domain

**Files:**
- Create: `src/domain/stacking.ts`
- Test: `tests/stacking.test.ts`(package.json `test` 목록에 추가)

**Interfaces:**
- Produces:
  - 타입 `CargoRequest`, `StackingPlacement`, `StackingOption`, `StackingResult`, `WaitingVoyage`(백엔드 필드명 그대로, snake_case).
  - `cargoFromScenario(v: VesselResult): CargoRequest` — `grade` high→"고", low→"저"; `assignedYard` `"Y1"`→1(형식이 다르면 null); `tonnes = v.cargo - (v.unloaded ?? 0)`(엔진 내부 `remaining`은 공개 타입에 없음); `berth = v.assignedBerth ?? v.berth`; `source "scenario"`, `ref v.id`.
  - `stackingEligible(v: VesselResult): boolean` — `state` 체선·근거리, 또는 하역중이면서 `(v.unloaded ?? 0) === 0`.
  - `fetchStacking(body: CargoRequest | { voyage_no: string }, signal?): Promise<StackingResult>` — `authJson("/api/stacking/recommend", {method: "POST", body})`(기존 authJson의 CSRF 처리 사용).
  - `fetchWaitingVoyages(signal?)`.
  - `stackingFocusValue(p: StackingPlacement): string` — Pile `"P3:130-210.5"`, Shed `"A3"`. `parseStackingFocus(value: string | null): StackingFocus | null` — `{pile: "P3", from_m, to_m} | {cell: "A3"}`, 형식이 틀리면 null.
  - `stackingContext(v: VesselResult): Record<string, string | number>` — `vessel`, `cargo_grade`, `cargo_cv`, `cargo_t`, `berth`, `dest_yard`.

- [ ] **Step 1: 실패하는 시험 작성** — `cargoFromScenario`(GEN4CAST OCEAN 표본 → grade "저", destination_yard 3, tonnes 70000), `stackingEligible`(하역중이고 unloaded>0이면 false, 체선 true), 주소 왕복(`parseStackingFocus(stackingFocusValue(p))`), 잘못된 값 `"P9:1-2"`, `"P3:5-1"`, `"C1"` → null.
- [ ] **Step 2: 실패 확인** — `node --experimental-strip-types --test tests/stacking.test.ts`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm.cmd test`
- [ ] **Step 5: 커밋** — `feat(stacking): add frontend stacking domain helpers`

---

### Task 8: 발전소 전망 선박 목록 추천

**Files:**
- Create: `src/components/stacking/StackingOptions.tsx`, `src/components/stacking/stacking.css`
- Modify: `src/features/forecast/DemoForecast.tsx:370-390`, `src/domain/assistant-checks.ts:106`(forecast 예시 질문 1개를 `"체선 중인 배 화물은 어디에 내리면 돼?"`로 교체)
- Test: `tests/integration-ui.spec.ts`(끝에 추가)

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - `<StackingOptions result={StackingResult} onOpenYard?: (p: StackingPlacement) => void compact?: boolean />` — 추천안 목록(순위, 자리·구간·물량, reasons, warnings, assumptions "모의 값" 목록, no_fit, blocked, gaps). `compact`이면 1순위 한 줄만. 클래스 접두어 `gf-stk-`.
  - `DemoForecast`에 prop `onOpenStacking: (value: string) => void` 추가.
  - 선박 표: 7열 유지. `stackingEligible` 행의 상태 칸에 버튼 "적치 추천"(aria-expanded). 누르면 다음 행 `<tr className="dfc-stack-row"><td colSpan={7}>`에 로딩 → `StackingOptions`. 문구 `"시나리오 가정 · 현재 기준재고 기준(도착 시 재고가 달라질 수 있음)"`. 펼친 상태에서 도우미 섹션 `context`에 `selection: stackingContext(v)`.
  - "저탄장에서 보기" → `onOpenStacking(stackingFocusValue(p))`.

- [ ] **Step 1: 실패하는 시험 작성** — `/api/stacking/recommend`를 route로 가로채 고정 결과를 준다:
  - `forecast vessel list offers stacking only for waiting cargo`: 선박 목록 탭에서 OCEAN 행에 "적치 추천" 버튼, HORIZON(하역 중) 행에는 없음. 표 머리 7칸 유지.
  - `stacking recommendation expands under the row with assumptions`: 버튼 클릭 → 요청 본문 `grade === "저"`, `tonnes === 70000`; 펼친 행에 "Pile 7", "시나리오 가정", "모의" 표시.
  - `stacking no-fit and blocked messages`: no_fit 응답 → "들어갈 빈 곳 없음"; blocked "기준재고 없음" → 그 문구.
  - `stacking row fits 390px and dark mode`: 390px에서 `document.documentElement.scrollWidth <= innerWidth`, 다크 모드에서 펼친 행 글자색과 배경색이 다름.
- [ ] **Step 2: 실패 확인** — `npm.cmd run test:ui -- tests/integration-ui.spec.ts -g "stacking"`
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 같은 명령 + 기존 `수급 예측은 1920 기본 화면…` 시험
- [ ] **Step 5: 커밋** — `feat(forecast): recommend stacking for waiting scenario vessels`

---

### Task 9: 부두 한 줄 추천, 저탄장 강조, App 연결

**Files:**
- Modify: `src/App.tsx`(178행 부근 `?stack=` 읽기, `WorkspaceApp` prop, 804·806·813행), `src/features/berth/OperationsBerth.tsx:570-600`, `src/features/stockyard/OperationsYard.tsx`, `src/features/stockyard/operations-yard.css`
- Test: `tests/integration-ui.spec.ts`

**Interfaces:**
- Consumes: Task 7·8.
- Produces:
  - App: `initialStack = new URLSearchParams(hash.split('?')[1]).get('stack')`; `openStacking(value)` → `location.hash = '#yard?stack=' + encodeURIComponent(value)`. `OperationsYard`에 `initialStack`, `DemoForecast`·`OperationsBerth`에 `onOpenStacking`.
  - 부두: `linked`가 있고 그 항차가 하역 대기(`linked.voyage.status !== "unloading"` 이고 `actual_unload_end` 없음)일 때만 `fetchStacking({voyage_no})` → `<StackingOptions compact>`를 `gf-ob-facts` 아래에. 연결이 없으면 요청도 표시도 하지 않음.
  - 저탄장: `parseStackingFocus(initialStack)`가 있으면 해당 저탄장을 선택하고 Pile 목록 위에 `<section className="gf-oy-stack-focus" aria-label="적치 추천 위치">`: 제목 "적치 추천", Pile 전체 길이 막대(기존 원탄 구간 회색, 제안 구간 강조, 0 m/끝 m 눈금), 구간 문구 `"Pile 3 · 130~210.5 m"`; Shed면 `"Shed A 3칸"`. 해당 Pile 버튼에 `data-proposed="true"`.

- [ ] **Step 1: 실패하는 시험 작성**
  - `berth shows a one-line stacking hint only for a linked waiting voyage`: 원장 records에 MMSI 일치 선박·arrived 항차를 주고 `/api/stacking/recommend` 가로채기 → 한 줄 추천 보임. 연결 없는 경우 요청 0회.
  - `yard highlights the proposed segment from the stack address`: `/#yard?stack=P3%3A130-210.5` → "적치 추천" 칸, "Pile 3 · 130~210.5 m", Pile 3 버튼 `data-proposed="true"`, 1920·390px 가로 넘침 없음.
  - `forecast stacking opens the yard focus`: Task 8 펼침에서 "저탄장에서 보기" → URL `#yard?stack=`.
  - `invalid stack address is ignored`: `/#yard?stack=bad` → 안내 칸 없음, 오류 없음.
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인**
- [ ] **Step 5: 커밋** — `feat(stacking): show berth hint and yard focus for stacking recommendations`

---

### Task 10: 전체 검증

- [ ] **Step 1:** `npm.cmd test` → 모두 PASS
- [ ] **Step 2:** `npm.cmd run build` → 성공
- [ ] **Step 3:** 백엔드 `python -m pytest -q --ignore=tests/test_headroom_uc.py` → `test_annual_headroom` 2건(highspy) 외 PASS
- [ ] **Step 4:** `npm.cmd run test:ui`(백그라운드) → 실패가 있으면 단독 재실행으로 기존 흔들림(`integration-ui.spec.ts:206`, `voyage-registry-ui.spec.ts:687`)과 구분
- [ ] **Step 5:** `git diff --check`, 이번 작업 파일만 staged인지 확인
- [ ] **Step 6:** 검증 결과를 병합 요청 본문에 쓸 수 있게 정리(공통 변경: App.tsx, src/domain, auth READ_POST, 도우미 맥락 키 → 통합 담당자 리뷰 표시)
