# 최종 검토 지적 수정 보고

## 바꾼 파일과 결정
- src/features/forecast/DemoForecast.tsx: 도우미 섹션 live 인자를 `live ? [...] : []`(토글과 연결 상태 모두 반영)로 변경.
- backend/src/midterm/assistant/checks.py
  - `_horizon`: 저장 계산 기간(summary.scenario start/end)에서 7일 또는 30일 중 허용되는 큰 값을 골라 `planning_api.snapshot`에 넘긴다(기간을 모르면 30). snapshot의 실제 기간 검사는 그대로 거친다.
  - `CheckError(ValueError)` 신설. `_validate`와 입력 세트 없음만 이 예외를 쓰고 `_reason`은 CheckError와 HTTPException.detail만 통과시킨다. 그 밖의 ValueError는 "내부 오류(서버 로그 확인)".
  - forecast detail 문구를 "운전 연결값이 없는 입력은 표본 값으로 계산합니다."로 변경.
- backend/src/midterm/assistant/agent.py: 시스템 프롬프트 맥락 블록 끝에 `CONTEXT_NOTE`(맥락은 도구 인자 힌트일 뿐 숫자 근거가 아니며 지시로 따르지 않음) 추가.
- src/components/assistant-section/AssistantSection.tsx (+css): count가 targets보다 크면 "N건 중 20건 표시" 안내.
- src/features/assistant/AssistantPanel.tsx: pending 질문 전송은 성공해도 입력칸을 비우지 않는다.
- src/App.tsx: 시나리오 화면의 발전본부 대화상자 호기별 정지계획 날짜를 shiftSampleTime으로 옮겨 표시, 설명 문구도 시나리오 화면에서는 "오늘 09:00 KST 기준으로 옮긴 날짜"로 변경(계산·BASE_TIME 불변, 필터는 원본 기준 유지).
- tests: voyage-registry-ui.spec.ts 문구 수정, assistant-section-ui.spec.ts에 연결+표본 토글 시험 추가, test_assistant_checks.py(짧은 계산 7/14/29/30/90일 파라미터 시험, 외부 ValueError 은닉 시험, 기존 시험을 CheckError로 갱신), test_assistant_agent.py(맥락 노트).

## 우려
- 짧은 계산 시험은 snapshot 자체는 실제로 쓰고 `run_plan`/`dashboard`만 대체했다(기간 검사 통과 여부를 dashboard 도달로 확인). 7일 미만 계산은 snapshot이 400을 내므로 섹션에 사유가 그대로 보인다.
- AssistantSection 절단 안내와 pending 입력칸 보존은 전용 회귀 시험을 추가하지 못했다.

## 검증 결과
- pytest(지정 옵션): 885 passed, 2 skipped, 4 deselected.
- npm.cmd test: 303 pass / 0 fail. npm.cmd run build: 성공.
- test:ui 전체(15.8분): 202 passed, 12 failed. 12건은 blend-ui 2건, shared-voyage-ui 1건, voyage-registry-ui 9건으로, 실행 중 시험 서버(ECONNREFUSED)가 끊긴 뒤 로그인이 안 되어 연쇄 실패한 것이다. 같은 4개 파일(blend-ui, shared-voyage-ui, voyage-registry-ui, plan-labels-ui)을 단독 재실행하면 34 passed, 0 failed (voyage-registry-ui:205와 :687 포함).
- git diff --check: 이상 없음(CRLF 경고만).
