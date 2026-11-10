# 운영 도우미 1단계: 화면별 도우미 섹션과 빠진 자료 점검

- 작성일: 2026-11-10 (KST)
- 상태: 사용자 방향 승인(대화), 문서 검토 대기
- 선행: 운영 질의 도우미(runtosurvive0/genForecast#19), 0단계 더미 자료(runtosurvive0/genForecast#24, ZGX 적재 완료)
- 후속: 2단계 혼탄·저탄 추천, 3단계 접안 추천·간트·AI 브리핑이 이 점검 결과와 섹션을 그대로 쓴다.

## 1. 목적

담당자가 계획·운영 화면을 열었을 때, 그 화면의 계산에 **무엇이 빠졌고 무엇이 더미·표본인지** 바로 알게 한다. 그리고 그 화면 맥락을 담은 질문을 버튼 하나로 공통 도우미에 보낼 수 있게 한다. 같은 작업에서 대상 화면의 어색한 UI 13건을 정리한다.

사용자 결정(2026-11-10 대화):

- 대상 화면: 상탄·혼탄(`blend`), 수급 예측(`forecast`), 통합 시뮬레이션(`simulation`), 데이터 워크스페이스의 전망 입력·계산 탭, 시나리오 분석(`scenario`).
- 섹션 동작: 화면을 열면 **규칙 점검**을 바로 보여 준다(오픈AI 호출 없음). 화면 맥락을 담은 **질문 버튼**을 누르면 공통 도우미가 답한다.
- 구조: 점검 규칙은 ZGX 백엔드 한 곳에 두고, 화면에는 공통 섹션을 넣는다.
- UI 정리: 2026-11-10 ZGX 화면 점검에서 찾은 13건 전부(5절).

성공 기준:

1. 대상 5개 화면에서 점검 목록이 오픈AI 없이 표시된다. 점검 결과의 숫자·목록은 ZGX 자료에서만 나온다.
2. 혼탄 계산에서 조용히 빠지던 원탄(성분 미확인)이 화면을 열자마자 이름과 사유로 보인다.
3. 더미 성분(0단계 `dummy_fields`)을 쓰는 원탄이 점검에서 구분된다.
4. 질문 버튼을 누르면 공통 도우미 창이 열리고, 화면 이름과 선택값이 `context`로 함께 전달된다.
5. 오픈AI가 연결되지 않았으면 질문 버튼은 꺼지고 이유가 보인다. 점검은 그대로 보인다.
6. UI 정리 13건마다 회귀 시험이 있다.

범위 밖: 혼탄·저탄 추천 계산(2단계), 빈 자료를 실제로 채우는 기능, 접안 추천·간트·브리핑(3단계), 새 LLM 제공자.

## 2. 현재 상태 (577650c 기준 조사)

| 화면 | 자료 경로 | 비었을 때 지금 | 기존 경고 |
|---|---|---|---|
| 상탄·혼탄 공급 계통 | `GET /api/voyage-registry/inventory/baseline`, 운전 모사 웹소켓 | `—`, `운전 미연결`, 등급 `미확인` | 없음 |
| 상탄·혼탄 혼탄 분석 | 기준재고 + 원장 화물 `quality_selection`, `POST …/blend/baseline-recommend` | 성분이 없거나 화물 매칭 실패 시 계산에서 제외(`excluded`) | 없음(결과에만 `excluded`) |
| 수급 예측 | 클라이언트 표본(`demoForecastInput`) + 운전 모사 연결값(`fromOperations`) | 연결값이 없으면 표본 그대로 | 없음 |
| 통합 시뮬레이션 | `GET /api/planning/runs/{id}/snapshot` | 빈 목록, `미확정` | `snapshot.issues`(`planning_api.py:78~84`, `supply_api.py:356~371`) |
| 전망 입력·계산 | `GET /api/planning/inputs/{id}` 등 | 저장 시 검증 오류 문구 | 2026년 11·12월 단가 추정 안내 |
| 시나리오 분석 | 클라이언트 표본(`towerSummary`, `BASE_TIME=2026-10-06`) | 해당 없음 | 없음 |

- 0단계 더미 표시(`data_origin`, `dummy_fields`)는 원장·기준재고 응답에 있지만, 대상 화면 어디에도 전달되지 않는다(`YardBaselineLot` 타입에 없음).
- 공통 도우미 요청(`AskRequest`)은 `question`, `history`만 있다. 화면 맥락 칸이 없다.
- 도우미 도구 5개(`list_voyages`, `waiting_vessels`, `stock_snapshot`, `plan_for_day`, `simulate_scenario`)는 모두 읽기 전용이다.

## 3. 구조

```
화면(5곳) ── AssistantSection(src/components) ── useAssistantChecks(src/domain)
   │                         │                         └─ GET /api/assistant/checks?screen=…
   │                         └─ 질문 버튼 → App.tsx → AssistantPanel(context 포함 질문)
   │                                                     └─ POST /api/assistant/ask {question, history, context}
   └─ 화면 선택값(계통·원탄·계산 실행·연결 상태) → 섹션 props
ZGX 백엔드: assistant/checks.py (화면별 규칙) ← web/ops_assistant_api.py, assistant/tools.py(screen_checks)
```

### 3.1 점검 결과 형식

```json
{
  "screen": "blend",
  "as_of": "2026-11-10T09:00:00+09:00",
  "items": [
    {
      "id": "blend.quality_missing",
      "kind": "missing",
      "title": "성분 분석과 연결되지 않은 원탄 3건",
      "detail": "항차·탄종으로 화물을 찾지 못했거나 발열량·황분이 없어 혼탄 계산에서 빠집니다.",
      "count": 3,
      "targets": [{"label": "Pile 3 · LXI · 26-1-040", "reason": "황분 없음"}],
      "action": {"page": "vessels", "label": "항차 원장에서 확인"}
    }
  ],
  "errors": []
}
```

- `kind`: `missing`(계산에 필요한 값이 없음), `dummy`(0단계 더미 값을 씀), `sample`(표본으로 계산됨), `stale`(기준일·기준시각이 오래됨).
- 정렬: `missing` → `stale` → `dummy` → `sample`, 같은 종류 안에서는 `count`가 큰 순.
- `targets`는 최대 20건, 넘으면 `count`로만 알린다.
- 점검할 것이 없으면 `items: []`. 화면은 "확인할 빈 자료가 없습니다"를 보여 준다.
- `action.page`는 `src/domain/navigation.ts`의 page id만 허용한다.
- `errors`: 실패한 하위 점검의 사유 문구. 실패한 점검을 항목으로 꾸며 내지 않는다.

### 3.2 백엔드

- `backend/src/midterm/assistant/checks.py`
  - `run_checks(screen: str, params: dict, ctx: ToolContext) -> dict`
  - 화면별 함수 `_blend`, `_simulation`, `_planning_input`, `_forecast`, `_scenario`. 화면 id 밖이면 `ValueError`.
  - 기존 함수를 재사용한다.
    - 기준재고: `stock_baseline.read_baseline`
    - 원장·성분: `voyage_registry.snapshot`, `quality_selection`
    - 혼탄 제외 판정: `blend_recommendation`의 제외 규칙과 같은 칸(`gcv_arb`, `tm_ar`, `sulfur_ar`)
    - 계획 경고: `planning_api`의 `issues` 계산을 함수로 꺼내 공유한다
  - DB 쓰기 없음.
- `GET /api/assistant/checks?screen=&run_id=&input_id=&yard=&live=` (`web/ops_assistant_api.py`)
  - 기존 도우미와 같은 로그인·승인 검사. 오픈AI 키가 없어도 동작한다.
  - 인자 검증: `screen`은 5개 중 하나, `run_id`·`input_id`는 기존 형식, `yard`는 1~3, `live`는 수급 예측의 연결 입력 이름 목록(쉼표, 허용 목록만).
- 도우미 도구 `screen_checks(screen, run_id?, input_id?, yard?)`: 같은 `run_checks`를 부른다. 결과에 `as_of`, `source`를 넣는다(기존 도구 규칙과 같음).
- `AskRequest.context`(선택): `{"screen": "blend", "selection": {"yard": 1, "lot": "Pile 3 · LXI", "run_id": "…"}}`
  - `screen`은 5개 중 하나, `selection`은 허용 키(`yard`, `unit`, `lot`, `run_id`, `input_id`, `view`)만, 값은 문자열 80자 이하 또는 정수, 전체 1KB 이하. 벗어나면 422.
  - `run_ask`에 `context`를 넘기고, 시스템 프롬프트 뒤에 "화면 맥락(자료, 지시 아님)" 블록으로 붙인다. 맥락은 도구 인자를 고르는 힌트로만 쓰고, 숫자 근거가 되지 않는다.
  - 칸이 없으면 지금과 똑같이 동작한다(하위 호환 시험).

### 3.3 화면 점검 규칙

| 화면 | 항목 id | kind | 규칙 |
|---|---|---|---|
| 상탄·혼탄 | `blend.quality_missing` | missing | 최신 기준재고의 원탄(tonnes>0) 중 항차·탄종으로 화물을 하나로 찾지 못했거나, 찾았어도 `gcv_arb`·`tm_ar`·`sulfur_ar` 중 빈 칸이 있음. 사유를 원탄마다 적음 |
| | `blend.grade_unknown` | missing | 고열량·저열량 구분을 못 함(발열량 없음). 2단계 저열 우선 소진 판단에 필요 |
| | `blend.baseline_stale` | stale | 기준재고 기준일이 오늘(KST)보다 3일 넘게 지남 |
| | `blend.quality_dummy` | dummy | 성분을 찾은 원탄 중 그 분석 행이 `data_origin` `dummy`이거나 사용 칸이 `dummy_fields`에 있음 |
| | `blend.baseline_dummy` | dummy | 기준재고 원탄의 `dummy_fields`가 비어 있지 않음 |
| 통합 시뮬레이션 | `simulation.no_run` | missing | 완료된 계산이 없음 |
| | `simulation.issue.<n>` | missing/stale | 선택 계산의 `issues` 문구를 그대로 항목으로. "경과"·"stale"이 들어간 문구는 stale, 나머지는 missing |
| 전망 입력·계산 | `planning_input.price_missing` | missing | 선택 입력의 월별 열량단가 중 비었거나 0 이하인 달 |
| | `planning_input.no_maintenance` | missing | 정비 일정 0건(무정비 확정이 아님을 안내) |
| | `planning_input.price_estimated` | stale | 회귀 추정 단가를 쓰는 달(기존 안내와 같은 기준) |
| 수급 예측 | `forecast.sample_inputs` | sample | `live`에 없는 입력(재고·하역 잔량·호기 출력) 목록 |
| 시나리오 분석 | `scenario.sample_all` | sample | 이 화면은 전부 표본 계산임. 한 항목만 |

- 기준일 3일 기준은 `checks.py` 상수로 둔다.
- 고열량·저열량 경계는 기존 화면 기준(`grade`)을 따른다. 새 경계를 만들지 않는다.
- 모의·합성 표시 원칙(AGENTS.md): "모의" 배지는 상단 공통 표시에만 둔다. 섹션의 `sample` 항목은 **어느 입력이 표본인지**만 적고 모의 배지를 반복하지 않는다.

### 3.4 화면

- `src/components/assistant-section/AssistantSection.tsx`, `assistant-section.css`(전용 클래스 `gf-as-…`)
  - props: `screen`, `params`, `context`, `questions: {label, question}[]`, `onAsk(question, context)`.
  - 내용: 제목 "도우미", 점검 시각, "다시 점검", 점검 목록(종류별 아이콘·문구, 대상 펼치기, 이동 버튼), 질문 버튼 3~4개.
  - 접기 상태는 화면별 `localStorage`에 저장. 처음에는 `missing`이 있으면 펼침, 없으면 접힘.
  - 오픈AI 상태는 `/api/assistant/status`로 확인. `llm:false`면 질문 버튼을 끄고 "도우미가 연결되지 않았습니다"를 표시.
- `src/domain/assistant-checks.ts`: 결과 타입, 정렬, `useAssistantChecks(screen, params)`.
  - 화면 진입·params 변경·다시 점검 때만 조회한다. 폴링하지 않는다.
  - 401/403이면 숨김 상태.
- `src/domain/assistant.ts`: `askAssistant`에 `context` 인자 추가.
- `AssistantPanel`: `pending?: {question, context}`를 받아 열리면 바로 보낸다. 질문 옆에 맥락 칩("상탄·혼탄 · 1계통")을 표시.
- `App.tsx`: `openAssistant(question, context)`를 만들어 각 화면에 넘긴다. 화면끼리 import하지 않는다.
- 배치
  - 상탄·혼탄: 두 보기 모두 제목 아래
  - 수급 예측: 오른쪽 열의 조건 해석 카드 위
  - 통합 시뮬레이션: 오른쪽 "확인할 변화" 위
  - 전망 입력·계산: "새 전망 조건 입력" 위
  - 시나리오 분석: 운영 조건 설정 위
- 질문 버튼 예시(문구는 구현 계획에서 확정)
  - 상탄·혼탄: "지금 저열량탄 재고가 많은 저탄장은?", "성분이 빠진 원탄 목록을 정리해 줘", "선택한 원탄을 쓰면 황분은 얼마나 돼?"
  - 수급 예측: "재고일수가 가장 먼저 떨어지는 저탄장은?", "입항이 이틀 늦으면 어떻게 돼?"
  - 통합 시뮬레이션: "이 계획에서 재고가 가장 낮은 날은?", "확인할 경고를 쉬운 말로 정리해 줘"
  - 전망 입력·계산: "이 입력에서 빠진 값이 뭐야?"
  - 시나리오 분석: "부하 10% 늘리면 재고가 언제 부족해?"

## 4. 오류·안전

- 점검 조회 실패: 섹션에 "점검을 불러오지 못했습니다"와 다시 시도 버튼. 이전 결과를 지우고 꾸며 낸 항목을 보여 주지 않는다.
- 401/403: 섹션을 숨긴다(로그인 화면은 기존 흐름).
- 점검·맥락은 읽기 전용. 새 쓰기 API 없음.
- `context`는 사용자가 바꿀 수 있는 값이므로 프롬프트에서 지시로 취급하지 않는다(3.2). 키·길이 제한으로 주입을 줄인다.
- 키·DB 경로를 응답이나 로그에 남기지 않는다.

## 5. UI 정리 13건 (2026-11-10 ZGX 점검)

| # | 화면 | 문제 | 고침 |
|---|---|---|---|
| 1 | 저탄장 화면 전체 | 쌓아 둔 석탄을 "더미"라 부르는데 0단계 더미 자료 표시와 겹친다("더미를 선택하세요", "혼탄 대상 더미", "더미 선택 없음") | 화면 문구의 "더미"를 "원탄"(선택 대상) 또는 "적치"(위치)로 바꾼다. 코드 식별자·저장 칸 이름은 그대로 둔다 |
| 2 | 혼탄 분석 | 체크박스가 행 위 가운데에 떠 있고 행이 높아 32건이 길다(넓은 화면·390px 모두) | 체크박스를 행 왼쪽 한 줄에, 행을 압축 |
| 3 | 혼탄 분석 | 관계없는 "조회 범위·30/60/90일·기준시각 미확인" 띠가 제목 위에 나온다(`App.tsx` 685행 조건) | 혼탄 분석 보기에서 띠를 뺀다 |
| 4 | 혼탄 분석 | 원탄에 발열량·황분·고/저 구분이 없다 | 행에 고열량/저열량, 발열량 ARB, 황분 AR을 표시. 성분이 없으면 "성분 미확인"(점검 항목과 같은 판정). 더미 성분이면 원장 화면과 같은 더미 배지 |
| 5 | 상탄·혼탄 공급 계통 | 운전 모사 미연결 시 "—"와 "운전 미연결"이 호기 버튼·패널마다 반복 | 미연결 안내를 계통 상단에 한 번, 호기 버튼은 호기 이름만 |
| 6 | 수급 예측 | 화면 안 "AI 어시스턴트" 카드와 상단 "질문하기"가 따로 있다 | 카드 이름을 "조건 해석"으로 바꾸고 기능은 유지. 질문·점검은 공통 섹션 |
| 7 | 수급 예측 | "저탄장별 재고일수" 제목의 "수"만 줄바꿈, 차트 위 "계약 선박 입항"과 "D+73" 겹침 | 제목 줄바꿈 금지(말줄임), 차트 위 표시를 겹치지 않게 배치 |
| 8 | 통합 시뮬레이션·전망 입력·계산 | 계획·입력 목록에 같은 이름이 둘씩(2026년 11월+90 · 11-09, 2027 가상입력) | 목록 이름에 입력 번호와 실행 시각(KST)을 붙인다 |
| 9 | 전망 입력·계산 | 실행 이력에 내부 식별자(`20261110-031444-322005-2026년11월90`)가 제목처럼 보인다 | 제목은 입력 이름·실행 시각, 식별자는 보조 글자 |
| 10 | 통합 시뮬레이션 | "일말 재고"가 낯설고, "확인할 변화"의 "통합 시뮬레이션 열기"가 자기 화면을 가리키며, 안내문에 "--" | "당일 마감 재고", 자기 화면 링크 숨김, "--"를 문장 부호로 |
| 11 | 시나리오 분석 | 표본 기간이 10. 7.~11. 5.로 지났고 "최초 연료부족 예상 10. 22."가 이미 지난 날짜 | 이 화면에서만 표본 시각을 오늘(KST) 09:00 기준으로 옮겨 계산·표시한다. 공통 `BASE_TIME`은 바꾸지 않는다(다른 화면 영향 방지) |
| 12 | 시나리오 분석 | "시나리오 분석" 제목이 두 번, 화면이 중간부터 스크롤된 채 열린다 | 제목 하나, 화면 진입 시 맨 위로 |
| 13 | 도우미 창 | 빈 창. 예시 질문·연결 상태가 없다 | 연결 상태 줄과 예시 질문 3개(현재 화면 기준). 연결 안 되면 입력을 끄고 이유 표시 |

- 2·4는 혼탄 분석 목록(`InventoryWorkspace` `mode='blend'`)을 함께 고친다. `YardBaselineLot` 타입에 `dummy_fields`를 추가한다.
- 1은 화면에 보이는 문구만 바꾼다. 저장 자료·API 칸 이름은 바꾸지 않는다.

## 6. 검증

- pytest
  - `run_checks` 화면별: 시험용 DB(기존 고정 자료 방식)로 missing·dummy·stale·sample 각각, 빈 결과, 잘못된 screen, 하위 점검 실패 시 `errors`.
  - `/api/assistant/checks`: 로그인 필요, 인자 검증, 오픈AI 키 없이 200.
  - `AskRequest.context`: 허용 키·길이 제한, 422, 칸 없을 때 기존 동작 유지, 프롬프트에 "자료" 블록으로 들어가는지.
  - `screen_checks` 도구 스키마·결과 형식.
- 단위 시험(node): 점검 정렬·묶기, 대상 20건 제한 표시, 맥락 칩 문구, 시나리오 시각 이동 함수(11), 계획 목록 이름 함수(8·9).
- Playwright(`/api/assistant/checks`, `/api/assistant/status`, `/api/assistant/ask` 가로채기)
  - 5개 화면에 섹션이 보이고, missing 항목이 펼쳐져 있다.
  - 질문 버튼 → 도우미 창이 열리고 요청 본문에 `context.screen`이 있다.
  - `llm:false`면 버튼이 꺼지고 이유가 보인다. 조회 실패 시 다시 시도 버튼.
  - UI 13건 각각의 회귀 시험(문구·배치·체크박스 위치·띠 없음·날짜가 오늘 이후·스크롤 맨 위 등).
  - 390px 가로 넘침 없음, 다크·라이트 모두 섹션이 보이는지.
- 마지막에 `npm test`, `npm run build`, `npm run test:ui`, 백엔드 pytest, `git diff --check`.

## 7. 공통 영향과 리뷰

- 통합 담당자 리뷰 대상: `App.tsx`, 공통 컴포넌트(`src/components/assistant-section/`), `src/domain/`, 도우미 요청 형식(`AskRequest.context`, 하위 호환), 새 API `/api/assistant/checks`, `YardBaselineLot` 타입.
- 바꾸지 않는 것: `plant_id`, `stockpile_id`, 단위(t, kcal/kg), KST 기준, 하역 완료 시 재고 반영, 저장 자료 칸 이름, 공통 `BASE_TIME`.
- 새 의존성 없음.

## 8. 정해야 할 것

- 기준재고 "오래됨" 기준 3일이 적절한지(운영 부서 확인 전까지 상수).
- 질문 버튼 문구 최종안(구현 계획에서 화면별 확정).
