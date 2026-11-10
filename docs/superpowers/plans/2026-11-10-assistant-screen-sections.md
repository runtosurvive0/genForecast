# 운영 도우미 1단계(화면별 섹션·빠진 자료 점검) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대상 5개 화면에 규칙 점검과 질문 버튼을 담은 공통 도우미 섹션을 넣고, 도우미에 화면 맥락을 전달하며, UI 13건을 정리한다.

**Architecture:** ZGX 백엔드 `assistant/checks.py`가 화면별 점검 결과를 만들고 `GET /api/assistant/checks`와 도우미 도구 `screen_checks`가 같은 함수를 쓴다. 화면은 `src/components/assistant-section/` 공통 섹션을 쓰고, 질문 버튼은 App.tsx의 `openAssistant`로 공통 도우미 창에 `context`와 함께 보낸다.

**Tech Stack:** Python 3.11·FastAPI·pytest, React·TypeScript·Vite, node test, Playwright

**Spec:** `docs/superpowers/specs/2026-11-10-assistant-screen-sections-design.md`

## Global Constraints

- 사용자에게 보이는 문구는 모두 한국어. 코드 식별자·저장 칸 이름·API 칸 이름은 바꾸지 않는다.
- 점검·맥락은 읽기 전용. 새 쓰기 API를 만들지 않는다. 점검 결과 숫자·목록은 ZGX 자료에서만 나온다. 실패한 점검을 항목으로 꾸며 내지 않는다(`errors`에 사유).
- 점검 종류는 `missing`·`stale`·`dummy`·`sample` 네 가지, 정렬은 이 순서, 같은 종류 안에서는 `count` 큰 순. `targets`는 최대 20건.
- 기준재고 오래됨 기준: 3일(`checks.py` 상수 `BASELINE_STALE_DAYS = 3`).
- `context`: `screen`은 `blend`·`forecast`·`simulation`·`planning_input`·`scenario` 중 하나, `selection` 허용 키 `yard`·`unit`·`lot`·`run_id`·`input_id`·`view`, 값은 80자 이하 문자열 또는 정수, 직렬화 1KB 이하. 벗어나면 422. 칸이 없으면 기존과 똑같이 동작.
- 모의 배지는 상단 공통 표시에만 둔다. 섹션의 `sample` 항목은 어느 입력이 표본인지만 적는다.
- 화면끼리 직접 import하지 않는다. 공통 UI는 `src/components/`, 계산·타입은 `src/domain/`, 연결은 App.tsx.
- 기능 CSS는 해당 폴더, 전용 클래스(`gf-as-…` 등). 전역 요소 선택자 금지. 라이트/다크·390px 가로 넘침 없음.
- 공통 `BASE_TIME`, `plant_id`, `stockpile_id`, 단위, KST 기준은 바꾸지 않는다. 새 의존성 없음.
- 공용 ZGX API에 쓰기 시험을 하지 않는다. Playwright는 기존 방식(격리 테스트 서버 8097 + `page.route` 가로채기).
- Windows에서는 `npm.cmd`. 백엔드 시험은 `X:\IDEWorkspace\ws_codex\Hackathon_EWP\backend\.venv\Scripts\python.exe -m pytest`(작업 폴더 `backend`).
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. 이번 파일만 지정해 stage한다.

## 계획에서 정한 것 (명세 보완)

- 혼탄 목록(UI 4번)이 원탄별 성분을 보여 주려면 원탄별 판정이 필요하다. 점검 결과에 선택 칸 `details`를 둔다. `blend`일 때만 `details.lots[source_id] = {"grade": "고"|"저"|None, "gcv_arb", "sulfur_ar", "tm_ar", "dummy": bool, "reason": str|None}`. 다른 화면은 `details`를 넣지 않는다.
- 고/저 구분은 기준재고 `grade` 칸 앞글자(기존 `yard-baseline-lots.js`와 같음). 발열량으로 새 경계를 만들지 않는다.
- 통합 시뮬레이션 점검은 기존 `planning_api.snapshot(run_id, None, 30)`의 `issues`를 그대로 쓴다. 문구에 "경과"나 "stale"이 있으면 `stale`, 나머지는 `missing`.
- 전망 입력 추정 단가 달: `ESTIMATED_PRICE_MONTHS = ("2026-11", "2026-12")`(기존 화면 안내와 같은 기준). 입력 기간이 이 달과 겹치면 `planning_input.price_estimated`.
- 수급 예측 `live` 허용 이름: `stock`(저탄장 재고), `ships`(하역 잔량), `units`(호기 출력).
- 시나리오 분석(11번): 계산은 그대로 두고 **표시 시각만** 오늘 KST 09:00 기준으로 옮긴다(`shiftSampleTime`).

## Review Focus

1. 기준재고가 하나도 없는 DB(새 설치) → `blend` 점검은 `missing` 항목 "기준재고 없음" 하나와 빈 `details`, 500이 아니다. (과제 2 시험 `test_blend_no_baseline`)
2. 같은 항차번호가 원장에 둘 이상이거나 같은 탄종 화물이 둘 이상 → 성분을 고르지 않고 사유 "화물을 하나로 특정할 수 없음". (과제 1 시험 `test_ambiguous_cargo_reason`)
3. 계산 실행 id가 없어진 경우(삭제·잘못된 id) → `simulation` 점검은 `errors`에 사유, 항목을 꾸며 내지 않고 200. (과제 3 시험 `test_simulation_unknown_run`)
4. 점검 조회 중 화면을 빠르게 바꿈 → 늦게 온 이전 화면 결과가 새 화면 섹션에 덮어쓰지 않는다. (과제 5 시험 `stale response ignored`)
5. 오픈AI 미설정 + 로그인됨 → 점검은 보이고 질문 버튼만 꺼진다. 도우미 창 입력도 꺼진다. (과제 6 Playwright `llm off`)

---

### 과제 1: 기준재고 원탄 ↔ 성분 매칭 함수 꺼내기

**Files:**
- Create: `backend/src/midterm/baseline_quality.py`
- Modify: `backend/src/midterm/web/voyage_registry_api.py:204-211`
- Test: `backend/tests/test_baseline_quality.py`

**Interfaces:**
- Produces: `match_lot_quality(row: dict, register: dict) -> dict` — 반환 `{"assay": dict|None, "cargo_no": str|None, "reason": str|None}`. `reason`은 `"항차번호 없음"`, `"원장에 항차 없음"`, `"화물을 하나로 특정할 수 없음"`, `"성분 분석 없음"` 중 하나 또는 None. `assay`는 `register["quality_selection"]`의 행 그대로(`data_origin`, `dummy_fields` 포함).
- Produces: `QUALITY_FIELDS = ("gcv_arb", "tm_ar", "sulfur_ar")`

- [ ] **Step 1: 실패하는 시험 작성** — `test_baseline_quality.py`
  - `test_match_single_cargo`: 항차 1건·같은 탄종 화물 1건·분석 있음 → `assay["gcv_arb"] == 4200`, `reason is None`
  - `test_no_voyage_number`: `voyage_number` 빈칸 → `reason == "항차번호 없음"`, `assay is None`
  - `test_voyage_not_in_registry` → `"원장에 항차 없음"`
  - `test_ambiguous_cargo_reason`: 같은 항차에 같은 탄종 화물 2건 → `"화물을 하나로 특정할 수 없음"`
  - `test_no_assay` → `"성분 분석 없음"`
- [ ] **Step 2: 실패 확인** — `pytest tests/test_baseline_quality.py -v` → ImportError
- [ ] **Step 3: 구현** — 지금 `blend_baseline_recommend` 204~211행과 같은 매칭(항차번호 일치 항차 정확히 1건, 그 항차·같은 `coal_name` 화물 정확히 1건, `quality_selection[cargo_no]`). `blend_baseline_recommend`는 이 함수를 써서 같은 `lots`를 만든다(동작 변화 없음).
- [ ] **Step 4: 통과 확인** — `pytest tests/test_baseline_quality.py tests/test_voyage_registry_api.py -q` → 모두 통과
- [ ] **Step 5: 커밋** — `refactor(blend): share baseline lot quality matching`

### 과제 2: 점검 엔진과 상탄·혼탄 규칙

**Files:**
- Create: `backend/src/midterm/assistant/checks.py`
- Test: `backend/tests/test_assistant_checks.py`

**Interfaces:**
- Consumes: 과제 1 `match_lot_quality`, `QUALITY_FIELDS`; `stock_baseline.read_baseline(path)`; `voyage_registry.snapshot(path)`; `ToolContext`(`now`, `db_path`)
- Produces:
  - `SCREENS = ("blend", "forecast", "simulation", "planning_input", "scenario")`
  - `run_checks(screen: str, params: dict, ctx: ToolContext) -> dict` — `{"screen", "as_of"(ctx.now KST ISO), "items": [...], "errors": [...]}`, blend면 `details` 추가. 화면 밖이면 `ValueError("알 수 없는 화면: …")`.
  - 항목 `{"id", "kind", "title", "detail", "count", "targets": [{"label", "reason"}], "action": {"page", "label"} | None}`
  - `sort_items(items: list[dict]) -> list[dict]`
  - 화면 함수는 `_RULES: dict[str, Callable[[dict, ToolContext], tuple[list, dict|None]]]`로 등록. 하위 함수 예외는 잡아서 `errors`에 `"<화면> 점검 실패: <사유>"`.
- 원탄 이름(`label`): `"{위치 표시} · {coal_name} · {voyage_number or '항차 미확인'}"`. 위치 표시는 `location` 그대로.

- [ ] **Step 1: 실패하는 시험 작성** — 시험용 DB는 `tmp_path`에 `stock_baseline.save_baseline`·`voyage_registry.commit`으로 만든다(기존 `test_dummy_data*.py`의 생성 방식 참고).
  - `test_blend_quality_missing`: 원탄 3개 중 1개 성분 없음 → 항목 `blend.quality_missing`, `count == 1`, `targets[0]["reason"] == "성분 분석 없음"`, `action == {"page": "vessels", "label": "항차 원장에서 확인"}`
  - `test_blend_sulfur_blank_is_missing`: 분석은 있으나 `sulfur_ar` 빈칸 → reason `"황분 없음"`(발열량 `"발열량 없음"`, 총수분 `"총수분 없음"`)
  - `test_blend_quality_dummy`: 분석 행 `data_origin='dummy'` → `blend.quality_dummy` count 1, `details.lots[id]["dummy"] is True`
  - `test_blend_baseline_dummy`: 기준재고 원탄 `dummy_fields` 있음 → `blend.baseline_dummy`
  - `test_blend_baseline_stale`: 기준일이 `ctx.now`보다 4일 전 → `blend.baseline_stale`; 3일 전이면 없음
  - `test_blend_grade_unknown`: `grade` 빈칸 → `blend.grade_unknown`
  - `test_blend_tonnes_zero_ignored`: `tonnes == 0` 원탄은 어떤 항목에도 들어가지 않음
  - `test_blend_no_baseline`: 기준재고 없음 → 항목 1개 `blend.no_baseline`(missing, title `"기준재고가 없습니다"`, action `{"page": "inventory", "label": "재고 원장에서 등록"}`), `details == {"lots": {}}`
  - `test_targets_capped_at_20`: 성분 없는 원탄 25개 → `count == 25`, `len(targets) == 20`
  - `test_sort_order`: `sort_items`에 sample·dummy·missing(count 1)·missing(count 5)·stale → id 순서 missing5, missing1, stale, dummy, sample
  - `test_unknown_screen`: `run_checks("x", {}, ctx)` → ValueError
  - `test_rule_exception_goes_to_errors`: monkeypatch로 규칙이 예외 → `items == []`, `errors == ["상탄·혼탄 점검 실패: boom"]`
- [ ] **Step 2: 실패 확인** — `pytest tests/test_assistant_checks.py -v` → ImportError
- [ ] **Step 3: 구현** — 위 Interfaces와 시험 값대로. 화면 이름 표시: `{"blend": "상탄·혼탄", "forecast": "수급 예측", "simulation": "통합 시뮬레이션", "planning_input": "전망 입력·계산", "scenario": "시나리오 분석"}`(`SCREEN_LABELS`). 항목 제목 형식은 `"<설명> N건"`(예: `"성분 분석과 연결되지 않은 원탄 3건"`, `"더미 성분을 쓰는 원탄 2건"`, `"더미로 채운 기준재고 칸이 있는 원탄 4건"`, `"고열량·저열량 구분이 없는 원탄 1건"`), stale 제목 `"기준재고가 N일 전(YYYY-MM-DD) 기준입니다"`.
- [ ] **Step 4: 통과 확인** — `pytest tests/test_assistant_checks.py -q`
- [ ] **Step 5: 커밋** — `feat(assistant): screen check engine with blend rules`

### 과제 3: 나머지 화면 점검 규칙

**Files:**
- Modify: `backend/src/midterm/assistant/checks.py`
- Test: `backend/tests/test_assistant_checks.py`

**Interfaces:**
- Consumes: `planning_api.snapshot(run_id, None, 30)`, `milp_store.stored_runs()`(완료 계산 목록, 기존 `/api/planning/executions` 함수), `milp_store.get_input(input_id, path)`
- Produces: `_simulation(params)`(`params["run_id"]` 선택, 없으면 가장 최근 완료 계산), `_planning_input(params)`(`params["input_id"]` 선택, 없으면 가장 최근 입력), `_forecast(params)`(`params["live"]: list[str]`), `_scenario(params)`
- 상수: `ESTIMATED_PRICE_MONTHS = ("2026-11", "2026-12")`, `LIVE_INPUTS = {"stock": "저탄장 재고", "ships": "하역 잔량", "units": "호기 출력"}`

- [ ] **Step 1: 실패하는 시험 작성** (DB·계산 함수는 monkeypatch)
  - `test_simulation_no_run`: 완료 계산 없음 → `simulation.no_run`(missing, action `{"page": "data", "label": "전망 입력·계산 열기"}`)
  - `test_simulation_issues_mapped`: issues `["수기 기준재고 미등록", "기준시각 경과 · 3일"]` → `simulation.issue.0` missing, `simulation.issue.1` stale, `targets == []`, `count == 1`
  - `test_simulation_unknown_run`: snapshot이 ValueError → `items == []`, `errors[0]`가 `"통합 시뮬레이션 점검 실패:"`로 시작
  - `test_planning_input_price_missing`: 열량단가에 필요한 호기 하나가 없거나 0 이하 달이 있음 → `planning_input.price_missing`, targets에 호기·달
  - `test_planning_input_no_maintenance`: `scenario.coal_oh == []` → `planning_input.no_maintenance`, detail에 `"무정비 확정을 의미하지 않습니다"`
  - `test_planning_input_price_estimated`: 기간 2026-11-10~2027-02-07 → `planning_input.price_estimated`(stale), targets `["2026-11", "2026-12"]`; 2027-01-01~2027-12-31이면 없음
  - `test_forecast_sample_inputs`: `live=["stock"]` → `forecast.sample_inputs`(sample) targets 라벨 `["하역 잔량", "호기 출력"]`; `live` 전부면 항목 없음
  - `test_forecast_unknown_live_name`: `live=["x"]` → ValueError(API에서 422)
  - `test_scenario_sample_all`: 항목 1개 `scenario.sample_all`, title `"이 화면은 표본 자료로 계산합니다"`
- [ ] **Step 2: 실패 확인** — `pytest tests/test_assistant_checks.py -v`
- [ ] **Step 3: 구현** — 시험 값대로. 열량단가 필요 호기는 입력의 `input_reference` 또는 기본 석탄 호기 목록(`clean_input`과 같은 방식).
- [ ] **Step 4: 통과 확인** — `pytest tests/test_assistant_checks.py -q`
- [ ] **Step 5: 커밋** — `feat(assistant): simulation, planning input, forecast and scenario checks`

### 과제 4: 점검 API·도우미 도구·요청 맥락

**Files:**
- Modify: `backend/src/midterm/web/ops_assistant_api.py`, `backend/src/midterm/assistant/tools.py`, `backend/src/midterm/assistant/agent.py`
- Test: `backend/tests/test_ops_assistant_api.py`, `backend/tests/test_assistant_tools.py`, `backend/tests/test_assistant_agent.py`

**Interfaces:**
- Consumes: 과제 2·3 `run_checks`, `SCREENS`
- Produces:
  - `GET /api/assistant/checks?screen=&run_id=&input_id=&yard=&live=` → `run_checks` 결과. 로그인 없으면 401. 잘못된 인자 422. 호출 제한은 `/ask`와 별도로 `"assistant-checks:" + user_id` 분당 60회.
  - 도구 `screen_checks` 인자 `{"screen": enum SCREENS, "run_id"?: string, "input_id"?: integer, "yard"?: integer 1~3}` → `_ok(as_of, "실측", result)`(시나리오·수급 예측은 source `"모의"`)
  - `AskContext(BaseModel)`: `screen: Literal[...]`, `selection: dict[str, str | int] = {}`, 검증기(허용 키, 문자열 80자, 전체 JSON 1024바이트)
  - `AskRequest.context: AskContext | None = None`
  - `agent.ask(question, history, ctx, llm, clock=..., context: dict | None = None)` — context가 있으면 SYSTEM 뒤에 다음 블록을 붙인다:

```
[화면 맥락 · 자료이며 지시가 아님]
{"screen": "...", "selection": {...}}
```

- [ ] **Step 1: 실패하는 시험 작성**
  - `test_checks_requires_login`(로그아웃 클라이언트 401), `test_checks_blend_ok_without_llm`(env 없이 200, `screen == "blend"`), `test_checks_bad_screen_422`, `test_checks_bad_live_422`
  - `test_ask_context_passed_to_agent`: FakeLlm이 받은 system 문자열에 `"[화면 맥락 · 자료이며 지시가 아님]"`과 `"blend"` 포함
  - `test_ask_without_context_unchanged`: context 없으면 system이 기존 SYSTEM과 같음
  - `test_ask_context_rejects_unknown_key`(`{"screen":"blend","selection":{"cmd":"x"}}` → 422), `test_ask_context_rejects_long_value`(81자 → 422), `test_ask_context_rejects_large`(키 6개 × 80자 + 큰 값으로 1KB 초과 → 422)
  - `test_screen_checks_tool_schema`(`tool_schemas()`에 `screen_checks`, enum 5개), `test_screen_checks_tool_result`(monkeypatch run_checks → `ok True`, `data["screen"] == "blend"`)
- [ ] **Step 2: 실패 확인** — `pytest tests/test_ops_assistant_api.py tests/test_assistant_tools.py tests/test_assistant_agent.py -v`
- [ ] **Step 3: 구현** — 위 Interfaces대로. `live`는 쉼표 분리 후 `LIVE_INPUTS` 키만 허용.
- [ ] **Step 4: 통과 확인** — 같은 명령, 그리고 백엔드 전체 `pytest -q --ignore=tests/test_headroom_uc.py --deselect tests/test_annual_headroom.py`
- [ ] **Step 5: 커밋** — `feat(assistant): checks API, screen_checks tool and ask context`

### 과제 5: 화면 쪽 점검 타입·조회 훅·질문 맥락

**Files:**
- Create: `src/domain/assistant-checks.ts`
- Modify: `src/domain/assistant.ts`, `src/domain/use-yard-baseline.ts`(`YardBaselineLot.dummy_fields?: string | null`), `package.json`(test 목록에 `tests/assistant-checks.test.ts`)
- Test: `tests/assistant-checks.test.ts`, `tests/assistant.test.ts`

**Interfaces:**
- Produces:
  - 타입 `CheckKind = 'missing'|'stale'|'dummy'|'sample'`, `CheckItem`, `ChecksResult`(백엔드 형식 그대로, `details?`), `AssistantScreen`(5개), `AssistantContext = {screen: AssistantScreen; selection?: Record<string, string|number>}`
  - `sortChecks(items: CheckItem[]): CheckItem[]`(백엔드와 같은 순서)
  - `checksQuery(screen, params: {runId?: string; inputId?: number; yard?: 1|2|3; live?: string[]}): string` → `/api/assistant/checks?screen=…`
  - `useAssistantChecks(screen, params): {state: 'loading'|'ready'|'error'|'hidden'; result: ChecksResult|null; reload(): void}` — 진입·params 변경·`reload`만 조회. 늦게 도착한 이전 요청 결과는 버린다. 401/403 → `hidden`. 오류 → `error`, `result = null`.
  - `contextChip(ctx: AssistantContext): string` → 예: `{screen:'blend', selection:{yard:1}}` → `"상탄·혼탄 · 1계통"`, `run_id` 있으면 `" · 계산 선택됨"`
  - `askAssistant(question, history, signal, context?)` — body에 `context`가 있을 때만 넣는다.
  - `SCREEN_LABEL: Record<AssistantScreen, string>`

- [ ] **Step 1: 실패하는 시험 작성** (`tests/assistant-checks.test.ts`)
  - `sortChecks` 순서(과제 2와 같은 입력·기대)
  - `checksQuery('forecast', {live:['stock','units']})` → `'/api/assistant/checks?screen=forecast&live=stock%2Cunits'`
  - `contextChip` 두 경우
  - `stale response ignored`: 훅의 순수 함수 `acceptResponse(requestId, latestId)`가 이전 id면 false
  - `assistant.test.ts`: `askAssistant`가 context 없으면 본문에 `context` 키가 없다, 있으면 그대로 넣는다(fetch 대체)
- [ ] **Step 2: 실패 확인** — `npm.cmd test` → 새 시험 실패
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — `npm.cmd test`
- [ ] **Step 5: 커밋** — `feat(assistant): client types, checks hook and ask context`

### 과제 6: 공통 섹션·도우미 창(13번)·App 연결

**Files:**
- Create: `src/components/assistant-section/AssistantSection.tsx`, `src/components/assistant-section/assistant-section.css`
- Modify: `src/features/assistant/AssistantPanel.tsx`, `src/features/assistant/assistant.css`, `src/App.tsx`
- Test: `tests/assistant-section-ui.spec.ts`(새 파일. `npm.cmd run test:ui`가 tests/*.spec.ts를 모두 실행하므로 따로 등록하지 않는다)

**Interfaces:**
- Consumes: 과제 5 전부
- Produces:
  - `AssistantSection({screen, params, context, questions, onAsk, onNavigate}: {screen: AssistantScreen; params: Parameters<typeof checksQuery>[1]; context: AssistantContext; questions: {label: string; question: string}[]; onAsk: (question: string, context: AssistantContext) => void; onNavigate: (page: string) => void})`
  - 루트 `<section className="gf-as" aria-label="도우미">`, 접기 버튼 `aria-expanded`, `localStorage` 키 `gf-as-open:<screen>`. 처음 값: missing 있으면 펼침.
  - 문구: 점검 시각 `"점검 HH:MM"`, 버튼 `"다시 점검"`, 빈 결과 `"확인할 빈 자료가 없습니다"`, 오류 `"점검을 불러오지 못했습니다"` + `"다시 시도"`, LLM 꺼짐 `"도우미가 연결되지 않았습니다"`. 종류 표시 `missing:"빠짐"`, `stale:"오래됨"`, `dummy:"더미"`, `sample:"표본"`.
  - App.tsx: `openAssistant(question: string, context: AssistantContext)` → 창을 열고 `pending` 설정.
  - `AssistantPanel({open, onClose, pending, onPendingSent, screen})`: 열릴 때 `/api/assistant/status` 확인. `llm:false`면 입력·보내기 비활성 + `"도우미가 연결되지 않았습니다 · 관리자에게 오픈AI 설정을 확인해 달라고 요청하세요"`. 대화가 비었을 때 예시 질문 3개(현재 화면 `screen`의 질문 목록 앞 3개, 화면이 대상 밖이면 공통 예시 `"지금 당진 부두 앞에서 기다리는 배는?"`, `"재고일수가 가장 낮은 저탄장은?"`, `"다음 주 입항 예정 항차를 알려 줘"`). `pending`이 오면 바로 보내고 질문 위에 `contextChip` 표시.
  - 상태줄: `"연결됨"` 또는 위 문구.

- [ ] **Step 1: 실패하는 Playwright 시험 작성** — 시험 페이지는 `/#blend`(섹션은 과제 7에서 화면에 넣으므로 이 과제에서는 `/#overview` 도우미 창 시험과, App이 `openAssistant`를 노출하는지 확인하는 시험을 쓴다). 가로채기: `/api/assistant/status` → `{llm:true}`/`{llm:false}`, `/api/assistant/ask` 본문 기록.
  - `empty panel shows status and examples`: 창 열기 → `"연결됨"`, 예시 버튼 3개
  - `llm off`: `{llm:false}` → 입력·보내기 비활성, 안내 문구
  - `example question sends`: 예시 버튼 클릭 → ask 요청 1회, 질문 일치
- [ ] **Step 2: 실패 확인** — `npm.cmd run test:ui -- tests/assistant-section-ui.spec.ts`
- [ ] **Step 3: 구현** — 섹션 컴포넌트와 창 수정, App 연결. 섹션 CSS는 `gf-as-` 접두어만.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `npm.cmd test` + `tests/assistant-ui.spec.ts`
- [ ] **Step 5: 커밋** — `feat(assistant): shared assistant section and panel status/examples`

### 과제 7: 5개 화면에 섹션 배치·수급 예측 카드 이름(6번)

**Files:**
- Modify: `src/features/stockyard/OperationsBlend.tsx`, `src/features/forecast/DemoForecast.tsx`, `src/App.tsx`(시뮬레이션 배치·시나리오 인라인 화면), `src/features/data/MilpUpload.tsx`, 각 화면 CSS(배치만)
- Test: `tests/assistant-section-ui.spec.ts`

**Interfaces:**
- Consumes: 과제 6 `AssistantSection`, App의 `openAssistant`·`navigate`(props로 전달)
- 배치·params·질문(문구 확정):
  - 상탄·혼탄(두 보기, 제목 아래): params `{yard}`, context `{screen:'blend', selection:{yard, view, lot?}}`. 질문: `"지금 저열량탄 재고가 많은 저탄장은?"`, `"성분이 빠진 원탄 목록을 정리해 줘"`, `"선택한 원탄의 발열량과 황분은?"`
  - 수급 예측(오른쪽 열, 조건 해석 카드 위): params `{live}`(운전 모사 `status`가 online/stale이면 `['stock','ships','units']`, 아니면 `[]`). 질문: `"재고일수가 가장 먼저 떨어지는 저탄장은?"`, `"입항이 이틀 늦으면 재고는 어떻게 돼?"`, `"지금 기다리는 배는?"`. 카드 제목 `"AI 어시스턴트"` → `"조건 해석"`(6번)
  - 통합 시뮬레이션("확인할 변화" 위): params `{runId}`(선택 계산). 질문: `"이 계획에서 재고가 가장 낮은 날은?"`, `"확인할 경고를 쉬운 말로 정리해 줘"`, `"이 계획의 호기별 연료 사용량은?"`
  - 전망 입력·계산("새 전망 조건 입력" 위): params `{inputId}`(선택 입력, 없으면 생략). 질문: `"이 입력에서 빠진 값이 뭐야?"`, `"추정 단가를 쓰는 달은?"`, `"마지막 계산 결과를 요약해 줘"`
  - 시나리오 분석(운영 조건 설정 위): params `{}`. 질문: `"부하를 10% 늘리면 재고가 언제 부족해?"`, `"입항이 3일 늦으면 어떻게 돼?"`, `"가장 먼저 부족해지는 발전본부는?"`

- [ ] **Step 1: 실패하는 Playwright 시험 작성**(checks 가로채기)
  - `section on five screens`: 5개 화면 각각 `section[aria-label="도우미"]` 보임, 요청 `screen=` 값 일치
  - `missing item expanded`: missing 항목 있으면 펼쳐져 대상 라벨 보임, 이동 버튼 클릭 → 해당 page로 이동
  - `question sends context`: 상탄·혼탄 질문 버튼 → ask 본문 `context.screen == 'blend'`, `selection.yard == 1`, 창에 칩 `"상탄·혼탄 · 1계통"`
  - `checks error retry`: checks 500 → `"점검을 불러오지 못했습니다"`, 다시 시도 후 200이면 목록
  - `forecast card renamed`: `"조건 해석"` 보이고 `"AI 어시스턴트"` 없음
  - `section 390 dark`: 390px·다크에서 `document.documentElement.scrollWidth <= 390`, 섹션 보임; 라이트에서도 보임
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 새 spec + `tests/forecast-input-ui.spec.ts` + `tests/integration-ui.spec.ts`
- [ ] **Step 5: 커밋** — `feat(assistant): place assistant sections on five screens`

### 과제 8: 상탄·혼탄 UI 정리(1·2·3·4·5번)

**Files:**
- Modify: `src/features/stockyard/OperationsBlend.tsx`, `src/features/stockyard/operations-blend.css`, `src/components/inventory/InventoryWorkspace.tsx`(+ 그 CSS), `src/App.tsx:685`(조회 범위 띠 조건), 저탄장 화면 중 "더미" 문구가 있는 파일(`src/features/stockyard/*.tsx`, `src/components/fuel-scene/*`의 화면 문구)
- Test: `tests/assistant-section-ui.spec.ts`(또는 새 `tests/blend-ui.spec.ts`), `tests/stockyard.test.ts`

**Interfaces:**
- Consumes: 과제 2 `details.lots`(과제 5 `ChecksResult.details`), 과제 6 섹션의 결과를 부모가 받도록 `AssistantSection`에 `onResult?: (r: ChecksResult) => void` 추가
- 문구 바꿈표(1번, 화면 문구만): `"더미를 선택하세요."` → `"원탄을 선택하세요."`, `"혼탄 대상 더미"` → `"혼탄 대상 원탄"`, `"더미 선택 없음"` → `"원탄 선택 없음"`, 그 밖의 쌓아 둔 석탄을 가리키는 "더미"는 "원탄"(선택 대상) 또는 "적치"(위치). 0단계 더미 자료 배지("더미")는 그대로.

- [ ] **Step 1: 실패하는 시험 작성**
  - `no pile-dummy wording`: `#blend` 두 보기·`#yard`의 `main` 텍스트에 정규식 `/더미(를|\s*선택|\s*목록)|대상 더미/` 없음
  - `blend checkbox inline`: 혼탄 분석 첫 행의 체크박스 `getBoundingClientRect().top`과 원탄 이름 top 차이 ≤ 8px, 체크박스가 이름보다 왼쪽(넓은 화면·390px)
  - `no range bar in blend analysis`: 혼탄 분석 보기에서 `"조회 범위"` 없음, 다른 화면(`#overview`)에는 그대로
  - `blend row shows quality`: checks `details.lots`를 가로채 넣으면 행에 `"저열량"`, `"4,200 kcal/kg"`, `"황분 0.45%"`; 성분 없음 → `"성분 미확인"`; dummy → `.vr-dummy-badge`와 같은 표시 문구 `"더미"`
  - `offline notice once`: 운전 모사 미연결에서 `"운전 미연결"` 문구 개수 ≤ 1, 호기 버튼 텍스트는 `"1호기"` 등 이름만
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 새 시험 + `tests/integration-ui.spec.ts` + `npm.cmd test`
- [ ] **Step 5: 커밋** — `fix(blend): clearer pile wording, inline checkboxes and lot quality`

### 과제 9: 수급 예측·통합 시뮬레이션·전망 입력·시나리오 UI 정리(7~12번)

**Files:**
- Modify: `src/features/forecast/DemoForecast.tsx`(+CSS), 통합 시뮬레이션 화면 파일(`MidtermDashboard`·`PlanningWorkspace` 중 해당 문구 위치), `src/features/data/MilpUpload.tsx`, `src/features/data/PlanningInputForm.tsx`, `src/App.tsx`(시나리오 인라인 화면), `src/domain/planning.ts` 또는 새 `src/domain/planning-labels.ts`, `src/domain/control-tower.ts`(시각 이동 함수만 추가)
- Test: `tests/planning.test.ts`, `tests/control-tower.test.ts`, UI spec

**Interfaces:**
- Produces:
  - `planLabel(item: {name: string; id?: number; recorded_at?: string; run_id?: string; start: string; end: string}): string` → `"#4 2026년 11월+90 · 2026-11-10 ~ 2027-02-07 · 11-10 03:09 KST"`(입력 번호·실행 시각이 있을 때만 붙임)
  - `runTitle(runId: string, name: string): {title: string; sub: string}` → `runTitle('20261110-031444-322005-2026년11월90', '2026년 11월+90')` = `{title: '2026년 11월+90 · 11-10 03:14 KST', sub: '20261110-031444-322005-2026년11월90'}`
  - `shiftSampleTime(iso: string, base: string, now: Date): string` → base(`BASE_TIME`)와 오늘 KST 09:00의 차이만큼 옮긴 ISO. `shiftSampleTime('2026-10-22T09:00:00+09:00', '2026-10-06T09:00:00+09:00', new Date('2026-11-10T01:00:00Z'))` = `'2026-11-26T09:00:00+09:00'`

- [ ] **Step 1: 실패하는 시험 작성**
  - 단위: 위 세 함수 예시 값, `planLabel`이 같은 이름 두 항목을 서로 다른 문자열로 만든다
  - UI 7: 수급 예측 차트 제목 요소 `scrollHeight <= lineHeight * 1.5`(한 줄), 차트 위 표시 두 개의 경계 상자가 겹치지 않음
  - UI 8: 통합 시뮬레이션·전망 입력 선택 목록의 옵션 텍스트가 모두 서로 다름(가로채기로 같은 이름 2건 제공)
  - UI 9: 실행 이력 첫 행 제목에 `runTitle` 제목, 식별자는 보조 글자 요소에만
  - UI 10: `"일말 재고"` 없음·`"당일 마감 재고"` 있음, 통합 시뮬레이션 화면에 `"통합 시뮬레이션 열기"` 링크 없음, 화면 텍스트에 `"--"` 없음
  - UI 11: 시나리오 화면의 차트 첫 날짜·"최초 연료부족 예상" 날짜가 시험 시각(`page.clock` 고정 2026-11-10) 이후
  - UI 12: 시나리오 화면 `h1`/`h2` 중 `"시나리오 분석"` 텍스트 1개, 진입 직후 `window.scrollY === 0`
- [ ] **Step 2: 실패 확인**
- [ ] **Step 3: 구현** — 11번은 표시 직전에 `shiftSampleTime`을 적용한다. 계산 함수와 `BASE_TIME`은 그대로.
- [ ] **Step 4: 통과 확인** — `npm.cmd test` + 해당 UI spec + `tests/forecast-input-ui.spec.ts`
- [ ] **Step 5: 커밋** — `fix(planning): distinct plan labels, readable run titles and current scenario dates`

### 과제 10: 전체 검증

- [ ] `git diff --check`
- [ ] 백엔드: `pytest -q --ignore=tests/test_headroom_uc.py --deselect tests/test_annual_headroom.py` → 실패 0
- [ ] `npm.cmd test`, `npm.cmd run build` → 통과
- [ ] `npm.cmd run test:ui`(오래 걸리면 백그라운드). `integration-ui.spec.ts:201`·`voyage-registry-ui.spec.ts:687`처럼 원래 흔들리는 시험이 실패하면 단독으로 다시 돌려 구분해 보고
- [ ] 로컬 dev 서버에서 5개 화면을 라이트·다크·390px로 눈으로 확인(공용 ZGX 쓰기 없음)
